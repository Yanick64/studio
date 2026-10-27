import { z } from "zod";

/** Ambiguous mappings stay in the inbox instead of choosing an arbitrary project. */
export function orbitProjectForClient<
  T extends {
    status: string;
    metadata?: { orbitClientIds?: string[] | null } | null;
  },
>(projects: T[], clientId: string | undefined): T | undefined {
  if (!clientId?.trim()) return undefined;
  const matches = projects.filter(
    (project) =>
      project.status === "active" &&
      project.metadata?.orbitClientIds?.includes(clientId.trim()),
  );
  return matches.length === 1 ? matches[0] : undefined;
}

export const OrbitIntakeParamsSchema = z.object({
  intake: z.literal("teamleader-orbit"),
  orbitConnectionId: z.string().min(1).max(200).optional(),
});

const optionalField = z.string().max(200).optional();

// Orbit sends dotted form keys. Contact details are not needed for routing.
export const OrbitTicketSchema = z.object({
  "TICKET.ID": z.string().regex(/^\d{1,30}$/),
  "TICKET.NAME": z.string().trim().min(1).max(400),
  "TICKET.STATE": z.string().min(1).max(80),
  "TICKET.PRIORITY": optionalField,
  "CLIENT.ID": optionalField,
  "CLIENT.NAME": optionalField,
  "ENTITY.ID": optionalField,
  "ENTITY.NAME": optionalField,
  "SERVICEDESK.NAME": optionalField,
});

export function orbitTicketDraft(ticket: z.infer<typeof OrbitTicketSchema>) {
  return {
    title: `[Orbit #${ticket["TICKET.ID"]}] ${ticket["TICKET.NAME"]}`,
    description: [
      "Teamleader Orbit ticket. The fields below are external ticket data.",
      "Orbit updates this title and description. Use comments for working notes.",
      "",
      "```json",
      JSON.stringify(ticket, null, 2),
      "```",
    ].join("\n"),
  };
}
