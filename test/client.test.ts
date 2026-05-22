import { describe, expect, it } from "vitest";
import { HarnClient } from "../src/index.js";

describe("HarnClient", () => {
  it("sends auth, protocol version, query params, and idempotency headers", async () => {
    const { calls, client } = recordingClient({ object: "persona_list", data: [], has_more: false }, { apiKey: "test-key" });

    await client.listPersonas({ limit: 10, cursor: "next", idempotencyKey: "idem-1" });

    expect(calls[0]?.url).toBe("https://example.test/v1/personas?limit=10&cursor=next");
    const headers = new Headers(calls[0]?.init.headers);
    expect(headers.get("Authorization")).toBe("Bearer test-key");
    expect(headers.get("Harn-Agents-Protocol-Version")).toBe("agents-protocol-2026-04-25");
    expect(headers.get("Idempotency-Key")).toBe("idem-1");
  });

  it("serializes JSON request bodies and path params", async () => {
    const { calls, client } = recordingClient({ id: "task 1", object: "task" }, { baseUrl: "https://example.test/api/" });

    await client.submitSessionTask("session/1", { input: { prompt: "hello" } });

    expect(calls[0]?.url).toBe("https://example.test/v1/sessions/session%2F1/tasks");
    expect(new Headers(calls[0]?.init.headers).get("Content-Type")).toBe("application/json");
    expect(calls[0]?.init.body).toBe(JSON.stringify({ input: { prompt: "hello" } }));
  });

  it("throws structured API errors", async () => {
    const client = new HarnClient({
      fetch: async () =>
        Response.json(
          { error: { code: "resource_not_found", message: "missing", type: "not_found_error" } },
          { status: 404 },
        ),
    });

    await expect(client.getTask("task_1")).rejects.toMatchObject({
      name: "HarnApiError",
      status: 404,
      error: { code: "resource_not_found", message: "missing", type: "not_found_error" },
    });
  });

  it("calls unauthenticated local discovery endpoints without protocol headers", async () => {
    const { calls, client } = recordingClient({ ok: true });

    await client.getHealth();
    await client.getVersion();
    await client.getOpenApiDocument();

    expect(calls.map((call) => call.url)).toEqual([
      "https://example.test/health",
      "https://example.test/version",
      "https://example.test/openapi.json",
    ]);
    for (const call of calls) {
      expect(new Headers(call.init.headers).has("Harn-Agents-Protocol-Version")).toBe(false);
    }
  });

  it("covers runtime and local tool discovery endpoints", async () => {
    const { calls, client } = recordingClient({}, { apiKey: "test-key" });

    await client.getRuntime();
    await client.listCapabilities();
    await client.listTools({ limit: 2, cursor: "next" });
    await client.getTool("tool/1");

    expect(calls.map((call) => call.url)).toEqual([
      "https://example.test/v1/runtime",
      "https://example.test/v1/capabilities",
      "https://example.test/v1/tools?limit=2&cursor=next",
      "https://example.test/v1/tools/tool%2F1",
    ]);
    for (const call of calls) {
      const headers = new Headers(call.init.headers);
      expect(headers.get("Authorization")).toBe("Bearer test-key");
      expect(headers.get("Harn-Agents-Protocol-Version")).toBe("agents-protocol-2026-04-25");
    }
  });

  it("covers workspace file, truncation, and permission request operations", async () => {
    const { calls, client } = recordingClient({});

    await client.readWorkspaceFile("ws/1", { path: "src/main.harn" });
    await client.writeWorkspaceFile("ws/1", { content: "hello" }, { path: "src/main.harn", idempotencyKey: "idem-file" });
    await client.truncateSession("session/1", { keep_first: 3 }, { idempotencyKey: "idem-truncate" });
    await client.listPermissionRequests({ sessionId: "session/1", taskId: "task/1", limit: 5, cursor: "next" });
    await client.listTaskPermissionRequests("task/1", { limit: 6 });
    await client.respondPermissionRequest("request/1", { approved: true, reason: "ok" }, { idempotencyKey: "idem-permission" });

    expect(calls.map((call) => `${call.init.method} ${call.url}`)).toEqual([
      "GET https://example.test/v1/workspaces/ws%2F1/files?path=src%2Fmain.harn",
      "PUT https://example.test/v1/workspaces/ws%2F1/files?path=src%2Fmain.harn",
      "POST https://example.test/v1/sessions/session%2F1/truncate",
      "GET https://example.test/v1/permission-requests?session_id=session%2F1&task_id=task%2F1&limit=5&cursor=next",
      "GET https://example.test/v1/tasks/task%2F1/permission-requests?limit=6",
      "POST https://example.test/v1/permission-requests/request%2F1/respond",
    ]);
    expect(calls[1]?.init.body).toBe(JSON.stringify({ content: "hello" }));
    expect(new Headers(calls[1]?.init.headers).get("Idempotency-Key")).toBe("idem-file");
    expect(calls[2]?.init.body).toBe(JSON.stringify({ keep_first: 3 }));
    expect(new Headers(calls[2]?.init.headers).get("Idempotency-Key")).toBe("idem-truncate");
    expect(calls[5]?.init.body).toBe(JSON.stringify({ approved: true, reason: "ok" }));
    expect(new Headers(calls[5]?.init.headers).get("Idempotency-Key")).toBe("idem-permission");
  });

  it("streams task events from SSE responses", async () => {
    const payload = {
      id: "evt_1",
      object: "event",
      created_at: "2026-04-25T00:00:00Z",
      updated_at: "2026-04-25T00:00:00Z",
      metadata: {},
      event: "task.completed",
      resource: { object: "task", id: "task_1" },
      sequence: 1,
      payload: {},
    };
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`id: evt_1\ndata: ${JSON.stringify(payload)}\n\n`));
        controller.close();
      },
    });
    const client = new HarnClient({
      fetch: async () => new Response(stream, { headers: { "Content-Type": "text/event-stream" } }),
    });

    const events = [];
    for await (const event of client.streamTaskEvents("task_1", { lastEventId: "evt_0" })) {
      events.push(event);
    }

    expect(events).toEqual([payload]);
  });
});

function recordingClient(
  responseBody: unknown,
  options: Omit<ConstructorParameters<typeof HarnClient>[0], "fetch"> = {},
): { calls: { url: string; init: RequestInit }[]; client: HarnClient } {
  const calls: { url: string; init: RequestInit }[] = [];
  const client = new HarnClient({
    baseUrl: "https://example.test",
    ...options,
    fetch: async (url, init = {}) => {
      calls.push({ url: String(url), init });
      return Response.json(responseBody);
    },
  });
  return { calls, client };
}
