import { createServer } from "node:http";
import { signUpViaApi } from "../fixtures/auth-api";
import { callSelfMcpTool } from "../fixtures/mcp-tools";
import { expect, getE2EAppOrigin, test } from "../fixtures/test";

test.use({ extraHTTPHeaders: { Origin: getE2EAppOrigin() } });

test("Orbit intake enriches, retains context on failure and rejects stale overlapping results", async ({
  request,
}) => {
  const identity = {
    ticketId: "TKexample",
    number: "123",
    clientId: "client-example",
  };
  let failed = false;
  let holdNext = false;
  let description = "Full ticket details";
  let release: (() => void) | undefined;
  let notifyHeld: (() => void) | undefined;
  const held = new Promise<void>((resolve) => {
    notifyHeld = resolve;
  });
  const tools = ["ListTickets", "GetTicketDetail", "ListTicketComments"];
  const origin = createServer(async (req, res) => {
    try {
      if (req.method !== "POST") {
        res.writeHead(200).end();
        return;
      }
      let body = "";
      for await (const chunk of req) body += chunk;
      const rpc = JSON.parse(body);
      if (rpc.method.startsWith("notifications/")) {
        res.writeHead(202).end();
        return;
      }
      let result: unknown;
      if (rpc.method === "initialize") {
        result = {
          protocolVersion: "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "Orbit fixture", version: "1" },
        };
      } else if (rpc.method === "tools/list") {
        result = {
          tools: tools.map((name) => ({
            name,
            inputSchema: { type: "object" },
            annotations: { readOnlyHint: true },
          })),
        };
      } else if (rpc.method === "tools/call") {
        let data: unknown;
        if (failed) {
          result = {
            content: [{ type: "text", text: "Error: Orbit unavailable" }],
          };
        } else {
          switch (rpc.params.name) {
            case "ListTickets":
              data = { tickets: [identity] };
              break;
            case "GetTicketDetail": {
              const captured = description;
              if (holdNext) {
                holdNext = false;
                await new Promise<void>((resolve) => {
                  release = resolve;
                  notifyHeld?.();
                });
              }
              data = {
                ...identity,
                description: captured,
                attachments: [
                  {
                    name: "screenshot.png",
                    sizeBytes: 123,
                    downloadUrl:
                      "https://example.com/file?token=secret-fixture",
                  },
                ],
              };
              break;
            }
            case "ListTicketComments":
              data = {
                ticketId: identity.ticketId,
                comments: [
                  {
                    author: "Example author",
                    isInternal: true,
                    content: "Steps to reproduce",
                  },
                ],
              };
              break;
            default:
              throw new Error("Unexpected tool");
          }
          result = { content: [{ type: "text", text: JSON.stringify(data) }] };
        }
      }
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result }));
    } catch {
      res.writeHead(500).end();
    }
  });
  await new Promise<void>((resolve) => origin.listen(0, "127.0.0.1", resolve));
  const address = origin.address();
  if (!address || typeof address === "string") throw new Error("No port");
  try {
    const user = await signUpViaApi(request);
    const call = <T>(name: string, args: unknown) =>
      callSelfMcpTool<T>(request, user.orgSlug, name, args);
    const { item: connection } = await call<{ item: { id: string } }>(
      "COLLECTION_CONNECTIONS_CREATE",
      {
        data: {
          title: "Orbit fixture",
          connection_type: "HTTP",
          connection_url: `http://127.0.0.1:${address.port}/mcp`,
        },
      },
    );
    const { item: project } = await call<{ item: { id: string } }>(
      "COLLECTION_VIRTUAL_MCP_CREATE",
      {
        data: {
          title: "Intake",
          status: "active",
          pinned: false,
          connections: [],
        },
      },
    );
    const automation = await call<{ id: string }>("AUTOMATION_CREATE", {
      name: "Orbit intake",
      virtual_mcp_id: project.id,
      messages: "Receive tickets",
    });
    const trigger = await call<{ id: string; webhook: { token: string } }>(
      "AUTOMATION_TRIGGER_ADD",
      {
        automation_id: automation.id,
        type: "webhook",
        params: {
          intake: "teamleader-orbit",
          orbitConnectionId: connection.id,
        },
      },
    );
    const deliver = async () => {
      const response = await request.post(
        `/api/${user.orgSlug}/webhooks/${trigger.id}`,
        {
          headers: { Authorization: `Bearer ${trigger.webhook.token}` },
          data: {
            "TICKET.ID": "123",
            "TICKET.NAME": "Example ticket",
            "TICKET.STATE": "OPEN",
            "CLIENT.ID": "client-example",
          },
        },
      );
      expect(response.status()).toBe(200);
      return response.json();
    };
    const first = await deliver();
    expect(first.context).toBe("updated");
    const read = async () => {
      const { items } = await call<{
        items: { id: string; description: string; status: string }[];
      }>("TASK_BOARD_ITEM_LIST", {});
      return items.find((item) => item.id === first.task_id)!;
    };
    expect((await read()).description).toContain("Steps to reproduce");
    expect((await read()).description).toContain("screenshot.png");
    expect((await read()).description).not.toContain("secret-fixture");
    expect((await deliver()).outcome).toBe("unchanged");
    await call("TASK_BOARD_ITEM_UPDATE", { id: first.task_id, status: "todo" });
    failed = true;
    expect((await deliver()).context).toBe("unavailable");
    const retained = await read();
    expect(retained.status).toBe("todo");
    expect(retained.description).toContain("Full ticket details");
    expect(retained.description).toContain("refresh failed");
    failed = false;
    holdNext = true;
    description = "Older details";
    const earlier = deliver();
    await held;
    description = "Newer details";
    expect((await deliver()).context).toBe("updated");
    release?.();
    expect((await earlier).context).toBe("superseded");
    const latest = await read();
    expect(latest.description).toContain("Newer details");
    expect(latest.description).not.toContain("Older details");
    expect(latest.description).not.toContain("refresh failed");
    expect(latest.status).toBe("todo");
  } finally {
    release?.();
    origin.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      origin.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
