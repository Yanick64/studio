import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import type { StudioDatabase } from "../database";
import {
  connectTestPgDatabase,
  closeTestPgDatabase,
} from "../database/test-db-pg";
import { TaskBoardStorage } from "./task-board";
import { createAutomationsStorage } from "./automations";

let database: StudioDatabase;
let storage: TaskBoardStorage;
const userId = `user_${randomUUID()}`;
const orgId = `org_${randomUUID()}`;
beforeAll(async () => {
  database = await connectTestPgDatabase();
  storage = new TaskBoardStorage(database.db);
  const now = new Date().toISOString();
  await sql`INSERT INTO "user" (id, email, "emailVerified", name, "createdAt", "updatedAt")
    VALUES (${userId}, ${`${userId}@example.test`}, false, 'Amp test', ${now}, ${now})`.execute(
    database.db,
  );
  await database.db
    .insertInto("organization")
    .values({ id: orgId, name: "Amp test", slug: orgId, createdAt: now })
    .execute();
});
afterAll(async () => {
  await database.db
    .deleteFrom("organization")
    .where("id", "=", orgId)
    .execute();
  await database.db.deleteFrom("user").where("id", "=", userId).execute();
  await closeTestPgDatabase(database);
});

test("Amp requires an active tenant project and excludes the configured Orbit inbox even after renaming", async () => {
  const task = await storage.create({
    organizationId: orgId,
    title: "Project eligibility",
    by: userId,
  });
  expect(await storage.hasAmpProject(task.id, orgId)).toBe(false);
  const id = `vir_${randomUUID()}`;
  const now = new Date().toISOString();
  await database.db
    .insertInto("connections")
    .values({
      id,
      organization_id: orgId,
      created_by: userId,
      updated_by: null,
      title: "Example project",
      description: null,
      icon: null,
      app_name: null,
      app_id: null,
      slug: null,
      connection_type: "VIRTUAL",
      connection_url: `virtual://${id}`,
      connection_token: null,
      connection_headers: null,
      oauth_config: null,
      configuration_state: null,
      configuration_scopes: null,
      metadata: null,
      bindings: null,
      status: "active",
      pinned: false,
      created_at: now,
      updated_at: now,
    })
    .execute();
  await storage.update(task.id, orgId, { virtualMcpId: id }, userId);
  expect(await storage.hasAmpProject(task.id, orgId)).toBe(true);
  expect(await storage.hasAmpProject(task.id, "other-org")).toBe(false);
  await database.db
    .updateTable("connections")
    .set({ status: "inactive" })
    .where("id", "=", id)
    .execute();
  expect(await storage.hasAmpProject(task.id, orgId)).toBe(false);
  await database.db
    .updateTable("connections")
    .set({ status: "active" })
    .where("id", "=", id)
    .execute();
  const automations = createAutomationsStorage(database.db);
  const automation = await automations.create({
    organization_id: orgId,
    name: "Intake",
    created_by: userId,
    messages: "[]",
    models: "[]",
    virtual_mcp_id: id,
  });
  await automations.addTrigger({
    automation_id: automation.id,
    type: "webhook",
    params: JSON.stringify({ intake: "teamleader-orbit" }),
  });
  expect(await storage.hasAmpProject(task.id, orgId)).toBe(false);
  await database.db
    .updateTable("connections")
    .set({ title: "Renamed inbox" })
    .where("id", "=", id)
    .execute();
  await automations.update(automation.id, orgId, { active: false });
  expect(await storage.hasAmpProject(task.id, orgId)).toBe(false);
  await storage.update(task.id, orgId, { virtualMcpId: null }, userId);
  expect(await storage.hasAmpProject(task.id, orgId)).toBe(false);
});

test("concurrent dispatch has one winner; uncertainty keeps the claim and completed retries reuse the thread", async () => {
  const task = await storage.create({
    organizationId: orgId,
    title: "Example task",
    by: userId,
    assigneeId: "super-agent",
  });
  const params = {
    taskId: task.id,
    organizationId: orgId,
    runId: randomUUID(),
    prompt: "Example prompt",
    repositories: ["https://github.com/example/web"],
    requestedBy: userId,
  };
  const attempts = await Promise.allSettled([
    storage.queueAmpRun(params),
    storage.queueAmpRun({ ...params, runId: randomUUID() }),
  ]);
  expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(1);
  const run = await storage.getAmpRun(task.id, orgId);
  expect(run).toBeDefined();
  const runId = run!.run_id;
  expect(await storage.getAmpRun(task.id, "another-org")).toBeUndefined();
  expect(
    await storage.claimAmpStart(task.id, "another-org", runId),
  ).toBeUndefined();
  expect(await storage.claimAmpStart(task.id, orgId, runId)).toBeDefined();
  expect(await storage.claimAmpStart(task.id, orgId, runId)).toBeUndefined();
  const project = {
    taskId: task.id,
    organizationId: orgId,
    runId,
    body: "Reconnecting",
    threadId: "T-example-12345678",
  };
  await storage.projectAmpRun({ ...project, state: "unknown" });
  await expect(
    storage.queueAmpRun({ ...params, runId: randomUUID() }),
  ).rejects.toThrow("already has an Amp run");
  expect((await storage.getById(task.id, orgId))?.status).toBe("todo");
  await storage.projectAmpRun({
    ...project,
    state: "completed",
    body: "Finished",
  });
  const retry = await storage.queueAmpRun({ ...params, runId: randomUUID() });
  expect(retry?.thread_id).toBe(project.threadId);
  expect(retry?.state).toBe("queued");
  expect(
    await storage.projectAmpRun({
      ...project,
      state: "failed",
      body: "Stale event",
    }),
  ).toBe(false);
  expect((await storage.getAmpRun(task.id, orgId))?.state).toBe("queued");
  await storage.delete(task.id, orgId, userId);
  expect(await storage.getAmpRun(task.id, orgId)).toBeUndefined();
});

test("persisted output redacts credentials, restores deleted comments, and preserves human reassignment", async () => {
  const task = await storage.create({
    organizationId: orgId,
    title: "Example task",
    by: userId,
    assigneeId: "super-agent",
  });
  const run = await storage.queueAmpRun({
    taskId: task.id,
    organizationId: orgId,
    runId: randomUUID(),
    prompt: "Example prompt",
    repositories: ["https://github.com/example/web"],
    requestedBy: userId,
  });
  expect(run?.comment_id).toBeTruthy();
  await storage.deleteComment(run!.comment_id!, orgId, userId);
  await storage.update(
    task.id,
    orgId,
    { assigneeId: userId, status: "triage" },
    userId,
  );
  const secret = "ghp_" + "a".repeat(30);
  await storage.projectAmpRun({
    taskId: task.id,
    organizationId: orgId,
    runId: run!.run_id,
    state: "completed",
    body: `https://user:${secret}@github.com/example/web sgamp_test-secret-value`,
  });
  const row = await database.db
    .selectFrom("task_board_comments")
    .select("body")
    .where("task_board_item_id", "=", task.id)
    .executeTakeFirstOrThrow();
  expect(row.body).not.toContain(secret);
  expect(row.body).not.toContain("sgamp_test-secret-value");
  expect((await storage.getById(task.id, orgId))?.status).toBe("triage");
});

test("a terminal run links PRs once and stale output cannot attach another PR", async () => {
  const task = await storage.create({
    organizationId: orgId,
    title: "PR result",
    by: userId,
    assigneeId: "super-agent",
  });
  const runId = randomUUID();
  await storage.queueAmpRun({
    taskId: task.id,
    organizationId: orgId,
    runId,
    prompt: "Example prompt",
    repositories: ["https://github.com/example/web"],
    requestedBy: userId,
  });
  const event = {
    taskId: task.id,
    organizationId: orgId,
    runId,
    state: "completed" as const,
    body: "Ready for review",
    prs: [
      {
        url: "https://github.com/example/web/pull/7",
        number: 7,
        repo: {
          provider: "github" as const,
          host: "github.com",
          path: "example/web",
        },
      },
    ],
  };
  expect(await storage.projectAmpRun(event)).toBe(true);
  expect(
    await storage.projectAmpRun({
      ...event,
      prs: [
        {
          ...event.prs[0]!,
          number: 8,
          url: "https://github.com/example/web/pull/8",
        },
      ],
    }),
  ).toBe(false);
  expect(
    (await storage.listPrs(task.id, orgId)).map((pr) => pr.number),
  ).toEqual([7]);
  expect((await storage.getById(task.id, orgId))?.status).toBe("in_review");
});

async function plannedTask(virtualMcpId?: string) {
  const task = await storage.create({
    organizationId: orgId,
    title: "Inspect example configuration",
    virtualMcpId,
    by: userId,
    status: "todo",
  });
  const params = {
    taskId: task.id,
    organizationId: orgId,
    runId: randomUUID(),
    phase: "planning" as const,
    contextHash: await storage.ampContextHash(task.id, orgId),
    prompt: "Inspect only. Return a plan.",
    repositories: ["https://github.com/example/web"],
    requestedBy: userId,
  };
  await storage.queueAmpRun(params);
  await storage.claimAmpStart(task.id, orgId, params.runId);
  const projection = {
    taskId: task.id,
    organizationId: orgId,
    runId: params.runId,
    threadId: "T-example-12345678",
    body: "Inspecting",
  };
  await storage.projectAmpRun({ ...projection, state: "running" });
  expect((await storage.getById(task.id, orgId))?.status).toBe("todo");
  const plan =
    "Update configuration in src/config.ts and verify the parser with invalid inputs.";
  await storage.projectAmpRun({
    ...projection,
    state: "completed",
    body: plan,
    plan,
    prs: [
      {
        url: "https://github.com/example/web/pull/99",
        number: 99,
        repo: { provider: "github", host: "github.com", path: "example/web" },
      },
    ],
  });
  expect(await storage.listPrs(task.id, orgId)).toHaveLength(0);
  expect((await storage.getById(task.id, orgId))?.status).toBe("todo");
  return { task, params, plan };
}

test("planning stays in Todo, persists across storage instances, and simultaneous approvals dispatch once", async () => {
  const { task, params, plan } = await plannedTask();
  const recovered = new TaskBoardStorage(database.db);
  expect((await recovered.getById(task.id, orgId))?.ampRun?.plan).toBe(plan);
  expect(await recovered.pendingAmpRuns(orgId)).not.toContainEqual(
    expect.objectContaining({ task_id: task.id }),
  );
  const approval = {
    ...params,
    phase: "implementation" as const,
    approvedPlanRunId: params.runId,
    runId: randomUUID(),
    prompt: "Implement the approved plan",
  };
  await expect(
    storage.queueAmpRun({ ...approval, approvedPlanRunId: "stale-version" }),
  ).rejects.toThrow("current completed plan");
  const results = await Promise.allSettled([
    recovered.queueAmpRun(approval),
    storage.queueAmpRun({ ...approval, runId: randomUUID() }),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const implementation = (await storage.getAmpRun(task.id, orgId))!;
  expect(implementation.phase).toBe("implementation");
  expect(implementation.plan_text).toBe(plan);
  expect(implementation.approved_by).toBe(userId);
  expect(implementation.approved_at).toBeTruthy();
  expect(implementation.thread_id).toBe("T-example-12345678");
  await storage.projectAmpRun({
    taskId: task.id,
    organizationId: orgId,
    runId: implementation.run_id,
    state: "running",
    body: "Implementing",
  });
  expect((await storage.getById(task.id, orgId))?.status).toBe("in_progress");
  await storage.projectAmpRun({
    taskId: task.id,
    organizationId: orgId,
    runId: implementation.run_id,
    state: "completed",
    body: "Done",
  });
  expect((await storage.getById(task.id, orgId))?.status).toBe("qa");
});

test("task edits and new human feedback invalidate a completed plan", async () => {
  for (const edit of ["description", "comment", "project"] as const) {
    const { task, params } = await plannedTask();
    if (edit === "comment")
      await storage.createComment({
        taskBoardItemId: task.id,
        organizationId: orgId,
        authorId: userId,
        body: "Also cover an empty configuration.",
      });
    else
      await storage.update(
        task.id,
        orgId,
        edit === "description"
          ? { description: "Revised scope" }
          : { repo: "https://github.com/example/other" },
        userId,
      );
    await expect(
      storage.queueAmpRun({
        ...params,
        phase: "implementation",
        runId: randomUUID(),
        approvedPlanRunId: params.runId,
      }),
    ).rejects.toThrow("changed");
    // A fresh hash cannot make approval of the old plan valid.
    await expect(
      storage.queueAmpRun({
        ...params,
        phase: "implementation",
        runId: randomUUID(),
        approvedPlanRunId: params.runId,
        contextHash: await storage.ampContextHash(task.id, orgId),
      }),
    ).rejects.toThrow("current completed plan");
    const replacement = await storage.queueAmpRun({
      ...params,
      runId: randomUUID(),
      contextHash: await storage.ampContextHash(task.id, orgId),
    });
    expect(replacement?.plan_text).toBeNull();
    expect(replacement?.approved_by).toBeNull();
    expect(
      await storage.projectAmpRun({
        taskId: task.id,
        organizationId: orgId,
        runId: params.runId,
        state: "completed",
        body: "Old result",
        plan: "Old plan",
      }),
    ).toBe(false);
  }
});

test("queued implementation rechecks content and status before any remote submission", async () => {
  const { task, params } = await plannedTask();
  const runId = randomUUID();
  await storage.queueAmpRun({
    ...params,
    phase: "implementation",
    runId,
    approvedPlanRunId: params.runId,
  });
  await storage.update(task.id, orgId, { status: "triage" }, userId);
  await expect(storage.claimAmpStart(task.id, orgId, runId)).rejects.toThrow(
    "task changed",
  );
  expect((await storage.getAmpRun(task.id, orgId))?.state).toBe("queued");
});

test("project repository changes invalidate the plan fingerprint", async () => {
  const id = `vir_${randomUUID()}`;
  const now = new Date().toISOString();
  const repository = {
    url: "https://github.com/example/web",
    owner: "example",
    name: "web",
  };
  await database.db
    .insertInto("connections")
    .values({
      id,
      organization_id: orgId,
      created_by: userId,
      updated_by: null,
      title: "Example project",
      description: null,
      icon: null,
      app_name: null,
      app_id: null,
      slug: null,
      connection_type: "VIRTUAL",
      connection_url: `virtual://${id}`,
      connection_token: null,
      connection_headers: null,
      oauth_config: null,
      configuration_state: null,
      configuration_scopes: null,
      metadata: JSON.stringify({ githubRepo: repository }),
      bindings: null,
      status: "active",
      pinned: false,
      created_at: now,
      updated_at: now,
    })
    .execute();
  const { task, params } = await plannedTask(id);
  await database.db
    .updateTable("connections")
    .set({
      metadata: JSON.stringify({
        githubRepo: repository,
        githubRepos: [
          {
            url: "https://github.com/example/api",
            owner: "example",
            name: "api",
          },
        ],
      }),
    })
    .where("id", "=", id)
    .execute();
  expect(await storage.ampContextHash(task.id, orgId)).not.toBe(
    params.contextHash,
  );
  await expect(
    storage.queueAmpRun({
      ...params,
      phase: "implementation",
      runId: randomUUID(),
      approvedPlanRunId: params.runId,
    }),
  ).rejects.toThrow("changed");
  const replacement = await storage.queueAmpRun({
    ...params,
    runId: randomUUID(),
    contextHash: await storage.ampContextHash(task.id, orgId),
    repositories: [...params.repositories, "https://github.com/example/api"],
  });
  expect(replacement?.thread_id).toBeNull();
  expect(replacement?.phase).toBe("planning");
});

test("empty, oversized and failed plans cannot be approved", async () => {
  for (const [state, plan] of [
    ["completed", ""],
    ["completed", "x".repeat(40_001)],
    ["failed", "A partial plan"],
  ] as const) {
    const task = await storage.create({
      organizationId: orgId,
      title: "Empty plan",
      status: "todo",
      by: userId,
    });
    const params = {
      taskId: task.id,
      organizationId: orgId,
      runId: randomUUID(),
      phase: "planning" as const,
      contextHash: await storage.ampContextHash(task.id, orgId),
      prompt: "Plan",
      repositories: ["https://github.com/example/web"],
      requestedBy: userId,
    };
    await storage.queueAmpRun(params);
    await storage.projectAmpRun({
      ...params,
      state,
      body: "No valid plan returned",
      plan,
    });
    expect((await storage.getAmpRun(task.id, orgId))?.state).toBe("failed");
    await expect(
      storage.queueAmpRun({
        ...params,
        phase: "implementation",
        runId: randomUUID(),
        approvedPlanRunId: params.runId,
      }),
    ).rejects.toThrow("current completed plan");
  }
});

test("backlog summaries keep human ownership, deduplicate source updates and survive planning", async () => {
  const task = await storage.create({
    organizationId: orgId,
    title: "Search fails for empty input",
    status: "triage",
    assigneeId: userId,
    by: userId,
  });
  const params = {
    taskId: task.id,
    organizationId: orgId,
    runId: randomUUID(),
    phase: "summary" as const,
    prompt: "Summarize only",
    repositories: ["https://github.com/example/web"],
    requestedBy: userId,
    contextHash: await storage.ampContextHash(task.id, orgId),
  };
  const run = await storage.queueAmpRun(params);
  expect(
    (await storage.queueAmpRun({ ...params, runId: randomUUID() }))?.run_id,
  ).toBe(run?.run_id);
  await storage.claimAmpStart(task.id, orgId, params.runId);
  await storage.projectAmpRun({
    ...params,
    state: "running",
    body: "Inspecting source context",
  });
  expect((await storage.getById(task.id, orgId))?.status).toBe("triage");
  expect((await storage.getById(task.id, orgId))?.assigneeId).toBe(userId);
  await storage.projectAmpRun({
    ...params,
    state: "completed",
    body: "Summary",
    result: "Empty search returns an error instead of all results.",
  });
  expect((await storage.getById(task.id, orgId))?.ampRun?.summary).toContain(
    "Empty search",
  );
  expect(
    (await storage.queueAmpRun({ ...params, runId: randomUUID() }))?.run_id,
  ).toBe(params.runId);
  await storage.update(task.id, orgId, { status: "todo" }, userId);
  await storage.queueAmpRun({
    ...params,
    phase: "planning",
    runId: randomUUID(),
  });
  expect((await storage.getById(task.id, orgId))?.ampRun?.summary).toContain(
    "Empty search",
  );
});

test("a source edit during summarization cannot publish stale text or overwrite a Todo move", async () => {
  const task = await storage.create({
    organizationId: orgId,
    title: "Initial ticket",
    status: "triage",
    by: userId,
  });
  const params = {
    taskId: task.id,
    organizationId: orgId,
    runId: randomUUID(),
    phase: "summary" as const,
    prompt: "Summarize",
    repositories: ["https://github.com/example/web"],
    requestedBy: userId,
    contextHash: await storage.ampContextHash(task.id, orgId),
  };
  await storage.queueAmpRun(params);
  await storage.claimAmpStart(task.id, orgId, params.runId);
  await storage.update(
    task.id,
    orgId,
    { description: "The issue affects only mobile", status: "todo" },
    userId,
  );
  await storage.projectAmpRun({
    ...params,
    state: "completed",
    body: "Old summary",
    result: "All devices are affected",
  });
  const current = await storage.getById(task.id, orgId);
  expect(current?.status).toBe("todo");
  expect(current?.ampRun?.summary).toBeNull();
  await storage.queueAmpRun({
    ...params,
    phase: "planning",
    runId: randomUUID(),
    contextHash: await storage.ampContextHash(task.id, orgId),
  });
  expect((await storage.getAmpRun(task.id, orgId))?.phase).toBe("planning");
});

test("a current customer draft hands Backlog to QA once, preserving ownership and human moves", async () => {
  const result =
    "The setting already exists.\n\n## Customer message\n\n```customer-message\nHello, you can edit this in the CMS.\n```";
  for (const scenario of [
    "ready",
    "legacy",
    "no-draft",
    "failed",
    "stale",
    "moved",
    "oversized",
  ] as const) {
    const task = await storage.create({
      organizationId: orgId,
      title: "Customer handoff",
      status: "triage",
      assigneeId: userId,
      by: userId,
    });
    const params = {
      taskId: task.id,
      organizationId: orgId,
      runId: randomUUID(),
      phase: "summary" as const,
      prompt: "Summarize",
      repositories: ["https://github.com/example/web"],
      requestedBy: userId,
      contextHash: await storage.ampContextHash(task.id, orgId),
    };
    await storage.queueAmpRun(params);
    await storage.claimAmpStart(task.id, orgId, params.runId);
    await storage.projectAmpRun({
      ...params,
      state: "running",
      body: result,
      result,
    });
    expect((await storage.getById(task.id, orgId))?.status).toBe("triage");
    if (scenario === "stale")
      await storage.update(
        task.id,
        orgId,
        { description: "Changed request" },
        userId,
      );
    if (scenario === "moved")
      await storage.update(task.id, orgId, { status: "todo" }, userId);
    const output =
      scenario === "no-draft"
        ? "A code change is needed."
        : scenario === "oversized"
          ? "x".repeat(10_001) + result
          : scenario === "legacy"
            ? result.replace("customer-message", "text")
            : result;
    expect(
      await storage.projectAmpRun({
        ...params,
        organizationId: "other-org",
        state: "completed",
        body: output,
        result: output,
      }),
    ).toBe(false);
    await storage.projectAmpRun({
      ...params,
      state: scenario === "failed" ? "failed" : "completed",
      body: output,
      result: output,
    });
    const current = await storage.getById(task.id, orgId);
    expect(current?.status).toBe(
      scenario === "ready" || scenario === "legacy"
        ? "qa"
        : scenario === "moved"
          ? "todo"
          : "triage",
    );
    expect(current?.assigneeId).toBe(userId);
    if (scenario === "stale") expect(current?.ampRun?.summary).toBeNull();
    if (scenario === "ready") {
      expect(current?.ampRun?.summary).toBe(result);
      await storage.update(task.id, orgId, { status: "triage" }, userId);
      expect(
        await storage.projectAmpRun({
          ...params,
          state: "completed",
          body: result,
          result,
        }),
      ).toBe(false);
      expect((await storage.getById(task.id, orgId))?.status).toBe("triage");
    }
  }
});

test("PR review preserves the approved plan, deduplicates a head revision and never advances or reassigns the card", async () => {
  const { task, params, plan } = await plannedTask();
  const implementationId = randomUUID();
  await storage.queueAmpRun({
    ...params,
    runId: implementationId,
    phase: "implementation",
    approvedPlanRunId: params.runId,
  });
  const pr = {
    url: "https://github.com/example/web/pull/7",
    number: 7,
    repo: {
      provider: "github" as const,
      host: "github.com",
      path: "example/web",
    },
  };
  await storage.projectAmpRun({
    ...params,
    runId: implementationId,
    state: "completed",
    body: "Ready",
    prs: [pr],
  });
  const review = {
    ...params,
    runId: randomUUID(),
    phase: "review" as const,
    reviewKey: "head-1",
    reviewTargets: [{ url: pr.url, headSha: "a".repeat(40) }],
  };
  const attempts = await Promise.all([
    storage.queueAmpRun(review),
    storage.queueAmpRun({ ...review, runId: randomUUID() }),
  ]);
  expect(attempts[0]?.run_id).toBe(attempts[1]?.run_id);
  const run = (await storage.getAmpRun(task.id, orgId))!;
  expect(run.thread_id).toBeNull();
  expect(run.plan_text).toBe(plan);
  expect(run.plan_run_id).toBe(params.runId);
  expect(run.approved_by).toBe(userId);
  expect(run.approved_at).toBeTruthy();
  await storage.claimAmpStart(task.id, orgId, run.run_id);
  await storage.projectAmpRun({
    ...review,
    runId: run.run_id,
    state: "running",
    body: "Running the test plan",
  });
  expect((await storage.getById(task.id, orgId))?.status).toBe("in_review");
  const report =
    "Case 1 PASS: parser rejects invalid input. Browser check BLOCKED: preview unavailable.";
  await storage.projectAmpRun({
    ...review,
    runId: run.run_id,
    state: "completed",
    body: report,
    result: report,
  });
  expect((await storage.getById(task.id, orgId))?.ampRun?.review).toBe(report);
  expect((await storage.getById(task.id, orgId))?.status).toBe("in_review");
  expect(
    (await storage.queueAmpRun({ ...review, runId: randomUUID() }))?.run_id,
  ).toBe(run.run_id);
  const changedHead = await storage.queueAmpRun({
    ...review,
    runId: randomUUID(),
    reviewKey: "head-2",
    reviewTargets: [{ url: pr.url, headSha: "b".repeat(40) }],
  });
  expect(changedHead?.review_text).toBeNull();
  await storage.update(
    task.id,
    orgId,
    { status: "qa", assigneeId: userId },
    userId,
  );
  await storage.projectAmpRun({
    ...review,
    runId: changedHead!.run_id,
    state: "failed",
    body: "Lost browser session",
  });
  expect((await storage.getById(task.id, orgId))?.status).toBe("qa");
  expect((await storage.getById(task.id, orgId))?.assigneeId).toBe(userId);
});

test("empty or oversized auxiliary results fail closed and a manual retry clears the old report", async () => {
  for (const result of ["", "x".repeat(10_001)]) {
    const task = await storage.create({
      organizationId: orgId,
      title: "Summary bounds",
      status: "triage",
      by: userId,
    });
    const params = {
      taskId: task.id,
      organizationId: orgId,
      runId: randomUUID(),
      phase: "summary" as const,
      prompt: "Summarize",
      repositories: ["https://github.com/example/web"],
      requestedBy: userId,
      contextHash: await storage.ampContextHash(task.id, orgId),
    };
    await storage.queueAmpRun(params);
    await storage.projectAmpRun({
      ...params,
      state: "completed",
      result,
      body: result,
    });
    expect((await storage.getAmpRun(task.id, orgId))?.state).toBe("failed");
    const retry = await storage.queueAmpRun({
      ...params,
      runId: randomUUID(),
      force: true,
    });
    expect(retry?.state).toBe("queued");
    expect(retry?.summary_text).toBeNull();
    expect(
      await storage.projectAmpRun({
        ...params,
        state: "completed",
        result: "Stale",
        body: "Stale",
      }),
    ).toBe(false);
  }
});
