import { describe, expect, test } from "bun:test";
import { parseWebhookPayload } from "./webhook-payload";

describe("parseWebhookPayload", () => {
  test("decodes Orbit fields without splitting dotted names or coercing IDs", () => {
    expect(
      parseWebhookPayload(
        "TICKET.ID=00123&TICKET.NAME=Checkout+%26+betaling&TICKET.STATE=OPEN&ENTITY.NAME=Voorbeeld+BV&CONTACT.NAME=Zo%C3%AB",
        "application/x-www-form-urlencoded; charset=UTF-8",
      ),
    ).toEqual({
      "TICKET.ID": "00123",
      "TICKET.NAME": "Checkout & betaling",
      "TICKET.STATE": "OPEN",
      "ENTITY.NAME": "Voorbeeld BV",
      "CONTACT.NAME": "Zoë",
    });
  });

  test("retains repeated fields rather than silently selecting an identity", () => {
    expect(
      parseWebhookPayload(
        "TICKET.ID=123&TICKET.ID=456&TICKET.ID=789&EMPTY=",
        "application/x-www-form-urlencoded",
      ),
    ).toEqual({ "TICKET.ID": ["123", "456", "789"], EMPTY: "" });
  });

  test("treats prototype-like field names as data", () => {
    const payload = parseWebhookPayload(
      "__proto__=value&constructor=other",
      "application/x-www-form-urlencoded",
    );
    expect(Object.getPrototypeOf(payload)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(payload, "__proto__")?.value).toBe(
      "value",
    );
    expect(JSON.stringify(payload)).toBe(
      '{"__proto__":"value","constructor":"other"}',
    );
  });

  test.each(["application/json", undefined, "text/plain"])(
    "preserves JSON handling with content type %s",
    (contentType) => {
      expect(parseWebhookPayload('{"ticket":{"id":123}}', contentType)).toEqual(
        {
          ticket: { id: 123 },
        },
      );
      expect(parseWebhookPayload("[1,2]", contentType)).toEqual([1, 2]);
      expect(parseWebhookPayload("invalid", contentType)).toBeNull();
    },
  );

  test.each([
    "application/json",
    "application/x-www-form-urlencoded",
    undefined,
  ])("accepts an empty body with content type %s", (contentType) => {
    expect(parseWebhookPayload("", contentType)).toBeNull();
    expect(parseWebhookPayload("  ", contentType)).toBeNull();
  });
});
