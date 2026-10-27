import { z } from "zod";
import { serializePayload } from "@/storage/thread-message-parts";

export const AmpThreadId = z.string().regex(/^T-[a-zA-Z0-9-]{10,100}$/);
const block = z.object({ type: z.string(), text: z.string().optional() });
export const AmpEvent = z
  .object({
    type: z.string(),
    session_id: AmpThreadId.optional(),
    message: z.object({ content: z.array(block) }).optional(),
    result: z.string().optional(),
    is_error: z.boolean().optional(),
  })
  .superRefine((event, ctx) => {
    if (
      event.type === "result" &&
      (event.is_error === undefined || !event.session_id)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Amp result lacks its terminal state or thread identity",
      });
    }
  });
export const AmpExport = z.object({
  id: AmpThreadId,
  meta: z.object({
    lastKnownAgentState: z.object({ state: z.string() }).optional(),
  }),
  messages: z.array(
    z.object({
      role: z.string(),
      content: z.array(block),
      state: z
        .object({ type: z.string(), stopReason: z.string().optional() })
        .optional(),
    }),
  ),
});

export function ampRepository(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\/[\w.-]+\/[\w.-]+\/?$/.test(url.pathname)
  ) {
    throw new Error(
      "Amp tasks require credential-free GitHub repository URLs.",
    );
  }
  return `https://github.com${url.pathname.replace(/\/$/, "").replace(/\.git$/, "")}`;
}

const projectIdentity = z.object({
  id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,199}$/),
  namespace: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/),
  name: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/),
  repositoryURL: z.string().max(2_000),
  remoteURLs: z.array(z.string().max(2_000)).max(100).default([]),
});

export const AmpProject = projectIdentity.extend({
  owner: z.discriminatedUnion("type", [
    z.object({
      type: z.literal("workspace"),
      workspaceID: z.string().min(1).max(200),
    }),
    z.object({ type: z.literal("user"), userID: z.string().min(1).max(200) }),
  ]),
});

export class AmpProjectSelectionError extends Error {}

function matchesAmpRepository(
  project: z.infer<typeof projectIdentity>,
  repository: string,
) {
  const expected = ampRepository(repository).toLowerCase();
  return [project.repositoryURL, ...project.remoteURLs].some((url) => {
    try {
      return ampRepository(url).toLowerCase() === expected;
    } catch {
      return false;
    }
  });
}

/** The list response omits ownership; fetch matching records by ID to inspect it. */
export function ampProjectCandidates(
  data: unknown,
  repository: string,
): string[] {
  const projects = z.array(projectIdentity).max(10_000).parse(data);
  return [
    ...new Set(
      projects
        .filter((p) => matchesAmpRepository(p, repository))
        .map((p) => p.id),
    ),
  ];
}

export function selectAmpTeamProject(data: unknown[], repository: string) {
  const matches = new Map<
    string,
    { id: string; reference: string; workspaceId: string }
  >();
  for (const project of z.array(AmpProject).max(100).parse(data)) {
    if (
      project.owner.type !== "workspace" ||
      !matchesAmpRepository(project, repository)
    )
      continue;
    matches.set(project.id, {
      id: project.id,
      reference: `${project.namespace}/${project.name}`,
      workspaceId: project.owner.workspaceID,
    });
  }
  if (matches.size === 0)
    throw new AmpProjectSelectionError(
      "No Amp team project is linked to this repository. Link a workspace project in Amp, then re-run the task.",
    );
  if (matches.size !== 1)
    throw new AmpProjectSelectionError(
      "Multiple Amp team projects match this repository. Make the repository mapping unique in Amp, then re-run the task.",
    );
  return [...matches.values()][0]!;
}

export function assertAmpTeamContinuation(
  data: unknown,
  threadId: string,
  project: ReturnType<typeof selectAmpTeamProject>,
): void {
  const thread = z
    .object({
      id: AmpThreadId,
      meta: z.object({
        projectID: z.string().nullish(),
        workspaceID: z.string().nullish(),
        executorType: z.string().optional(),
      }),
    })
    .parse(data);
  if (
    thread.id !== threadId ||
    thread.meta.projectID !== project.id ||
    thread.meta.workspaceID !== project.workspaceId ||
    thread.meta.executorType !== "sandbox"
  ) {
    throw new AmpProjectSelectionError(
      "The saved Amp thread is not an Orb in the selected team project. This run was not started.",
    );
  }
}

export function ampText(event: z.infer<typeof AmpEvent>): string | null {
  if (event.type === "result") return event.result ?? null;
  if (event.type !== "assistant") return null;
  return (
    event.message?.content
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("\n") || null
  );
}

/** Only a terminal assistant following THIS run's submitted prompt can settle it. */
export function ampRecoveredResult(
  data: z.infer<typeof AmpExport>,
  runId: string,
) {
  const index = data.messages.findLastIndex(
    (m) =>
      m.role === "user" &&
      m.content.some((b) => b.text?.includes(`Studio run ${runId}`)),
  );
  if (index < 0) return null;
  const tail = data.messages.slice(index + 1);
  const last = tail.at(-1);
  if (
    data.meta.lastKnownAgentState?.state !== "idle" ||
    last?.role !== "assistant" ||
    last.state?.type !== "complete" ||
    last.state.stopReason !== "end_turn"
  )
    return null;
  return last.content
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("\n");
}

export function ampPrLinks(text: string, repositories: string[]) {
  const allowed = new Set(repositories.map((r) => r.toLowerCase()));
  const links = new Map<
    string,
    { url: string; number: number; repo: string }
  >();
  for (const match of text.matchAll(
    /https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)\b/g,
  )) {
    if (!allowed.has(`https://github.com/${match[1]}`.toLowerCase())) continue;
    const number = Number(match[2]);
    if (Number.isSafeInteger(number) && number > 0)
      links.set(match[0], { url: match[0], number, repo: match[1]! });
  }
  return [...links.values()];
}

/** Used at the storage boundary, including recovered output. */
export function ampPersistedText(text: string): string {
  return z
    .string()
    .parse(JSON.parse(serializePayload(text.slice(0, 120_000))))
    .replace(/\bsgamp_[A-Za-z0-9_-]+/g, "[redacted]");
}
