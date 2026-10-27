# Studio API

Provides the Bun and Hono backend, worker runtime, and distributable CLI for
deco Studio.

| Attribute | Value |
| --- | --- |
| Workspace | `decocms` (`apps/api`) |
| Kind | Hono API, worker, and CLI |
| Runtime | Bun |
| Distribution | npm `decocms`; GHCR `studio` image |

## Overview

Studio API is the authoritative server for Studio. It authenticates users and
MCP clients, applies organization and project permissions, persists application
state, proxies MCP traffic, dispatches durable work, and exposes operational
health and telemetry endpoints.

The workspace also produces the `decocms` npm package and its `deco` executable.
The combined Studio build places the web bundle from `apps/web/dist` in
`apps/api/dist/client`, so the released CLI and API container can serve the
complete product from one artifact.

## Responsibilities

- Serve Hono HTTP, OAuth, MCP, health, metrics, and organization-scoped API
  routes.
- Configure Better Auth, API keys, SSO, organization membership, and RBAC.
- Run Kysely and Better Auth migrations against PostgreSQL.
- Own database adapters, credential encryption, object storage, and the token
  vault.
- Define built-in MCP tools through `defineTool()` and execute them with a
  `StudioContext`.
- Proxy downstream MCP connections and enforce credentials and permissions.
- Coordinate DBOS workflows, automations, event delivery, NATS messaging, and
  the hosted AgentSandbox provider.
- Emit OpenTelemetry traces, metrics, and logs and query monitoring backends.
- Package the production server, migration runner, CLI, and staged web assets.

## Usage

Start the complete development environment from the repository root:

```bash
docker compose up --build --watch
```

Compose runs dependencies and migrations before the API, syncs source changes,
and keeps installed dependencies and generated artifacts inside Linux. See
[CONTRIBUTING.md](../../CONTRIBUTING.md) for setup and lifecycle commands.

The API listens on port `3000` by default, while the web app listens on port
`4000`.

To run only the API when its PostgreSQL, NATS, and object-storage dependencies
are already available:

```bash
bun run --cwd=apps/api dev
```

The host development command starts only the hot-reloading API. It does not
start dependency services or run migrations; configure them explicitly.
`dev:server` is the same direct server entry point.

Run released Studio with [Docker Compose](../../selfhost/examples/docker-compose/README.md)
or the [Helm chart](../../deploy/helm/studio/README.md). The npm CLI remains
available for application scaffolding and connection tooling; it no longer
provisions a local runtime.

Build both apps into the combined production distribution, then run it:

```bash
bun run build:studio
bun run --cwd=apps/api start
```

Use `bun run build:api` when only the server bundle is required. It does not
stage the web client.

### Amp task worker

The optional Amp worker sends delegated board tasks to Amp Orbs. Configure
`DECOCMS_AMP_TASKS=true`, `AMP_TASK_ORGANIZATION_ID`, and `AMP_API_KEY` on the
API and workers. Install a compatible Amp CLI there, or mount it and set
`AMP_CLI_PATH`. The integration is tested with CLI `0.0.1793073650-g23dd39`.
Credentials belong to a dedicated Amp account and only the configured Studio
organization can use them. The flag defaults off.

Link the primary repository and additional repositories in the Studio project.
Configure the matching Amp team project with access to those repositories and
the desired model subscription. The worker selects only workspace-owned
projects and passes the explicit team/project reference to Amp. It never falls
back to a personal project. Missing or ambiguous team mappings stop dispatch
with a task comment. Re-runs verify that the saved thread belongs to that team
project and runs in an Orb before sending another prompt.

This deployment override replaces implementation
dispatch for the configured organization. Native chats and reviewers retain
their existing execution configuration.

Migration `261-task-board-amp-runs` stores dispatch claims and Amp thread IDs.
The `task-board-amp` DBOS queue streams progress into task comments and records
PR links. Re-runs continue the saved thread and refuse overlapping work.
After a stream interruption, the worker reads the existing Amp thread rather
than resubmitting the prompt. An uncertain submission remains blocked until
the worker can confirm the result. Stopping Studio does not cancel an Orb;
use the Amp thread to inspect or stop remote work.

Set `DECOCMS_AMP_TASK_PLANNING=true` to require a plan before implementation.
This separate flag defaults off. Moving a task to Todo starts a planning turn
in its team Orb. Assignment and re-runs also generate a plan. The planning
prompt permits inspection only; the task stays in Todo until a person chooses
**Approve and implement**. Approval names the displayed plan version and queues
implementation on the same Amp thread. Editing the task, human comments, or
project repository bindings invalidates that approval candidate. Generate a
new plan after those edits. Migration `262-task-board-amp-plans` persists the
plan, content fingerprint and approval author. Existing runs finish under their
original execution mode.

`DECOCMS_AMP_TASK_SUMMARY=true` generates a short issue summary while a card is
in Backlog. Orbit intake queues it after fetching the ticket conversation.
Amp only starts for cards assigned to an active project other than the Orbit
intake inbox. Inbox projects are identified by their Orbit webhook automation,
so renaming the inbox does not enable execution. Unassigned cards wait for a
project; moving a Backlog card to an eligible project queues its summary.
The summary performs targeted read-only research in the mapped repositories
before recommending a resolution. It traces the affected behavior or content to
its source and checks existing CMS fields, settings and supported workflows.
It distinguishes content/configuration changes from code changes and reports
missing access or evidence instead of guessing. It cannot authorize
implementation. Source edits refresh the summary; moving to Todo
during summarization queues planning after the current turn finishes. Set
`AMP_TASK_SUMMARY_PROJECT=team/project` to a workspace-owned intake project for
tickets without repository bindings. Those tickets receive text-only triage.
When research finds an existing content/configuration solution or usage
explanation, the summary includes a ready-to-send customer reply with the
verified solution and next steps. Missing customer information produces a
clarification message, combined with the solution when both apply. The draft
uses the ticket's language and a separately copyable text block. Amp does not
invent admin navigation, permissions, or completed changes. Clear code-change
requests without a customer-facing answer or missing input omit the draft.
Studio does not send it to the customer. Refresh a Backlog summary to apply
these instructions to an existing ticket.
Completed, current summaries with a customer-message block move Backlog tickets
to QA for a person to check and send the reply. The assignee stays unchanged.
Failed or stale summaries and tickets moved out of Backlog by a person do not
advance. QA here means the response needs human review, not that a content or
code change has been performed. Ticket details open on an available summary and
show the next human action above the tabs, including plan approval and review.

`DECOCMS_AMP_TASK_REVIEW=true` reviews linked PRs when a task enters In Review.
It uses a fresh team Orb, pins each PR's head SHA, executes the approved test
plan and asks for browser screenshots of UI changes. Evidence stays in private
Amp attachments, linked from the report. The reviewer reports findings and
PASS/FAIL/BLOCKED outcomes in Studio and comments on the PR. It does not fix or
merge code. The task stays In Review for the next human decision. A new head
or changed task context invalidates the previous review key; the existing PR
events and review sweep dispatch the next review. Manual review retries use
the task's **Run review again** button.

Both flags default off. Migration `263-task-board-amp-triage-review` adds summary
and review persistence. Startup catches up the newest 100 Backlog/In Review
cards in the configured organization. Existing workflow registrations remain
available for recovery; new runs use the durable multi-phase workflow.

## Architecture

Requests enter through `src/index.ts` and the Hono application in
`src/api/app.ts`. The API resolves authentication and organization context,
constructs a `StudioContext`, and delegates to routes, tools, storage adapters,
or durable workers.

```text
Browser, CLI, or MCP client
           |
           v
    Hono routes and auth
           |
           v
       StudioContext
      /      |       \
 storage   tools    MCP proxy
    |        |          |
 PostgreSQL/DBOS   downstream MCPs
           |
       NATS and workers
```

Key paths:

| Path | Purpose |
| --- | --- |
| `src/api/` | Hono application, middleware, and HTTP/MCP routes |
| `src/auth/` | Better Auth, OAuth, SSO, email, and organization setup |
| `src/core/` | `StudioContext`, access control, configuration, and tool primitives |
| `src/tools/` | Built-in MCP management tools grouped by domain |
| `src/database/` and `src/storage/` | Database setup, Kysely adapters, and domain persistence |
| `src/dbos/` and `src/dispatch-queue/` | Durable workflows and queue coordination |
| `src/event-bus/` and `src/nats/` | SSE fan-out and shared NATS infrastructure |
| `src/encryption/` and `src/vault/` | Credential encryption and secure token access |
| `src/sandbox/` | Hosted agent-sandbox lifecycle and preview routing |
| `src/observability/` and `src/monitoring/` | Telemetry export and monitoring queries |
| `migrations/` | Ordered Kysely migrations |
| `scripts/` | Bundle, contract-generation, migration, and smoke-test utilities |

Canonical organization-scoped routes use `/api/:org/...`. Keep compatibility
routes isolated and deprecated; new API and web code must use the canonical
paths.

## Development

Run API checks from the repository root:

```bash
bun run --cwd=apps/api check
bun run --cwd=apps/api test
bun test apps/api/src/settings/resolve-config.test.ts
bun run --cwd=apps/api build:server
```

The workspace test script runs Bun tests under `apps/api/src`. Before adding
or changing tests, read [TESTING.md](../../TESTING.md) to choose the right tier.

Run schema operations explicitly with:

```bash
bun run --cwd=apps/api migrate
bun run --cwd=apps/api better-auth:migrate
```

### Querying local Postgres

Query the Compose database without publishing its port:

```bash
docker compose exec postgres psql -U studio -d studio
```

Use the same Compose project name and overrides as the development stack.

Follow the [repository verification instructions](../../AGENTS.md#working-locally).

## Boundaries

- `apps/api` owns server-only behavior, environment access, persistence,
  migrations, authentication, and infrastructure integration.
- `apps/web` consumes the API over HTTP and MCP. The API must not import web
  implementation modules.
- Put isomorphic wire contracts and browser-safe utilities in explicit
  `@decocms/shared/*` exports. Do not move server adapters or secrets into the
  shared package.
- Packages must not import from `apps/api/src`; expose a package-level contract
  instead.
- MCP tools receive dependencies through `StudioContext`. They do not read Hono
  contexts, database drivers, or environment variables directly.
- New organization-scoped endpoints live under `/api/:org/...`; do not extend
  deprecated unscoped route families.
- The API owns the backend domain term `thread`. User-facing web copy renders
  that concept as a chat.

## Configuration

Host `dev:server` loads `apps/api/.env` because the workspace command runs with
`apps/api` as its current directory. Compose supplies container environment
variables explicitly. Services use configured endpoints; the CLI does not
start PostgreSQL, NATS, or object storage.

Core settings include:

| Setting | Purpose | Default |
| --- | --- | --- |
| `PORT` | API listener port | `3000` |
| `DATA_DIR` | Runtime files and local telemetry | `~/deco` |
| `BASE_URL` | Public origin used in generated URLs | `http://localhost:<PORT>` |
| `DATABASE_URL` | PostgreSQL connection | `postgresql://postgres:postgres@localhost:5432/postgres`; Compose supplies its service URL |
| `NATS_URL` | NATS connection, optionally comma-separated | `nats://localhost:4222`; Compose supplies its service URL |
| `BETTER_AUTH_SECRET` | Stable Better Auth signing secret | Set explicitly in production |
| `ENCRYPTION_KEY` | Stable credential-vault key | Set explicitly in production |
| `CONFIG_PATH` | Theme, logo, and monitoring JSON configuration | `./config.json` |
| `STUDIO_DISPATCH_ROLE` | Queue role: `all`, `api`, or `worker` | `all` |
| `STUDIO_AGENT_SANDBOX_ENABLED` | Enable hosted AgentSandbox provisioning | `false` |
| `STUDIO_SANDBOX_CONTROL_PLANE_URL` / `STUDIO_SANDBOX_CONTROL_PLANE_TOKEN` | Ask a remote host (the control plane) for sandboxes instead of running them in-process; Studio pushes their credentials to it every 10 minutes | Unset: in-process |
| `CLICKHOUSE_URL` | Optional ClickHouse monitoring endpoint | Local monitoring backend |

Authentication providers use `AUTH_*` variables. The validated list lives in
`src/auth/auth-env.ts`. `config.json` no longer configures authentication; its
`auth` key is ignored. Use `config.example.json` for the supported theme, logo,
monitoring, and organization-default shape.

Deployment-specific database, NATS, object-storage, telemetry, worker, and
sandbox settings are documented with the Helm chart.

## Related documentation

- [Studio web app](../web/README.md)
- [Repository guidelines](../../AGENTS.md)
- [Testing strategy](../../TESTING.md)
- [Studio Helm chart](../../deploy/helm/studio/README.md)
- [Project license](../../LICENSE.md)
