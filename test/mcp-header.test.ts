import { expect, it } from "vitest";
import { MCP_HEADER_NAME, MCP_HEADER_VALUE_EXAMPLES, MCP_NAME_FIELDS } from "../src/generated/codegen.js";
import { encodeMcpHeaderValue } from "../src/mcp-header.js";
import { mcpRequest } from "../src/mcp-rpc.js";

it("uses Harn's complete header-value corpus in browser-safe HTTP requests", () => {
  expect(MCP_HEADER_VALUE_EXAMPLES).toHaveLength(7);
  for (const { value, encoded } of MCP_HEADER_VALUE_EXAMPLES) {
    expect(encodeMcpHeaderValue(value)).toBe(encoded);
    if (!value) continue;
    for (const [method, field] of Object.entries(MCP_NAME_FIELDS)) {
      const request = mcpRequest(method, { [field]: value }, undefined);
      expect(request.headers.get(MCP_HEADER_NAME)).toBe(encoded);
      expect(request.body.params).toMatchObject({ [field]: value });
    }
  }
});
