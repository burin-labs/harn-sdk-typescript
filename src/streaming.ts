import type { Event } from "./types.js";

export interface SseEvent<T = string> {
  id?: string;
  event?: string;
  retry?: number;
  data: T;
}

export async function* parseSseStream(stream: ReadableStream<Uint8Array>): AsyncIterable<SseEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let current = emptyEvent();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r\n|\r|\n/);
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const event = parseSseLine(line, current);
        if (event) {
          yield event;
          current = emptyEvent();
        }
      }
    }

    buffer += decoder.decode();
    if (buffer) {
      const event = parseSseLine(buffer, current);
      if (event) {
        yield event;
        current = emptyEvent();
      }
    }
    if (current.data.length > 0) {
      yield materializeEvent(current);
    }
  } finally {
    reader.releaseLock();
  }
}

export async function* streamJsonSse<T>(stream: ReadableStream<Uint8Array>): AsyncIterable<SseEvent<T>> {
  for await (const event of parseSseStream(stream)) {
    yield { ...event, data: JSON.parse(event.data) as T };
  }
}

export function taskEventsWebSocketUrl(baseUrl: string | URL, taskId: string): URL {
  const url = new URL(`/v1/tasks/${encodeURIComponent(taskId)}/stream`, baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url;
}

export function connectTaskEventsWebSocket(
  baseUrl: string | URL,
  taskId: string,
  options: { protocols?: string | string[]; WebSocket?: typeof WebSocket } = {},
): WebSocket {
  const WebSocketCtor = options.WebSocket ?? globalThis.WebSocket;
  if (!WebSocketCtor) {
    throw new Error("A WebSocket implementation is required in this runtime.");
  }
  return new WebSocketCtor(taskEventsWebSocketUrl(baseUrl, taskId), options.protocols);
}

export type TaskEventStream = AsyncIterable<Event>;

interface BufferedSseEvent {
  id?: string;
  event?: string;
  retry?: number;
  data: string[];
}

function emptyEvent(): BufferedSseEvent {
  return { data: [] };
}

function parseSseLine(line: string, current: BufferedSseEvent): SseEvent | undefined {
  if (line === "") {
    return current.data.length === 0 ? undefined : materializeEvent(current);
  }
  if (line.startsWith(":")) {
    return undefined;
  }

  const colon = line.indexOf(":");
  const field = colon === -1 ? line : line.slice(0, colon);
  const rawValue = colon === -1 ? "" : line.slice(colon + 1);
  const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;

  if (field === "data") {
    current.data.push(value);
  } else if (field === "event") {
    current.event = value;
  } else if (field === "id") {
    current.id = value;
  } else if (field === "retry") {
    const retry = Number(value);
    if (Number.isInteger(retry) && retry >= 0) {
      current.retry = retry;
    }
  }

  return undefined;
}

function materializeEvent(current: BufferedSseEvent): SseEvent {
  return {
    id: current.id,
    event: current.event,
    retry: current.retry,
    data: current.data.join("\n"),
  };
}
