import { describe, expect, it } from "vitest";
import { HarnClient } from "../src/client.js";
import { HarnMcpError, mcpRequest } from "../src/mcp-rpc.js";
import {
  MCP_HEADER_METHOD, MCP_HEADER_NAME, MCP_HEADER_PROTOCOL_VERSION,
  MCP_META_KEY_CLIENT_CAPABILITIES, MCP_META_KEY_PROTOCOL_VERSION, MCP_PROTOCOL_VERSION,
  MCP_TASKS_EXTENSION_ID, MCP_NAME_FIELDS,
} from "../src/generated/codegen.js";
import { parseLosslessJson } from "../src/lossless-json.js";

describe("MCP projection of the existing transport", () => {
  it("projects every canonical named request, including task collection and cancellation", () => {
    expect(Object.keys(MCP_NAME_FIELDS)).toHaveLength(6);
    for (const [method, field] of Object.entries(MCP_NAME_FIELDS)) {
      const request = mcpRequest(method, { [field]: "known-resource" }, { [MCP_HEADER_NAME]: "spoof" });
      expect(request.headers.get(MCP_HEADER_NAME)).toBe("known-resource");
      expect(() => mcpRequest(method, { [field]: 7n }, undefined)).toThrow(HarnMcpError);
    }
    expect(mcpRequest("tools/list", { name: "irrelevant" }, { [MCP_HEADER_NAME]: "spoof" }).headers.has(MCP_HEADER_NAME)).toBe(false);
  });

  it("preserves actual integer tokens and uses the existing authentication owner", async () => {
    const observed: { url: string; init: RequestInit }[] = [];
    let authCalls = 0;
    const client = new HarnClient({
      auth: ({ url }) => { authCalls++; expect(url.hostname).toBe("api.harnlang.com"); return { Authorization: "Bearer fixture-only" }; },
      fetch: async (url, init) => {
        observed.push({ url: String(url), init: init! });
        return new Response('{"jsonrpc":"2.0","id":"exact","result":{"structuredContent":{"integer":9007199254740993}}}', { headers: { "Content-Type": "application/json" } });
      },
    });
    const result = await client.mcpRequest("tools/call", {
      name: "nested", arguments: { integer: 9007199254740993n },
      _meta: { [MCP_META_KEY_CLIENT_CAPABILITIES]: { extensions: { [MCP_TASKS_EXTENSION_ID]: {} } } },
    }, { requestId: "exact", headers: { Accept: "text/plain", [MCP_HEADER_METHOD]: "spoof", [MCP_HEADER_NAME]: "spoof" } });
    expect(result).toEqual({ structuredContent: { integer: 9007199254740993n } });
    expect(authCalls).toBe(1);
    expect(observed).toHaveLength(1);
    expect(observed[0]!.url).toBe("https://api.harnlang.com/mcp");
    const headers = new Headers(observed[0]!.init.headers);
    expect(headers.get("Authorization")).toBe("Bearer fixture-only");
    expect(headers.get("Accept")).toBe("application/json, text/event-stream");
    expect(headers.get(MCP_HEADER_METHOD)).toBe("tools/call");
    expect(headers.get(MCP_HEADER_NAME)).toBe("nested");
    expect(headers.get(MCP_HEADER_PROTOCOL_VERSION)).toBe(MCP_PROTOCOL_VERSION);
    expect(headers.has("Harn-Agents-Protocol-Version")).toBe(false);
    const body = String(observed[0]!.init.body);
    expect(body).toContain('"integer":9007199254740993');
    expect(body).not.toContain('"integer":9007199254740992');
    expect(parseLosslessJson(body)).toMatchObject({ params: { _meta: {
      [MCP_META_KEY_PROTOCOL_VERSION]: MCP_PROTOCOL_VERSION,
      [MCP_META_KEY_CLIENT_CAPABILITIES]: { extensions: { [MCP_TASKS_EXTENSION_ID]: {} } },
    } } });
  });

  it("refuses mismatched and missing JSON-RPC results without confusing null with absence", async () => {
    for (const body of [
      '{"jsonrpc":"2.0","id":"other","result":null}',
      '{"jsonrpc":"2.0","id":"expected"}',
      '{"jsonrpc":"2.0","id":"expected","error":{"code":1,"message":"bad"},"result":null}',
    ]) {
      const client = new HarnClient({ fetch: async () => new Response(body) });
      await expect(client.mcpRequest("server/discover", {}, { requestId: "expected" })).rejects.toBeInstanceOf(HarnMcpError);
    }
    const client = new HarnClient({ fetch: async () => new Response('{"jsonrpc":"2.0","id":"expected","result":null}') });
    await expect(client.mcpRequest("server/discover", {}, { requestId: "expected" })).resolves.toBeNull();
  });

  it("reads a lossless SSE terminal response after notifications and closes its stream", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      const wire = ': prime\r\n\r\ndata: {"jsonrpc":"2.0","method":"notifications/progress","params":{}}\r\n\r\ndata: {"jsonrpc":"2.0","id":"stream","result":{"integer":9007199254740993}}\r\n\r\n';
      for (const byte of new TextEncoder().encode(wire)) controller.enqueue(Uint8Array.of(byte));
    }, cancel() { cancelled = true; } });
    const client = new HarnClient({ fetch: async () => new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8" } }) });
    await expect(client.mcpRequest("server/discover", {}, { requestId: "stream" })).resolves.toEqual({ integer: 9007199254740993n });
    expect(cancelled).toBe(true);
  });

  it("refuses SSE responses with the wrong ID, missing terminal, or incomplete frame", async () => {
    for (const wire of [
      'data: {"jsonrpc":"2.0","id":"other","result":null}\n\n',
      'data: {"jsonrpc":"2.0","method":"notifications/progress","params":{}}\n\n',
      'data: {"jsonrpc":"2.0","id":"expected","result":null}\n',
    ]) {
      const client = new HarnClient({ fetch: async () => new Response(wire, { headers: { "Content-Type": "text/event-stream" } }) });
      await expect(client.mcpRequest("server/discover", {}, { requestId: "expected" })).rejects.toBeInstanceOf(HarnMcpError);
    }
  });

  it("preserves typed application failures as result data and separates JSON-RPC faults", async () => {
    const failure = { isError: true, _meta: { "com.harnlang/toolContract": { applicationError: { value: { kind: "conflict" } } } } };
    const client = new HarnClient({ fetch: async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: "application", result: failure })) });
    await expect(client.mcpRequest("tools/call", { name: "fail", arguments: {} }, { requestId: "application" })).resolves.toEqual(failure);
    const fault = new HarnClient({ fetch: async () => new Response('{"jsonrpc":"2.0","id":"fault","error":{"code":-32602,"message":"Invalid params","data":{"path":"input"}}}') });
    await expect(fault.mcpRequest("tools/call", { name: "fail", arguments: {} }, { requestId: "fault" })).rejects.toMatchObject({ name: "HarnMcpError", code: -32602, data: { path: "input" } });
  });

  it("retains JSON-RPC errors on HTTP400 and HTTP status for authentication failures", async () => {
    const protocol = new HarnClient({ fetch: async () => new Response('{"jsonrpc":"2.0","id":"bad","error":{"code":-32602,"message":"Invalid params"}}', { status: 400 }) });
    await expect(protocol.mcpRequest("tools/call", { name: "fail", arguments: {} }, { requestId: "bad" })).rejects.toMatchObject({ name: "HarnMcpError", code: -32602 });
    const auth = new HarnClient({ fetch: async () => new Response('{"error":{"code":"unauthenticated","message":"Authentication required"}}', { status: 401 }) });
    await expect(auth.mcpRequest("tools/list", {})).rejects.toMatchObject({ name: "HarnApiError", status: 401, error: { code: "unauthenticated" } });
  });

  it("cancels the active HTTP request through its signal without sending a legacy notification", async () => {
    const bodies: string[] = [];
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const client = new HarnClient({ fetch: async (_url, init) => {
      bodies.push(String(init!.body));
      return new Promise<Response>((_resolve, reject) => {
        init!.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
        started();
      });
    } });
    const controller = new AbortController();
    const request = client.mcpRequest("tools/call", { name: "waiting", arguments: {} }, { signal: controller.signal });
    await ready;
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    expect(bodies).toHaveLength(1);
    expect(parseLosslessJson(bodies[0]!)).toHaveProperty("method", "tools/call");
  });
});
