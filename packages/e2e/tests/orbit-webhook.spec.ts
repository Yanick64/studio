import { signUpViaApi } from "../fixtures/auth-api";
import { callSelfMcpTool } from "../fixtures/mcp-tools";
import { expect, getE2EAppOrigin, test } from "../fixtures/test";

test.use({ extraHTTPHeaders: { Origin: getE2EAppOrigin() } });

test("Orbit client routing follows editable project settings without moving existing work", async ({
  request,
  playwright,
}, testInfo) => {
  const user = await signUpViaApi(request);
  const call = <T>(name: string, args: unknown) =>
    callSelfMcpTool<T>(request, user.orgSlug, name, args);
  const createProject = async (title: string, clientIds: string[]) => {
    const { item } = await call<{ item: { id: string } }>(
      "COLLECTION_VIRTUAL_MCP_CREATE",
      {
        data: {
          title,
          status: "active",
          pinned: false,
          connections: [],
          metadata: { orbitClientIds: clientIds },
        },
      },
    );
    return item;
  };
  const inbox = await createProject("Inbox", []);
  const project = await createProject("Example project", ["client-example"]);
  const repository = {
    url: "https://github.com/example/web",
    owner: "example",
    name: "web",
  };
  const additional = {
    url: "https://github.com/example/api",
    owner: "example",
    name: "api",
  };
  const { item: configured } = await call<{
    item: {
      metadata: {
        repository: typeof repository;
        additionalRepositories: (typeof additional)[];
        orbitClientIds: string[];
      };
    };
  }>("COLLECTION_VIRTUAL_MCP_UPDATE", {
    id: project.id,
    data: { metadata: { repository, additionalRepositories: [additional] } },
  });
  expect(configured.metadata).toMatchObject({
    repository,
    additionalRepositories: [additional],
    orbitClientIds: ["client-example"],
  });
  const automation = await call<{ id: string }>("AUTOMATION_CREATE", {
    name: "Intake",
    virtual_mcp_id: inbox.id,
    messages: "Receive tickets",
  });
  const trigger = await call<{ id: string; webhook: { token: string } }>(
    "AUTOMATION_TRIGGER_ADD",
    {
      automation_id: automation.id,
      type: "webhook",
      params: { intake: "teamleader-orbit" },
    },
  );
  const inbound = await playwright.request.newContext({
    baseURL: testInfo.project.use.baseURL,
  });
  const path = `/api/${user.orgSlug}/webhooks/${trigger.id}/${trigger.webhook.token}`;
  const send = async (id: string, client = "client-example") => {
    const response = await inbound.post(path, {
      form: {
        "TICKET.ID": id,
        "TICKET.NAME": "Example ticket",
        "TICKET.STATE": "OPEN",
        "CLIENT.ID": client,
      },
    });
    expect(response.status()).toBe(200);
    const result: { task_id: string } = await response.json();
    const board = await call<{ items: { id: string; virtualMcpId: string }[] }>(
      "TASK_BOARD_ITEM_LIST",
      {},
    );
    return board.items.find((item) => item.id === result.task_id)?.virtualMcpId;
  };
  try {
    expect(await send("1")).toBe(project.id);
    expect(await send("2", "unknown")).toBe(inbox.id);
    expect(await send("3", "")).toBe(inbox.id);
    await call("COLLECTION_VIRTUAL_MCP_UPDATE", {
      id: project.id,
      data: {
        metadata: {
          orbitClientIds: ["other-client"],
          additionalRepositories: [],
        },
      },
    });
    expect(await send("1")).toBe(project.id);
    expect(await send("4")).toBe(inbox.id);
    expect(await send("5", "other-client")).toBe(project.id);
    const duplicate = await createProject("Ambiguous destination", [
      "other-client",
    ]);
    expect(await send("6", "other-client")).toBe(inbox.id);
    await call("COLLECTION_VIRTUAL_MCP_DELETE", { id: duplicate.id });
    expect(await send("7", "other-client")).toBe(project.id);
    await call("COLLECTION_VIRTUAL_MCP_UPDATE", {
      id: project.id,
      data: { status: "inactive" },
    });
    expect(await send("8", "other-client")).toBe(inbox.id);
    await call("COLLECTION_VIRTUAL_MCP_UPDATE", {
      id: project.id,
      data: { status: "active", metadata: { orbitClientIds: [] } },
    });
    expect(await send("9", "other-client")).toBe(inbox.id);

    const key = await call<{ key: string }>("API_KEY_CREATE", {
      name: "Project editing only",
      permissions: { self: ["COLLECTION_VIRTUAL_MCP_UPDATE"] },
    });
    const denied = await inbound.post(
      `/api/${user.orgSlug}/tools/COLLECTION_VIRTUAL_MCP_UPDATE`,
      {
        headers: { Authorization: `Bearer ${key.key}` },
        data: {
          id: project.id,
          data: { metadata: { orbitClientIds: ["client-example"] } },
        },
      },
    );
    expect(denied.status()).toBe(403);
    for (const ids of [
      [""],
      ["duplicate", "duplicate"],
      Array.from({ length: 101 }, (_, i) => String(i)),
    ]) {
      const invalid = await request.post(
        `/api/${user.orgSlug}/tools/COLLECTION_VIRTUAL_MCP_UPDATE`,
        {
          data: { id: project.id, data: { metadata: { orbitClientIds: ids } } },
        },
      );
      expect(invalid.status()).toBe(400);
    }
  } finally {
    await inbound.dispose();
  }
});

test("Orbit intake persists tickets once and preserves local workflow state", async ({
  request,
  playwright,
}, testInfo) => {
  const user = await signUpViaApi(request);
  const call = <T>(name: string, args: unknown) =>
    callSelfMcpTool<T>(request, user.orgSlug, name, args);
  const { item: project } = await call<{ item: { id: string } }>(
    "COLLECTION_VIRTUAL_MCP_CREATE",
    {
      data: {
        title: "Orbit inbox",
        status: "active",
        pinned: false,
        connections: [],
      },
    },
  );
  const automation = await call<{ id: string }>("AUTOMATION_CREATE", {
    name: "Orbit ticket intake",
    virtual_mcp_id: project.id,
    messages: "Receive Orbit ticket data.",
  });
  const scoped = await playwright.request.newContext({
    baseURL: testInfo.project.use.baseURL,
  });
  try {
    for (const permission of [
      "TASK_BOARD_ITEM_CREATE",
      "TASK_BOARD_ITEM_UPDATE",
    ]) {
      const key = await call<{ key: string }>("API_KEY_CREATE", {
        name: `Incomplete intake permissions ${permission}`,
        permissions: { self: ["AUTOMATION_TRIGGER_ADD", permission] },
      });
      const denied = await scoped.post(
        `/api/${user.orgSlug}/tools/AUTOMATION_TRIGGER_ADD`,
        {
          headers: { Authorization: `Bearer ${key.key}` },
          data: {
            automation_id: automation.id,
            type: "webhook",
            params: { intake: "teamleader-orbit" },
          },
        },
      );
      expect(denied.status()).toBe(403);
    }
  } finally {
    await scoped.dispose();
  }
  const trigger = await call<{ id: string; webhook: { token: string } }>(
    "AUTOMATION_TRIGGER_ADD",
    {
      automation_id: automation.id,
      type: "webhook",
      params: { intake: "teamleader-orbit" },
    },
  );
  const inbound = await playwright.request.newContext({
    baseURL: testInfo.project.use.baseURL,
  });
  const path = `/api/${user.orgSlug}/webhooks/${trigger.id}`;
  const headers = { Authorization: `Bearer ${trigger.webhook.token}` };
  const form = {
    "TICKET.ID": "123",
    "TICKET.NAME": "Checkout & payment",
    "TICKET.STATE": "OPEN",
    "CLIENT.ID": "client-example",
    "CONTACT.MAIL": "person@example.test",
  };
  try {
    expect((await inbound.post(path, { form })).status()).toBe(401);
    expect(
      (
        await inbound.post(path, {
          form,
          headers: { Authorization: "Bearer invalid" },
        })
      ).status(),
    ).toBe(401);
    expect((await inbound.post(path, { form: {}, headers })).status()).toBe(
      400,
    );
    expect(
      (
        await inbound.post(path, {
          data: "TICKET.ID=123&TICKET.ID=456&TICKET.NAME=Test&TICKET.STATE=OPEN",
          headers: {
            ...headers,
            "Content-Type": "application/x-www-form-urlencoded",
          },
        })
      ).status(),
    ).toBe(400);
    expect(
      (
        await inbound.post(path, { data: "x".repeat(1_048_577), headers })
      ).status(),
    ).toBe(413);

    const replies = await Promise.all(
      Array.from({ length: 6 }, () => inbound.post(path, { form, headers })),
    );
    for (const reply of replies) expect(reply.status()).toBe(200);
    const results: { task_id: string; outcome: string }[] = await Promise.all(
      replies.map((reply) => reply.json()),
    );
    expect(new Set(results.map((result) => result.task_id)).size).toBe(1);
    expect(
      results.filter((result) => result.outcome === "created"),
    ).toHaveLength(1);
    const taskId = results[0]!.task_id;

    interface Card {
      id: string;
      title: string;
      description: string;
      status: string;
      virtualMcpId: string | null;
    }
    const board = await call<{ items: Card[] }>("TASK_BOARD_ITEM_LIST", {});
    expect(board.items).toHaveLength(1);
    expect(board.items[0]).toMatchObject({
      id: taskId,
      status: "triage",
      virtualMcpId: project.id,
    });
    expect(board.items[0]!.description).not.toContain("person@example.test");

    await call("TASK_BOARD_ITEM_UPDATE", {
      id: taskId,
      status: "todo",
      virtualMcpId: null,
    });
    const changed = await inbound.post(path, {
      form: {
        ...form,
        "TICKET.NAME": "Updated ticket",
        "TICKET.STATE": "CLOSED",
      },
      headers,
    });
    expect(changed.status()).toBe(200);
    expect(await changed.json()).toMatchObject({
      task_id: taskId,
      outcome: "updated",
    });
    const updated = await call<{ items: Card[] }>("TASK_BOARD_ITEM_LIST", {});
    expect(updated.items[0]).toMatchObject({
      id: taskId,
      status: "todo",
      virtualMcpId: null,
      title: "[Orbit #123] Updated ticket",
    });

    const other = await playwright.request.newContext({
      baseURL: testInfo.project.use.baseURL,
      extraHTTPHeaders: { Origin: getE2EAppOrigin() },
    });
    try {
      const otherUser = await signUpViaApi(other);
      expect(
        (
          await inbound.post(
            `/api/${otherUser.orgSlug}/webhooks/${trigger.id}`,
            { form, headers },
          )
        ).status(),
      ).toBe(403);
    } finally {
      await other.dispose();
    }

    const rotated = await call<{ token: string }>(
      "AUTOMATION_TRIGGER_ROTATE_TOKEN",
      { trigger_id: trigger.id },
    );
    expect((await inbound.post(path, { form, headers })).status()).toBe(401);
    expect(
      (await inbound.post(`${path}/${rotated.token}`, { form })).status(),
    ).toBe(200);

    await call("AUTOMATION_UPDATE", { id: automation.id, active: false });
    const paused = await inbound.post(`${path}/${rotated.token}`, {
      form: { ...form, "TICKET.ID": "456" },
    });
    expect(await paused.json()).toMatchObject({
      ok: false,
      reason: "automation_inactive",
    });
    expect(
      (await call<{ items: Card[] }>("TASK_BOARD_ITEM_LIST", {})).items,
    ).toHaveLength(1);
  } finally {
    await inbound.dispose();
  }
});
