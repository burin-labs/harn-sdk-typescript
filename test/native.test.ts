import { readFile } from "node:fs/promises";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { ApplicationFailure } from "../src/bindings.js";
import { generatedBinding, type GeneratedBinding } from "../src/binding-runtime.js";
import { HARN_NATIVE_BINDING_META_KEY, MCP_MAX_STDIO_LINE_BYTES } from "../src/generated/codegen.js";
import { parseLosslessJson, stringifyLosslessJson, type LosslessJsonValue } from "../src/lossless-json.js";
import { jsonObject, mcpRequest } from "../src/mcp-rpc.js";
import { serveGenerated } from "../src/native.js";

const binding = generatedBinding(await readFile(new URL("./fixtures/pathological.ir.json", import.meta.url), "utf8"));
const payload = parseLosslessJson(await readFile(new URL("./fixtures/pathological.input.json", import.meta.url), "utf8"));

function open(handlers: Parameters<typeof serveGenerated>[1], contract: GeneratedBinding = binding) {
  const input = new PassThrough(), output = new PassThrough();
  const responses: LosslessJsonValue[] = [], waiters: Array<() => void> = [];
  let buffered = "", largestFrame = 0;
  output.setEncoding("utf8");
  output.on("data", (chunk: string) => {
    buffered += chunk;
    let newline: number;
    while ((newline = buffered.indexOf("\n")) >= 0) {
      largestFrame = Math.max(largestFrame, Buffer.byteLength(buffered.slice(0, newline + 1)));
      responses.push(parseLosslessJson(buffered.slice(0, newline)));
      buffered = buffered.slice(newline + 1);
      for (const wake of waiters.splice(0)) wake();
    }
  });
  let fail!: (error: Error) => void;
  const failure = new Promise<Error>(resolve => { fail = resolve; });
  const handle = serveGenerated(contract, handlers, { maxConcurrency: 2, stdin: input, stdout: output, onerror: fail });
  const send = (method: string, params: Record<string, LosslessJsonValue>, id: string | bigint): void => {
    const request = mcpRequest(method, params, undefined, "placeholder").body;
    request.id = id;
    input.write(stringifyLosslessJson(request) + "\n");
  };
  const response = async (id: string | bigint): Promise<Record<string, LosslessJsonValue>> => {
    for (;;) {
      const index = responses.findIndex(value => jsonObject(value) && value.id === id);
      if (index >= 0) return responses.splice(index, 1)[0] as Record<string, LosslessJsonValue>;
      await new Promise<void>(resolve => waiters.push(resolve));
    }
  };
  return { input, send, response, responses, failure, get largestFrame() { return largestFrame; }, close: () => handle.close() };
}

describe("generated native handlers over official MCP", () => {
  it("keeps official parameter validation before opaque application arguments", async () => {
    let reached = 0;
    const handler = (input: never) => { reached++; return (input as { input: unknown }).input; };
    const server = open({ echo: handler, mutate: handler, reject: handler, scheduled: handler });
    try {
      server.send("server/discover", {}, "open"); await server.response("open");
      const invalid = [
        { name: 1n, arguments: {} }, { name: "echo", arguments: "synthetic-private-invalid-arguments" },
      ];
      for (const [index, params] of invalid.entries()) {
        const id = `invalid-${index}`;
        const body = mcpRequest("tools/call", { name: "echo" }, undefined, id).body;
        body.params = { ...(body.params as Record<string, LosslessJsonValue>), ...params };
        server.input.write(stringifyLosslessJson(body) + "\n");
        const response = await server.response(id);
        expect(response.error).toMatchObject({ code: -32602n });
        expect(stringifyLosslessJson(response)).not.toContain("synthetic-private-invalid-arguments");
        expect(reached).toBe(0);
      }
      server.send("tools/call", { name: "echo", arguments: { input: payload } }, "positive");
      expect((await server.response("positive")).result).toMatchObject({ structuredContent: payload });
      expect(reached).toBe(1);
    } finally { await server.close(); }
  });

  it("keeps reached handler exceptions out of public protocol faults", async () => {
    let reached = 0;
    const echo = (input: never) => { reached++; return (input as { input: unknown }).input; };
    const fail = () => { reached++; throw new Error("synthetic-private-handler-token-DO-NOT-PUBLISH"); };
    const server = open({ echo, mutate: fail, reject: fail, scheduled: fail });
    try {
      server.send("server/discover", {}, "open"); await server.response("open");
      server.send("tools/call", { name: "echo", arguments: { input: payload } }, "positive");
      expect((await server.response("positive")).result).toMatchObject({ structuredContent: payload });
      server.send("tools/call", { name: "mutate", arguments: { input: payload } }, "fault");
      const response = await server.response("fault");
      expect(response.error).toMatchObject({ code: -32603n, message: "Native handler failed" });
      expect(stringifyLosslessJson(response)).not.toContain("synthetic-private-handler-token");
      expect(reached).toBe(2);
    } finally { await server.close(); }
  });

  it("refuses an oversized handler result before writing an oversized frame", async () => {
    let reached = 0;
    const handler = (input: never) => {
      reached++;
      return { ...(input as { input: Record<string, unknown> }).input, optional: "x".repeat(MCP_MAX_STDIO_LINE_BYTES) };
    };
    const server = open({ echo: handler, mutate: handler, reject: handler, scheduled: handler });
    try {
      server.send("server/discover", {}, "open"); await server.response("open");
      server.send("tools/call", { name: "echo", arguments: { input: payload } }, "oversized");
      const observed = await Promise.race([server.response("oversized").then(response => ({ response })),
        server.failure.then(error => ({ error }))]);
      expect(reached).toBe(1);
      if ("response" in observed) expect(observed.response.error).toBeDefined();
      else expect(observed.error.message).toContain("size limit");
      expect(server.largestFrame).toBeLessThanOrEqual(MCP_MAX_STDIO_LINE_BYTES);
    } finally { await server.close(); }
  });

  it("counts line terminators inside Harn's exact stdio frame bound", async () => {
    const unreachable = () => { throw new Error("discovery must not invoke a handler"); };
    for (const terminator of ["\n", "\r\n"]) {
      for (const excess of [0, 1]) {
        const server = open({ echo: unreachable, mutate: unreachable, reject: unreachable, scheduled: unreachable });
        try {
          const base = stringifyLosslessJson(mcpRequest("server/discover", { _meta: { padding: "" } }, undefined, "boundary").body);
          const count = MCP_MAX_STDIO_LINE_BYTES + excess - Buffer.byteLength(base) - terminator.length;
          const frame = base.replace('"padding":""', `"padding":"${"x".repeat(count)}"`) + terminator;
          expect(Buffer.byteLength(frame)).toBe(MCP_MAX_STDIO_LINE_BYTES + excess);
          server.input.write(frame);
          const observed = await Promise.race([server.response("boundary").then(response => ({ response })),
            server.failure.then(error => ({ error }))]);
          if (excess) {
            expect(observed).toHaveProperty("error");
            if ("error" in observed) expect(observed.error.message).toContain("size limit");
          } else {
            expect(observed).toHaveProperty("response");
            if ("response" in observed) expect(observed.response.error).toBeUndefined();
          }
        } finally { await server.close(); }
      }
    }
  });

  it("admits exact integer progress tokens carried by Harn's real requests", async () => {
    const unreachable = () => { throw new Error("catalog listing must not invoke a handler"); };
    const server = open({ echo: unreachable, mutate: unreachable, reject: unreachable, scheduled: unreachable });
    try {
      server.send("server/discover", {}, "open"); await server.response("open");
      for (const token of [9223372036854775807n, "9223372036854775807"]) {
        server.send("tools/list", { _meta: { progressToken: token } }, String(typeof token));
        const result = await Promise.race([server.response(String(typeof token)),
          server.failure.then(error => { throw error; })]);
        expect(result.error).toBeUndefined();
        expect((result.result as Record<string, LosslessJsonValue>).tools).toEqual(binding.tools);
      }
    } finally { await server.close(); }
  });

  it("forwards every opaque catalog field including unknown and explicit null values", async () => {
    expect(binding.tools).toHaveLength(4);
    const tools = binding.tools.map((tool, index) => {
      if (!jsonObject(tool)) throw new Error("canonical tool must be an object");
      return { ...tool, futureCatalogExtension: { sequence: BigInt(index), absent: null,
        nested: [null, { future: true }] }, _meta: { ...(jsonObject(tool._meta) ? tool._meta : {}),
        futureNullableExtension: null } };
    });
    const unreachable = () => { throw new Error("catalog listing must not invoke a handler"); };
    const server = open({ echo: unreachable, mutate: unreachable, reject: unreachable, scheduled: unreachable },
      { ...binding, tools });
    try {
      server.send("server/discover", {}, "open"); await server.response("open");
      server.send("tools/list", {}, "opaque");
      const result = (await server.response("opaque")).result;
      expect(jsonObject(result) && result.tools).toEqual(tools);
    } finally { await server.close(); }
  });

  it("preserves the real shared catalog, exact values, and numeric/string ID distinction", async () => {
    let reached = 0;
    const server = open({
      echo: (input: never) => { reached++; return (input as { input: unknown }).input; },
      mutate: () => { throw new Error("unreached"); }, reject: () => { throw new Error("unreached"); }, scheduled: () => { throw new Error("unreached"); },
    });
    try {
      server.send("server/discover", {}, 1n);
      const discover = await server.response(1n);
      expect(discover.error).toBeUndefined();
      expect((discover.result as Record<string, LosslessJsonValue>)._meta).toMatchObject({ [HARN_NATIVE_BINDING_META_KEY]: { identity: binding.ir.identity, max_concurrency: 2n } });
      server.send("tools/list", {}, "1");
      expect((await server.response("1")).result).toMatchObject({ tools: binding.tools });
      server.send("tools/call", { name: "echo", arguments: { input: payload } }, 9223372036854775807n);
      const result = await server.response(9223372036854775807n);
      expect(result.error).toBeUndefined();
      expect((result.result as Record<string, LosslessJsonValue>).structuredContent).toEqual(payload);
      expect(reached).toBe(1);
    } finally { await server.close(); }
  });

  it("refuses wrong arguments before entry and wrong results after entry", async () => {
    let reached = 0;
    const invalid = () => { reached++; return { unexpected: "private payload" }; };
    const server = open({ echo: invalid, mutate: invalid, reject: invalid, scheduled: invalid });
    try {
      server.send("server/discover", {}, "open"); await server.response("open");
      server.send("tools/call", { name: "echo", arguments: { input: { bad: true } } }, "bad-input");
      expect((await server.response("bad-input")).error).toBeDefined(); expect(reached).toBe(0);
      server.send("tools/call", { name: "echo", arguments: { input: payload } }, "bad-output");
      const response = await server.response("bad-output"); expect(response.error).toBeDefined(); expect(reached).toBe(1);
      expect(stringifyLosslessJson(response)).not.toContain("private payload");
    } finally { await server.close(); }
  });

  it("cancels one reached handler without cancelling another and keeps declared errors typed", async () => {
    let reached!: () => void, cancelled!: () => void;
    const entered = new Promise<void>(resolve => { reached = resolve; });
    const aborted = new Promise<void>(resolve => { cancelled = resolve; });
    const server = open({
      echo: async (input: never, { signal }) => {
        if ((input as { input: { sequence: bigint } }).input.sequence === 0n) {
          reached(); await new Promise<void>(resolve => signal.addEventListener("abort", () => { cancelled(); resolve(); }, { once: true }));
        }
        return (input as { input: unknown }).input;
      },
      mutate: () => { throw new Error("unreached"); }, scheduled: () => { throw new Error("unreached"); },
      reject: () => new ApplicationFailure({ enum: "Failure", variant: "Rejected", fields: ["declared"] }, "rejected"),
    });
    try {
      server.send("server/discover", {}, "open"); await server.response("open");
      server.send("tools/call", { name: "echo", arguments: { input: { ...(payload as Record<string, LosslessJsonValue>), sequence: 0n } } }, 7n);
      await entered;
      server.input.write(stringifyLosslessJson({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 7n } }) + "\n");
      await aborted;
      server.send("tools/call", { name: "echo", arguments: { input: payload } }, "7");
      expect((await server.response("7")).result).toMatchObject({ structuredContent: payload });
      server.send("tools/call", { name: "reject", arguments: { input: payload } }, "failure");
      const failure = await server.response("failure");
      expect(failure.error).toBeUndefined(); expect(failure.result).toMatchObject({ isError: true });
      expect(server.responses.some(value => jsonObject(value) && value.id === 7n)).toBe(false);
    } finally { await server.close(); }
  });
});
