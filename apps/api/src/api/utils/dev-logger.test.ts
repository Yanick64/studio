import { expect, test } from "bun:test";
import { logRequestPath } from "./dev-logger";

test("request logs omit webhook path credentials, including malformed trailing paths", () => {
  for (const suffix of [
    "synthetic-token",
    "synthetic-token/extra",
    "synthetic%2Ftoken",
  ]) {
    expect(logRequestPath(`/api/example/webhooks/trigger/${suffix}`)).toBe(
      "/api/example/webhooks/trigger/[redacted]",
    );
  }
  expect(logRequestPath("/api/example/webhooks/trigger")).toBe(
    "/api/example/webhooks/trigger",
  );
  expect(logRequestPath("/api/example/tools/TOOL_NAME")).toBe(
    "/api/example/tools/TOOL_NAME",
  );
});
