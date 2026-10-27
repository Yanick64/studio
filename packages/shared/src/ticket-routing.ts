import { RE2JS } from "re2js";
import { z } from "zod";

const email = z.email().max(254);

function compileRule(rule: string): RE2JS | null {
  if (!rule.startsWith("/") || !rule.endsWith("/")) return null;
  const expression = RE2JS.compile(rule.slice(1, -1), RE2JS.CASE_INSENSITIVE);
  if (expression.programSize() > 2_000)
    throw new Error("Pattern is too complex");
  return expression;
}

export const EmailRoutingRuleSchema = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .refine((rule) => {
    try {
      return rule.startsWith("/")
        ? rule.length > 2 && compileRule(rule) !== null
        : email.safeParse(rule).success;
    } catch {
      return false;
    }
  }, "Enter an email address or a supported /regex/ pattern");

export const EmailRoutingRulesSchema = z
  .array(EmailRoutingRuleSchema)
  .max(50)
  .refine(
    (rules) =>
      new Set(rules.map((rule) => rule.toLowerCase())).size === rules.length,
    "Duplicate email routing rule",
  );

export const SentryProjectsSchema = z
  .array(
    z
      .string()
      .trim()
      .regex(/^[a-z0-9_-]+\/[a-z0-9_-]+$/)
      .max(200),
  )
  .max(100)
  .refine(
    (projects) => new Set(projects).size === projects.length,
    "Duplicate Sentry project",
  );

/** Match addresses, never display names or message bodies. RE2 bounds matching time. */
export function matchesEmailRules(
  rules: string[],
  addresses: string[],
): boolean {
  const valid = addresses.filter((address) => email.safeParse(address).success);
  return rules.some((rule) => {
    if (!EmailRoutingRuleSchema.safeParse(rule).success) return false;
    const expression = compileRule(rule);
    return valid.some((address) =>
      expression
        ? expression.matcher(address).find()
        : address.toLowerCase() === rule.toLowerCase(),
    );
  });
}

export function ticketProject<
  T extends {
    status: string;
    metadata?: {
      emailRoutingRules?: string[] | null;
      sentryProjects?: string[] | null;
    } | null;
  },
>(
  projects: T[],
  source:
    | { kind: "gmail"; addresses: string[] }
    | { kind: "sentry"; project: string },
): T | undefined {
  const matches = projects.filter(
    (project) =>
      project.status === "active" &&
      (source.kind === "gmail"
        ? matchesEmailRules(
            project.metadata?.emailRoutingRules ?? [],
            source.addresses,
          )
        : project.metadata?.sentryProjects?.includes(source.project)),
  );
  return matches.length === 1 ? matches[0] : undefined;
}
