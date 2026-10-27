import { describe, expect, test } from "bun:test";
import { OrbitTicketSchema, orbitTicketDraft } from "./orbit-ticket";
import { parseWebhookPayload } from "./webhook-payload";

const valid = {
  "TICKET.ID": "123",
  "TICKET.NAME": "Example ticket",
  "TICKET.STATE": "OPEN",
};

describe("Orbit ticket intake", () => {
  test("decodes form data and drops unrelated personal fields", () => {
    const ticket = OrbitTicketSchema.parse(
      parseWebhookPayload(
        "TICKET.ID=00123&TICKET.NAME=Test+%26+controle&TICKET.STATE=OPEN&CLIENT.ID=client-example&CONTACT.MAIL=person%40example.test",
        "application/x-www-form-urlencoded",
      ),
    );
    const draft = orbitTicketDraft(ticket);
    expect(draft.title).toBe("[Orbit #00123] Test & controle");
    expect(draft.description).toContain("client-example");
    expect(draft.description).not.toContain("person@example.test");
    expect(draft.description).not.toContain("CONTACT.MAIL");
  });

  test.each(
    [
      null,
      {},
      [],
      { ...valid, "TICKET.ID": "" },
      { ...valid, "TICKET.ID": ["123", "456"] },
      { ...valid, "TICKET.ID": "../123" },
      { ...valid, "TICKET.NAME": " " },
      { ...valid, "TICKET.NAME": "x".repeat(401) },
      { ...valid, "TICKET.STATE": "" },
      { ...valid, "CLIENT.ID": "x".repeat(201) },
    ].map((payload) => ({ payload })),
  )("rejects invalid ticket %j", ({ payload }) => {
    expect(OrbitTicketSchema.safeParse(payload).success).toBe(false);
  });
});
