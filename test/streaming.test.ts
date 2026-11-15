import { describe, expect, it } from "vitest";
import { parseSseStream, streamJsonSse, taskEventsWebSocketUrl } from "../src/index.js";

describe("streaming helpers", () => {
  it("keeps CRLF and UTF-8 boundaries intact for every byte chunk", async () => {
    const bytes = new TextEncoder().encode("data: hé\r\ndata: world\r\n\r\n");
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    } });
    const events = [];
    for await (const event of parseSseStream(stream)) events.push(event);
    expect(events).toEqual([{ data: "hé\nworld" }]);
  });

  it("discards incomplete events at EOF and resets empty blocks", async () => {
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new TextEncoder().encode("event: stale\n\ndata: complete\n\ndata: incomplete\n"));
      controller.close();
    } });
    const events = [];
    for await (const event of parseSseStream(stream)) events.push(event);
    expect(events).toEqual([{ data: "complete" }]);
  });

  it("cancels the underlying reader when the consumer stops", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new TextEncoder().encode("data: complete\n\n"));
    }, cancel() { cancelled = true; } });
    for await (const event of parseSseStream(stream)) {
      expect(event.data).toBe("complete");
      break;
    }
    expect(cancelled).toBe(true);
    expect(stream.locked).toBe(false);
  });

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

  it("ignores invalid retry fields", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("retry: 1.5\ndata: first\n\nretry: 2500\ndata: second\n\n"));
        controller.close();
      },
    });

    const events = [];
    for await (const event of parseSseStream(stream)) {
      events.push(event);
    }

    expect(events).toEqual([{ data: "first" }, { retry: 2500, data: "second" }]);
  });

  it("builds websocket URLs for task streams", () => {
    expect(String(taskEventsWebSocketUrl("https://api.example.test", "task/1"))).toBe(
      "wss://api.example.test/v1/tasks/task%2F1/stream",
    );
  });
});
