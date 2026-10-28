import { createHmac } from "node:crypto";
import { signUpViaApi } from "../fixtures/auth-api";
import { callSelfMcpTool } from "../fixtures/mcp-tools";
import { expect, getE2EAppOrigin, test } from "../fixtures/test";

test.use({ extraHTTPHeaders: { Origin: getE2EAppOrigin() } });

test("Google Mail routes addresses, fences older history, and preserves human ownership", async ({
  request,
  playwright,
}, testInfo) => {
  const user = await signUpViaApi(request);
  const call = <T>(name: string, args: unknown) =>
    callSelfMcpTool<T>(request, user.orgSlug, name, args);
  const project = async (title: string, rules: string[]) =>
    (
      await call<{ item: { id: string } }>("COLLECTION_VIRTUAL_MCP_CREATE", {
        data: {
          title,
          status: "active",
          pinned: false,
          connections: [],
          metadata: { emailRoutingRules: rules },
        },
      })
    ).item;
  const inbox = await project("Mail inbox", []);
  const destination = await project("Customer project", [
    "/@customer\\.test$/",
  ]);
  const automation = await call<{ id: string }>("AUTOMATION_CREATE", {
    name: "Google Mail intake",
    virtual_mcp_id: inbox.id,
    messages: "Receive conversations",
  });
  const trigger = await call<{ id: string; webhook: { token: string } }>(
    "AUTOMATION_TRIGGER_ADD",
    {
      automation_id: automation.id,
      type: "webhook",
      params: { intake: "gmail", mailbox: "support@example.test" },
    },
  );
  const inbound = await playwright.request.newContext({
    baseURL: testInfo.project.use.baseURL,
  });
  const path = `/api/${user.orgSlug}/webhooks/${trigger.id}`;
  const payload = {
    mailbox: "support@example.test",
    threadId: "abc123",
    historyId: "9007199254740993",
    subject: "Explain this setting",
    messages: [
      {
        id: "message-1",
        date: "2026-10-27T10:00:00Z",
        from: "Person@customer.test",
        to: ["support@example.test"],
        cc: [],
        text: "How do I update the setting?",
      },
    ],
  };
  const send = (data: unknown) =>
    inbound.post(path, {
      data,
      headers: { Authorization: `Bearer ${trigger.webhook.token}` },
    });
  const read = async (id: string) =>
    (
      await call<{
        items: {
          id: string;
          title: string;
          description: string;
          status: string;
          assigneeId: string | null;
          virtualMcpId: string;
        }[];
      }>("TASK_BOARD_ITEM_LIST", {})
    ).items.find((item) => item.id === id);
  try {
    expect((await inbound.post(path, { data: payload })).status()).toBe(401);
    expect(
      (await send({ ...payload, mailbox: "other@example.test" })).status(),
    ).toBe(400);
    const created = await send(payload);
    expect(created.status()).toBe(200);
    const first = await created.json();
    expect(await read(first.task_id)).toMatchObject({
      virtualMcpId: destination.id,
      status: "triage",
    });
    const duplicate = await send(payload);
    expect(await duplicate.json()).toMatchObject({
      task_id: first.task_id,
      outcome: "unchanged",
    });
    await call("TASK_BOARD_ITEM_UPDATE", {
      id: first.task_id,
      status: "todo",
      assigneeId: user.userId,
      virtualMcpId: inbox.id,
    });
    const newer = await send({
      ...payload,
      historyId: "9007199254740995",
      subject: "New customer requirement",
    });
    expect(newer.status()).toBe(200);
    await send({
      ...payload,
      historyId: "9007199254740994",
      subject: "Stale requirement",
    });
    expect(await read(first.task_id)).toMatchObject({
      title: "New customer requirement",
      status: "todo",
      assigneeId: user.userId,
      virtualMcpId: inbox.id,
    });
    await project("Ambiguous project", ["person@customer.test"]);
    const ambiguous = await send({ ...payload, threadId: "def456" });
    expect(await read((await ambiguous.json()).task_id)).toMatchObject({
      virtualMcpId: inbox.id,
    });
    expect((await send({ ...payload, messages: [] })).status()).toBe(400);
    const denied = await inbound.post(
      `/api/other-organization/webhooks/${trigger.id}`,
      {
        data: payload,
        headers: { Authorization: `Bearer ${trigger.webhook.token}` },
      },
    );
    expect(denied.ok()).toBe(false);
  } finally {
    await inbound.dispose();
  }
});

test("Sentry verifies exact bytes before ingestion and shares issue identity across alerts", async ({
  request,
  playwright,
}, testInfo) => {
  const user = await signUpViaApi(request);
  const call = <T>(name: string, args: unknown) =>
    callSelfMcpTool<T>(request, user.orgSlug, name, args);
  const project = async (title: string, sentryProjects: string[]) =>
    (
      await call<{ item: { id: string } }>("COLLECTION_VIRTUAL_MCP_CREATE", {
        data: {
          title,
          status: "active",
          pinned: false,
          connections: [],
          metadata: { sentryProjects },
        },
      })
    ).item;
  const inbox = await project("Sentry inbox", []);
  const destination = await project("Error project", ["example/web"]);
  const secretValue = "synthetic-sentry-client-secret";
  const secret = await call<{ id: string }>("SECRET_CREATE", {
    scope: "organization",
    name: "sentry-intake",
    value: secretValue,
  });
  const automation = await call<{ id: string }>("AUTOMATION_CREATE", {
    name: "Sentry intake",
    virtual_mcp_id: inbox.id,
    messages: "Receive issues",
  });
  const trigger = await call<{ id: string; webhook: { token: string } }>(
    "AUTOMATION_TRIGGER_ADD",
    {
      automation_id: automation.id,
      type: "webhook",
      params: {
        intake: "sentry",
        sentryOrganization: "example",
        sentrySecretId: secret.id,
      },
    },
  );
  const inbound = await playwright.request.newContext({
    baseURL: testInfo.project.use.baseURL,
  });
  const path = `/api/${user.orgSlug}/webhooks/${trigger.id}/${trigger.webhook.token}`;
  const payload = {
    action: "created",
    data: {
      issue: {
        id: "123",
        title: "Failed request",
        project: { slug: "web" },
        web_url: "https://example.sentry.io/issues/123/",
        request: { headers: { Authorization: "must-not-be-stored" } },
      },
    },
  };
  const body = JSON.stringify(payload);
  const sign = (value: string) =>
    createHmac("sha256", secretValue).update(value).digest("hex");
  const send = (value: string, signature = sign(value), resource = "issue") =>
    inbound.post(path, {
      data: value,
      headers: {
        "content-type": "application/json",
        "sentry-hook-resource": resource,
        "sentry-hook-signature": signature,
      },
    });
  try {
    expect((await send(body, "0".repeat(64))).status()).toBe(401);
    expect((await send(body + "\n", sign(body))).status()).toBe(401);
    const created = await send(body);
    expect(created.status()).toBe(200);
    const first = await created.json();
    const board = await call<{
      items: { id: string; description: string; virtualMcpId: string }[];
    }>("TASK_BOARD_ITEM_LIST", {});
    const ticket = board.items.find((item) => item.id === first.task_id);
    expect(ticket?.virtualMcpId).toBe(destination.id);
    expect(ticket?.description).not.toContain("must-not-be-stored");
    expect(await (await send(body)).json()).toMatchObject({
      task_id: first.task_id,
      outcome: "unchanged",
    });
    const alert = {
      action: "triggered",
      data: {
        event: {
          issue_id: "123",
          title: "Failed request again",
          url: "https://sentry.io/api/0/projects/example/web/events/abc/",
        },
      },
    };
    const alertBody = JSON.stringify(alert);
    expect(
      await (await send(alertBody, sign(alertBody), "event_alert")).json(),
    ).toMatchObject({ task_id: first.task_id, outcome: "updated" });
    const foreign = JSON.stringify({
      ...payload,
      data: {
        issue: {
          ...payload.data.issue,
          web_url: "https://other.sentry.io/issues/123/",
        },
      },
    });
    expect((await send(foreign)).status()).toBe(400);
    expect((await send(body, sign(body), "metric_alert")).status()).toBe(400);
  } finally {
    await inbound.dispose();
  }
});
