import { describe, expect, it } from "vitest";
import { parseSseStream, streamJsonSse, taskEventsWebSocketUrl } from "../src/index.js";

describe("streaming helpers", () => {
  it("parses chunked SSE frames with multiline data", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("id: 1\nevent: update\ndata: hello"));
        controller.enqueue(new TextEncoder().encode("\ndata: world\n\n"));
        controller.close();
      },
    });

    const events = [];
    for await (const event of parseSseStream(stream)) {
      events.push(event);
    }

    expect(events).toEqual([{ id: "1", event: "update", data: "hello\nworld" }]);
  });

  it("parses JSON SSE payloads", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"ok":true}\n\n'));
        controller.close();
      },
    });

    const events = [];
    for await (const event of streamJsonSse<{ ok: boolean }>(stream)) {
      events.push(event.data);
    }

    expect(events).toEqual([{ ok: true }]);
  });

  it("builds websocket URLs for task streams", () => {
    expect(String(taskEventsWebSocketUrl("https://api.example.test", "task/1"))).toBe(
      "wss://api.example.test/v1/tasks/task%2F1/stream",
    );
  });
});
