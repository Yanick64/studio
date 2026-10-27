import { expect, test } from "bun:test";
import {
  OrbitTicketDetailSchema,
  OrbitTicketCommentsSchema,
  OrbitTicketSearchSchema,
  orbitTicketMatch,
  orbitResultJson,
  renderOrbitContext,
  orbitDescriptionWithContext,
} from "./orbit-context";

const identity = {
  ticketId: "TKexample",
  number: "123",
  clientId: "client-example",
};

test("resolves an exact ticket number and client, rejecting ambiguous and partial matches", () => {
  const result = OrbitTicketSearchSchema.parse({
    tickets: [identity, { ...identity, number: "1234" }],
  });
  expect(orbitTicketMatch(result, "123", "client-example")).toBe("TKexample");
  expect(() => orbitTicketMatch(result, "123", "other-client")).toThrow();
  expect(() => orbitTicketMatch({ tickets: [] }, "123")).toThrow();
  expect(() =>
    orbitTicketMatch({ tickets: [identity, identity] }, "123"),
  ).toThrow();
});

test("parses both MCP result shapes and rejects Orbit's unflagged text errors", () => {
  expect(
    orbitResultJson({
      content: [{ type: "text", text: JSON.stringify(identity) }],
    }),
  ).toEqual(identity);
  expect(orbitResultJson({ structuredContent: identity })).toEqual(identity);
  expect(() =>
    orbitResultJson({ isError: true, structuredContent: identity }),
  ).toThrow();
  expect(() =>
    orbitResultJson({
      content: [{ type: "text", text: "Error: invalid api_id" }],
    }),
  ).toThrow();
  expect(() => orbitResultJson({ content: [] })).toThrow();
  expect(() =>
    orbitResultJson({
      content: [{ type: "text", text: "x".repeat(1_000_001) }],
    }),
  ).toThrow();
});

test("renders history and attachment names without persisting download credentials or executable markup", () => {
  const detail = OrbitTicketDetailSchema.parse({
    ...identity,
    description: "<img src=x> ![track](https://example.com/track)",
    attachments: [
      {
        name: "example.png",
        sizeBytes: 123,
        downloadUrl: "https://example.com/file?token=secret-fixture",
      },
    ],
  });
  const history = OrbitTicketCommentsSchema.parse({
    ticketId: identity.ticketId,
    comments: [
      {
        author: "Example author",
        date: "2026-01-01",
        isInternal: true,
        content: "Original request",
      },
    ],
  });
  const rendered = renderOrbitContext(detail, history);
  expect(rendered).toContain("Original request");
  expect(rendered).toContain("Internal");
  expect(rendered).toContain("example.png");
  expect(rendered).not.toContain("secret-fixture");
  expect(rendered).not.toContain("<img");
  expect(rendered).not.toContain("![track]");
  expect(() =>
    renderOrbitContext(detail, { ...history, ticketId: "TKother" }),
  ).toThrow();
});

test("bounds oversized context and handles an empty ticket", () => {
  const detail = OrbitTicketDetailSchema.parse(identity);
  expect(
    renderOrbitContext(detail, { ticketId: identity.ticketId, comments: [] }),
  ).toContain("Orbit");
  const rendered = renderOrbitContext(
    { ...detail, description: "x".repeat(200_000) },
    {
      ticketId: identity.ticketId,
      comments: [{ isInternal: false, content: "y".repeat(200_000) }],
    },
  );
  expect(rendered.length).toBeLessThanOrEqual(40_000);
  expect(rendered).toContain("omitted");
});

test("failed refresh retains the previous context; recovery replaces the warning", () => {
  const original = orbitDescriptionWithContext("Source", "Saved context");
  const failed = orbitDescriptionWithContext(original, null);
  expect(failed).toContain("Saved context");
  expect(failed).toContain("refresh failed");
  expect(orbitDescriptionWithContext(failed, null)).toBe(failed);
  const recovered = orbitDescriptionWithContext(failed, "Fresh context");
  expect(recovered).not.toContain("Saved context");
  expect(recovered).not.toContain("refresh failed");
  expect(recovered).toContain("Fresh context");
});
