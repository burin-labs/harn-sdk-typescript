import { Server, specTypeSchemas, type CallToolRequestParams, type JSONRPCMessage, type StandardSchemaV1, type Transport } from "@modelcontextprotocol/server";
import { serveStdio, type StdioServerHandle } from "@modelcontextprotocol/server/stdio";
import { type Readable, type Writable } from "node:stream";
import { dispatchGenerated, type GeneratedBinding, type RuntimeHandler } from "./binding-runtime.js";
import {
  HARN_NATIVE_BINDING_META_KEY, MCP_MAX_STDIO_LINE_BYTES, MCP_METHOD_CANCELLED_NOTIFICATION, NATIVE_MCP_BINDING_VERSION,
  MCP_STDIO_LINE_LIMIT_INCLUDES_TERMINATOR,
} from "./generated/codegen.js";
import { parseLosslessJson, stringifyLosslessJson, type LosslessJsonValue } from "./lossless-json.js";
import { jsonObject } from "./mcp-rpc.js";

export interface NativeServerOptions {
  readonly maxConcurrency: number;
  readonly stdin?: Readable;
  readonly stdout?: Writable;
  readonly onerror?: (error: Error) => void;
}

// The official schema validates the envelope, but its parsed record drops
// application keys such as __proto__. Keep the original opaque arguments.
const opaqueToolParams: StandardSchemaV1<unknown, CallToolRequestParams> = {
  "~standard": {
    version: 1,
    vendor: "harn",
    async validate(value: unknown) {
      const result = await specTypeSchemas.CallToolRequestParams["~standard"].validate(value);
      return result.issues ? result : { value: value as CallToolRequestParams };
    },
  },
};

/** Serve unary handlers; Harn retains governance, scheduling and the public task store. */
export function serveGenerated(binding: GeneratedBinding, handlers: Readonly<Record<string, RuntimeHandler>>,
  options: NativeServerOptions): StdioServerHandle {
  if (!Number.isInteger(options.maxConcurrency) || options.maxConcurrency < 1 || options.maxConcurrency > 0xffff_ffff) throw new RangeError("maxConcurrency must be a positive u32");
  const expected = new Set(binding.ir.operations.map(operation => operation.name));
  if (expected.size !== binding.ir.operations.length || Object.keys(handlers).length !== expected.size ||
      Object.keys(handlers).some(name => !expected.has(name) || typeof handlers[name] !== "function")) throw new Error("Native handlers do not match the generated operation census");
  const profile: LosslessJsonValue = {
    schema_version: NATIVE_MCP_BINDING_VERSION, catalog_schema_version: "harn-tools/2.0",
    identity: { ...binding.ir.identity },
    operations: binding.ir.operations.map(operation => ({ operation_id: operation.id, name: operation.name })),
    max_concurrency: BigInt(options.maxConcurrency), cancellation: "mcp_request",
  };
  const transport = new LosslessStdioTransport(options.stdin ?? process.stdin, options.stdout ?? process.stdout, profile);
  return serveStdio(() => {
    const server = new Server({ name: "harn-sdk-typescript", version: "harn-codegen/1.0" }, { capabilities: { tools: {} } });
    server.setRequestHandler("tools/list", () => ({ tools: binding.tools } as never));
    server.setRequestHandler("tools/call", { params: opaqueToolParams }, async (params, context) => {
      const arguments_ = params.arguments ?? {};
      try {
        return await dispatchGenerated(binding, handlers, params.name, arguments_ as LosslessJsonValue, context.mcpReq.signal) as never;
      } catch {
        context.mcpReq.signal.throwIfAborted();
        throw new Error("Native handler failed");
      }
    });
    if (options.onerror) server.onerror = options.onerror;
    return server;
  }, { transport, legacy: "reject", onerror: options.onerror });
}

// The SDK owns MCP. This adapter changes only JSON scalar representation and pipe I/O.
// Every inbound ID is namespaced, so a string ID can never collide with an integer ID.
function inboundId(id: LosslessJsonValue | undefined): string {
  if (typeof id === "string") return `s:${id}`;
  if (typeof id === "bigint") return `i:${id}`;
  throw new Error("MCP request ID must be a string or integer");
}

function outboundId(id: unknown): LosslessJsonValue {
  if (typeof id === "string" && id.startsWith("s:")) return id.slice(2);
  if (typeof id === "string" && /^i:-?(?:0|[1-9][0-9]*)$/.test(id)) return BigInt(id.slice(2));
  if (typeof id === "number" && Number.isSafeInteger(id)) return BigInt(id);
  if (id === null || typeof id === "string") return id;
  throw new Error("MCP response contains an invalid ID");
}

class LosslessStdioTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: Transport["onmessage"];
  #buffer = Buffer.alloc(0);
  #started = false;
  #closed = false;
  static readonly maxMessageBytes = MCP_MAX_STDIO_LINE_BYTES;
  constructor(private readonly input: Readable, private readonly output: Writable, private readonly profile: LosslessJsonValue) {}

  async start(): Promise<void> {
    if (this.#started) throw new Error("MCP stdio transport already started");
    this.#started = true;
    this.input.on("data", this.receive);
    this.input.on("end", this.end);
    this.input.on("error", this.fail);
    this.output.on("error", this.fail);
  }

  private readonly receive = (chunk: Buffer | string): void => {
    if (this.#closed) return;
    this.#buffer = Buffer.concat([this.#buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
    try {
      for (;;) {
        const newline = this.#buffer.indexOf(10);
        if (newline < 0) break;
        if (newline + Number(MCP_STDIO_LINE_LIMIT_INCLUDES_TERMINATOR) > LosslessStdioTransport.maxMessageBytes) throw new Error("MCP stdio message exceeds the size limit");
        const line = this.#buffer.subarray(0, newline);
        this.#buffer = this.#buffer.subarray(newline + 1);
        if (line.length === 0 || (line.length === 1 && line[0] === 13)) continue;
        const value = parseLosslessJson(new TextDecoder("utf-8", { fatal: true }).decode(line));
        if (!jsonObject(value)) throw new Error("MCP stdio message must be an object");
        if (Object.hasOwn(value, "id")) value.id = inboundId(value.id);
        if (jsonObject(value.params) && jsonObject(value.params._meta) &&
            Object.hasOwn(value.params._meta, "progressToken")) {
          value.params._meta = { ...value.params._meta,
            progressToken: inboundId(value.params._meta.progressToken) };
        }
        if (value.method === MCP_METHOD_CANCELLED_NOTIFICATION && jsonObject(value.params)) {
          value.params.requestId = inboundId(value.params.requestId);
        }
        this.onmessage?.(value as unknown as JSONRPCMessage);
      }
      if (this.#buffer.length > LosslessStdioTransport.maxMessageBytes) throw new Error("MCP stdio message exceeds the size limit");
    } catch (error) { this.fail(error instanceof Error ? error : new Error("Invalid MCP stdio message")); }
  };

  private readonly end = (): void => {
    if (this.#buffer.length) this.onerror?.(new Error("MCP stdio ended with an incomplete message"));
    void this.close();
  };

  private readonly fail = (error: Error): void => { this.onerror?.(error); void this.close(); };

  async send(message: JSONRPCMessage): Promise<void> {
    if (this.#closed) throw new Error("MCP stdio transport is closed");
    const value = { ...message } as unknown as Record<string, LosslessJsonValue>;
    if (Object.hasOwn(value, "id")) value.id = outboundId(value.id);
    if (value.method === "notifications/progress" && jsonObject(value.params)) {
      value.params = { ...value.params, progressToken: outboundId(value.params.progressToken) };
    }
    if (jsonObject(value.error) && typeof value.error.code === "number") value.error = { ...value.error, code: BigInt(value.error.code) };
    if (jsonObject(value.result)) {
      const meta = value.result._meta;
      value.result = { ...value.result, _meta: { ...(jsonObject(meta) ? meta : {}), [HARN_NATIVE_BINDING_META_KEY]: this.profile } };
      if (typeof value.result.ttlMs === "number" && Number.isSafeInteger(value.result.ttlMs)) value.result.ttlMs = BigInt(value.result.ttlMs);
    }
    const line = stringifyLosslessJson(value) + "\n";
    if (Buffer.byteLength(line) > LosslessStdioTransport.maxMessageBytes) throw new Error("MCP stdio message exceeds the size limit");
    await new Promise<void>((resolve, reject) => {
      this.output.write(line, error => error ? reject(error) : resolve());
    });
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.input.off("data", this.receive);
    this.input.off("end", this.end);
    this.input.off("error", this.fail);
    this.output.off("error", this.fail);
    this.input.pause();
    this.onclose?.();
  }
}
