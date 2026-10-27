import { expect, test } from "bun:test";
import {
  AmpExport,
  AmpEvent,
  ampPrLinks,
  ampRecoveredResult,
  ampRepository,
  ampText,
  ampProjectCandidates,
  selectAmpTeamProject,
  assertAmpTeamContinuation,
} from "./amp-protocol";

const repository = "https://github.com/example/web";
const personalProject = {
  id: "project-personal",
  namespace: "personal",
  name: "web",
  repositoryURL: repository,
  remoteURLs: [],
  owner: { type: "user", userID: "user-example" },
};
const teamProject = {
  ...personalProject,
  id: "project-team",
  namespace: "team",
  owner: { type: "workspace", workspaceID: "workspace-example" },
};

test("matching personal and team projects always resolves to the team", () => {
  expect(
    ampProjectCandidates([personalProject, teamProject], repository),
  ).toEqual(["project-personal", "project-team"]);
  expect(
    selectAmpTeamProject([personalProject, teamProject], repository),
  ).toEqual({
    id: "project-team",
    reference: "team/web",
    workspaceId: "workspace-example",
  });
  expect(
    selectAmpTeamProject([teamProject, personalProject], repository).id,
  ).toBe("project-team");
});

test("team selection never falls back to personal projects or guesses between teams", () => {
  expect(() => selectAmpTeamProject([personalProject], repository)).toThrow(
    "No Amp team project",
  );
  expect(() => selectAmpTeamProject([], repository)).toThrow(
    "No Amp team project",
  );
  expect(() =>
    selectAmpTeamProject(
      [teamProject, { ...teamProject, id: "another-team" }],
      repository,
    ),
  ).toThrow("Multiple Amp team projects");
  expect(() =>
    selectAmpTeamProject([teamProject], "https://github.com/example/api"),
  ).toThrow("No Amp team project");
  expect(() =>
    selectAmpTeamProject(
      [{ ...teamProject, owner: { type: "workspace" } }],
      repository,
    ),
  ).toThrow();
});

test("project matching normalizes GitHub URLs, includes aliases and deduplicates IDs", () => {
  const alias = {
    ...teamProject,
    repositoryURL: "https://github.com/example/renamed",
    remoteURLs: [repository + ".git"],
  };
  expect(
    ampProjectCandidates(
      [
        alias,
        alias,
        {
          ...personalProject,
          repositoryURL: "https://secret@github.com/example/web",
        },
      ],
      repository.toUpperCase(),
    ),
  ).toEqual(["project-team"]);
  expect(selectAmpTeamProject([alias], repository).id).toBe("project-team");
  expect(() => ampProjectCandidates({}, repository)).toThrow();
});

test("continuations require the selected team project and a remote Orb", () => {
  const selected = selectAmpTeamProject([teamProject], repository);
  const thread = {
    id: "T-example-12345678",
    meta: {
      projectID: selected.id,
      workspaceID: selected.workspaceId,
      executorType: "sandbox",
    },
  };
  expect(() =>
    assertAmpTeamContinuation(thread, thread.id, selected),
  ).not.toThrow();
  for (const meta of [
    { ...thread.meta, projectID: personalProject.id },
    { ...thread.meta, workspaceID: "another-workspace" },
    { ...thread.meta, executorType: "local-client" },
    {},
  ])
    expect(() =>
      assertAmpTeamContinuation({ ...thread, meta }, thread.id, selected),
    ).toThrow();
});

test("repository selection rejects credentials, non-GitHub hosts and URL suffixes", () => {
  expect(ampRepository("https://github.com/example/web.git")).toBe(
    "https://github.com/example/web",
  );
  for (const url of [
    "https://secret@github.com/example/web",
    "https://github.com.evil.test/example/web",
    "file:///repo",
    "https://github.com/example/web?token=secret",
    "https://github.com/example/web/tree/main",
  ]) {
    expect(() => ampRepository(url)).toThrow();
  }
});

test("only project PRs from output are linked and duplicates collapse", () => {
  const url = "https://github.com/example/web/pull/7";
  expect(
    ampPrLinks(`${url}\n${url}\nhttps://github.com/other/repo/pull/8`, [
      "https://github.com/example/web",
    ]),
  ).toEqual([{ url, number: 7, repo: "example/web" }]);
  expect(
    ampText({
      type: "user",
      message: { content: [{ type: "text", text: "private tool output" }] },
    }),
  ).toBeNull();
});

test("an incomplete result or invalid thread identity cannot finish a run", () => {
  expect(AmpEvent.safeParse({ type: "result", result: "Done" }).success).toBe(
    false,
  );
  expect(
    AmpEvent.safeParse({ type: "system", session_id: "https://example.test" })
      .success,
  ).toBe(false);
  expect(
    AmpEvent.safeParse({
      type: "result",
      session_id: "T-example-12345678",
      is_error: false,
      result: "Done",
    }).success,
  ).toBe(true);
});

test("recovery never mistakes the previous turn or an unfinished turn for this run's result", () => {
  const data = AmpExport.parse({
    id: "T-example-12345678",
    meta: { lastKnownAgentState: { state: "idle" } },
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: "Studio run previous" }],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "Done" }],
        state: { type: "complete", stopReason: "end_turn" },
      },
    ],
  });
  expect(ampRecoveredResult(data, "current")).toBeNull();
  expect(ampRecoveredResult(data, "previous")).toBe("Done");
  expect(
    ampRecoveredResult(
      { ...data, meta: { lastKnownAgentState: { state: "running" } } },
      "previous",
    ),
  ).toBeNull();
  data.messages.push({
    role: "user",
    content: [{ type: "text", text: "Studio run current" }],
  });
  expect(ampRecoveredResult(data, "current")).toBeNull();
});
