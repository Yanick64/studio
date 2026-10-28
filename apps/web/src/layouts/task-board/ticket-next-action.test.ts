import { expect, test } from "bun:test";
import { ticketNextAction } from "./ticket-next-action";

const task = { status: "triage", virtualMcpId: "project-example" } as const;
const run = {
  runId: "run-example",
  phase: "summary",
  state: "completed",
  summary: "Findings\n\n```customer-message\nPlease confirm which page.\n```",
  plan: null,
  review: null,
  planRunId: null,
  approvedBy: null,
} as const;

test("manual tickets have a next action before any Amp run", () => {
  expect(ticketNextAction(task)).toBe("research");
  expect(ticketNextAction({ ...task, virtualMcpId: null })).toBe("route");
  expect(ticketNextAction({ ...task, status: "todo" })).toBe("preparePlan");
});

test("human lane changes take priority over an earlier customer draft", () => {
  expect(ticketNextAction({ ...task, ampRun: run })).toBe("customer");
  expect(ticketNextAction({ ...task, ampRun: run, status: "todo" })).toBe(
    "preparePlan",
  );
  expect(ticketNextAction({ ...task, ampRun: run, status: "in_review" })).toBe(
    "review",
  );
  expect(
    ticketNextAction({ ...task, ampRun: run, status: "customer_approval" }),
  ).toBe("customerResponse");
  expect(ticketNextAction({ ...task, ampRun: run, status: "done" })).toBe(
    "none",
  );
});

test("an active run waits, a failed run needs attention, and a completed plan needs approval", () => {
  expect(
    ticketNextAction({ ...task, ampRun: { ...run, state: "running" } }),
  ).toBe("wait");
  expect(
    ticketNextAction({ ...task, ampRun: { ...run, state: "failed" } }),
  ).toBe("failed");
  expect(
    ticketNextAction({
      ...task,
      status: "todo",
      ampRun: {
        ...run,
        phase: "planning",
        plan: "Plan",
        planRunId: "version-1",
      },
    }),
  ).toBe("plan");
  expect(
    ticketNextAction({
      ...task,
      status: "qa",
      ampRun: { ...run, phase: "implementation" },
    }),
  ).toBe("test");
  expect(ticketNextAction({ ...task, status: "ready_for_deployment" })).toBe(
    "deploy",
  );
  expect(ticketNextAction({ ...task, status: "post_deploy_validation" })).toBe(
    "validate",
  );
});

test("content recommendations distinguish internal research, clarification, settings and code", () => {
  for (const [resolution, expected] of [
    ["research", "research"],
    ["clarify", "clarify"],
    ["configure", "configure"],
    ["plan", "scopeCode"],
  ] as const) {
    expect(
      ticketNextAction({
        ...task,
        ampRun: {
          ...run,
          summary: `Verified findings\n<!-- ticket-action: ${resolution} -->`,
        },
      }),
    ).toBe(expected);
  }
  expect(
    ticketNextAction({
      ...task,
      ampRun: { ...run, summary: "<!-- ticket-action: implement -->" },
    }),
  ).toBe("summary");
  expect(
    ticketNextAction({
      ...task,
      ampRun: {
        ...run,
        summary:
          "<!-- ticket-action: plan -->\n<!-- ticket-action: clarify -->",
      },
    }),
  ).toBe("summary");
});
