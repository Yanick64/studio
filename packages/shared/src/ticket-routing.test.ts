import { expect, test } from "bun:test";
import {
  EmailRoutingRulesSchema,
  SentryProjectsSchema,
  matchesEmailRules,
  ticketProject,
} from "./ticket-routing";

test("Google Mail rules match addresses case-insensitively without evaluating message text", () => {
  expect(
    matchesEmailRules(["SUPPORT@example.test"], ["support@example.test"]),
  ).toBe(true);
  expect(
    matchesEmailRules(["/@customer\\.test$/"], ["person@CUSTOMER.test"]),
  ).toBe(true);
  expect(
    matchesEmailRules(
      ["/@customer\\.test$/"],
      ["person@customer.test.attacker.test"],
    ),
  ).toBe(false);
  expect(
    matchesEmailRules(
      ["person@customer.test"],
      ["Display <person@customer.test>"],
    ),
  ).toBe(false);
  expect(
    matchesEmailRules(["/(a+)+$/"], ["a".repeat(200) + "@example.test"]),
  ).toBe(false);
});

test("routing validates unsupported regex, duplicate rules and maximum counts", () => {
  expect(EmailRoutingRulesSchema.safeParse(["/\\d/", "/\\D/"]).success).toBe(
    true,
  );
  for (const rules of [
    [""],
    ["/(/"],
    ["/(?<=@)example/"],
    ["/x/i"],
    ["x@example.test", "X@example.test"],
    Array.from({ length: 51 }, (_, i) => `user${i}@example.test`),
  ]) {
    expect(EmailRoutingRulesSchema.safeParse(rules).success).toBe(false);
  }
  expect(
    SentryProjectsSchema.safeParse(["example/web", "example/web"]).success,
  ).toBe(false);
  expect(SentryProjectsSchema.safeParse(["example"]).success).toBe(false);
});

test("only one active project routes a ticket; ambiguous, missing and inactive matches stay in intake", () => {
  const project = {
    id: "one",
    status: "active",
    metadata: {
      emailRoutingRules: ["person@example.test"],
      sentryProjects: ["example/web"],
    },
  };
  expect(
    ticketProject([project], {
      kind: "gmail",
      addresses: ["person@example.test"],
    })?.id,
  ).toBe("one");
  expect(
    ticketProject([project, { ...project, id: "two" }], {
      kind: "gmail",
      addresses: ["person@example.test"],
    }),
  ).toBeUndefined();
  expect(
    ticketProject([{ ...project, status: "inactive" }], {
      kind: "gmail",
      addresses: ["person@example.test"],
    }),
  ).toBeUndefined();
  expect(
    ticketProject([project], { kind: "sentry", project: "example/web" })?.id,
  ).toBe("one");
  expect(
    ticketProject([project], { kind: "sentry", project: "other/web" }),
  ).toBeUndefined();
});
