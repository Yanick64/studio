import { createServer } from "node:http";
import { signUpViaApi } from "../fixtures/auth-api";
import { callSelfMcpTool } from "../fixtures/mcp-tools";
import { expect, getE2EAppOrigin, test } from "../fixtures/test";

test.use({ extraHTTPHeaders: { Origin: getE2EAppOrigin() } });

for (const scenario of [
  { status: 403, oauth: true, expected: 401 },
  { status: 403, oauth: false, expected: 403 },
  { status: 401, oauth: true, expected: 401 },
  { status: 500, oauth: true, expected: 500 },
]) {
  test(`upstream ${scenario.status}, OAuth ${scenario.oauth}`, async ({
    request,
  }) => {
    const origin = createServer((req, res) => {
      req.resume();
      res.statusCode = scenario.status;
      if (scenario.oauth) {
        res.setHeader(
          "WWW-Authenticate",
          'Bearer resource_metadata="https://example.com/.well-known/oauth-protected-resource"',
        );
      }
      res.end("Upstream denied the request");
    });
    await new Promise<void>((resolve) =>
      origin.listen(0, "127.0.0.1", resolve),
    );
    const address = origin.address();
    if (!address || typeof address === "string") throw new Error("No port");
    try {
      const user = await signUpViaApi(request);
      const { item } = await callSelfMcpTool<{ item: { id: string } }>(
        request,
        user.orgSlug,
        "COLLECTION_CONNECTIONS_CREATE",
        {
          data: {
            title: "OAuth challenge fixture",
            connection_type: "HTTP",
            connection_url: `http://127.0.0.1:${address.port}/mcp`,
          },
        },
      );
      // Repeated auth failures must keep offering sign-in, not open the circuit.
      const attempts = scenario.expected === 401 ? 6 : 1;
      for (let attempt = 0; attempt < attempts; attempt++) {
        const response = await request.post(
          `/api/${user.orgSlug}/mcp/${item.id}`,
          {
            headers: { Accept: "application/json, text/event-stream" },
            data: {
              jsonrpc: "2.0",
              id: 1,
              method: "initialize",
              params: {
                protocolVersion: "2025-06-18",
                capabilities: {},
                clientInfo: { name: "auth-challenge-test", version: "1" },
              },
            },
          },
        );
        expect(response.status()).toBe(scenario.expected);
        const challenge = response.headers()["www-authenticate"];
        if (scenario.expected === 401) {
          expect(challenge).toContain(
            `/api/${user.orgSlug}/mcp/${item.id}/.well-known/oauth-protected-resource`,
          );
        } else {
          expect(challenge).toBeUndefined();
        }
      }
    } finally {
      origin.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        origin.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
}
