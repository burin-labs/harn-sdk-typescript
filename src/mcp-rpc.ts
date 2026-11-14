import {
  MCP_HEADER_METHOD, MCP_HEADER_NAME, MCP_HEADER_PROTOCOL_VERSION,
  MCP_META_KEY_CLIENT_CAPABILITIES, MCP_META_KEY_CLIENT_INFO, MCP_META_KEY_PROTOCOL_VERSION,
  MCP_NAME_FIELDS, MCP_PROTOCOL_VERSION,
} from "./generated/codegen.js";
import { jsonObject, parseLosslessJson, type LosslessJsonValue } from "./lossless-json.js";
export { jsonObject } from "./lossless-json.js";
import { parseSseStream } from "./streaming.js";
import { HarnApiError } from "./errors.js";
import { encodeMcpHeaderValue } from "./mcp-header.js";

export class HarnMcpError extends Error {
  constructor(message: string, readonly code?: number, readonly data?: LosslessJsonValue) {
    super(message);
    this.name = "HarnMcpError";
  }
}

export function mcpRequest(
  method: string,
  params: Record<string, LosslessJsonValue>,
  headersInput: HeadersInit | undefined,
  id: string = globalThis.crypto.randomUUID(),
): { body: Record<string, LosslessJsonValue>; headers: Headers; id: string } {
  const headers = new Headers(headersInput);
  headers.set("Accept", "application/json, text/event-stream");
  headers.set(MCP_HEADER_METHOD, method);
  headers.set(MCP_HEADER_PROTOCOL_VERSION, MCP_PROTOCOL_VERSION);
  headers.delete(MCP_HEADER_NAME);
  const field = (MCP_NAME_FIELDS as Readonly<Record<string, string>>)[method];
  if (field !== undefined) {
    const name = params[field];
    if (typeof name !== "string" || !name) throw new HarnMcpError(`MCP ${method} requires ${field}`);
    headers.set(MCP_HEADER_NAME, encodeMcpHeaderValue(name));
  }
  if (params._meta !== undefined && !jsonObject(params._meta)) throw new HarnMcpError("MCP request metadata must be an object");
  const body: Record<string, LosslessJsonValue> = {
    jsonrpc: "2.0", method,
    params: { ...params, _meta: {
      ...params._meta,
      [MCP_META_KEY_PROTOCOL_VERSION]: MCP_PROTOCOL_VERSION,
      [MCP_META_KEY_CLIENT_INFO]: { name: "harn-sdk-typescript", version: "harn-codegen/1.0" },
      [MCP_META_KEY_CLIENT_CAPABILITIES]: params._meta?.[MCP_META_KEY_CLIENT_CAPABILITIES] ?? {},
    } },
  };
  body.id = id;
  return { body, headers, id };
}

export async function mcpResponse(response: Response, id: string): Promise<LosslessJsonValue> {
  if (!response.ok) {
    const value = await response.text().then(parseLosslessJson).catch(() => undefined);
    if (jsonObject(value) && value.jsonrpc === "2.0" && Object.hasOwn(value, "error")) return mcpResult(value, id);
    throw new HarnApiError(response, value);
  }
  if (response.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase() === "text/event-stream") {
    if (!response.body) throw new HarnMcpError("MCP response has no event stream");
    for await (const event of parseSseStream(response.body)) {
      if (event.data === "") continue;
      const value = parseMcpJson(event.data);
      if (jsonObject(value) && value.jsonrpc === "2.0" && !Object.hasOwn(value, "id") &&
          typeof value.method === "string" && value.method.length > 0 &&
          !Object.hasOwn(value, "result") && !Object.hasOwn(value, "error")) continue;
      return mcpResult(value, id);
    }
    throw new HarnMcpError("MCP event stream ended without a terminal response");
  }
  return mcpResult(parseMcpJson(await response.text()), id);
}

function parseMcpJson(text: string): LosslessJsonValue {
  try { return parseLosslessJson(text); }
  catch { throw new HarnMcpError("MCP response is not valid lossless JSON"); }
}

function mcpResult(value: LosslessJsonValue, id: string): LosslessJsonValue {
  if (!jsonObject(value) || value.jsonrpc !== "2.0" || value.id !== id) {
    throw new HarnMcpError("MCP response does not match its JSON-RPC request");
  }
  if (Object.hasOwn(value, "error")) {
    if (Object.hasOwn(value, "result") || !jsonObject(value.error) || typeof value.error.code !== "bigint" || value.error.code < -2147483648n || value.error.code > 2147483647n || typeof value.error.message !== "string") {
      throw new HarnMcpError("MCP returned a malformed JSON-RPC error");
    }
    throw new HarnMcpError(value.error.message, Number(value.error.code), value.error.data);
  }
  if (!Object.hasOwn(value, "result")) throw new HarnMcpError("MCP response has no result");
  return value.result;
}
