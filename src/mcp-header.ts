import { MCP_HEADER_VALUE_ENCODING } from "./generated/codegen.js";

/** Encode a subject for HTTP without changing its JSON-RPC body value. */
export function encodeMcpHeaderValue(value: string): string {
  const policy = MCP_HEADER_VALUE_ENCODING;
  const bytes = new TextEncoder().encode(value);
  if (!value.startsWith(" ") && !value.endsWith(" ") &&
      !(value.startsWith(policy.prefix) && value.endsWith(policy.suffix)) &&
      bytes.every(byte => byte >= policy.plain_minimum && byte <= policy.plain_maximum)) return value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return policy.prefix + btoa(binary) + policy.suffix;
}
