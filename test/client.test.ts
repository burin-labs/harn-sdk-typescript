import { describe, expect, it } from "vitest";
import { HarnApiError, HarnClient } from "../src/index.js";

describe("HarnClient", () => {
  it("sends auth, protocol version, query params, and idempotency headers", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const client = new HarnClient({
      baseUrl: "https://example.test",
      apiKey: "test-key",
      fetch: async (url, init = {}) => {
        calls.push({ url: String(url), init });
        return Response.json({ object: "persona_list", data: [], has_more: false });
      },
    });

    await client.listPersonas({ limit: 10, cursor: "next", idempotencyKey: "idem-1" });

    expect(calls[0]?.url).toBe("https://example.test/v1/personas?limit=10&cursor=next");
    const headers = new Headers(calls[0]?.init.headers);
    expect(headers.get("Authorization")).toBe("Bearer test-key");
    expect(headers.get("Harn-Agents-Protocol-Version")).toBe("agents-protocol-2026-04-25");
    expect(headers.get("Idempotency-Key")).toBe("idem-1");
  });

  it("serializes JSON request bodies and path params", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const client = new HarnClient({
      baseUrl: "https://example.test/api/",
      fetch: async (url, init = {}) => {
        calls.push({ url: String(url), init });
        return Response.json({ id: "task 1", object: "task" });
      },
    });

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

    await expect(client.getTask("task_1")).rejects.toMatchObject<HarnApiError>({
      name: "HarnApiError",
      status: 404,
      error: { code: "resource_not_found", message: "missing", type: "not_found_error" },
    });
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
