import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { ApplicationFailure } from "../src/bindings.js";
import { generatedBinding, invokeGenerated } from "../src/binding-runtime.js";
import { HarnClient } from "../src/client.js";
import { HarnDecimal } from "../src/decimal.js";
import { HARN_MCP_TOOL_CONTRACT_META_KEY, MCP_META_KEY_CLIENT_CAPABILITIES, MCP_TASKS_EXTENSION_ID } from "../src/generated/codegen.js";
import { parseLosslessJson, stringifyLosslessJson, type LosslessJsonValue } from "../src/lossless-json.js";
import { HarnMcpError, jsonObject } from "../src/mcp-rpc.js";
import { createWireCodec } from "../src/wire-codec.js";

const binding = generatedBinding(await readFile(new URL("./fixtures/pathological.ir.json", import.meta.url), "utf8"));
const wire = parseLosslessJson(await readFile(new URL("./fixtures/pathological.input.json", import.meta.url), "utf8"));
const echo = binding.ir.operations.find(operation => operation.name === "echo")!;
const input = createWireCodec(binding.ir.types, echo.input).decode({ input: wire });

function clientFor(respond: (request: Record<string, LosslessJsonValue>, init: RequestInit) => Promise<LosslessJsonValue> | LosslessJsonValue) {
  const requests: Array<Record<string, LosslessJsonValue>> = [];
  const client = new HarnClient({ accessToken: "synthetic-client-test", fetch: async (url, init = {}) => {
    expect(String(url)).toBe("https://api.harnlang.com/mcp");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer synthetic-client-test");
    const request = parseLosslessJson(String(init.body));
    if (!jsonObject(request)) throw new Error("Missing MCP request");
    requests.push(request);
    return new Response(stringifyLosslessJson({ jsonrpc: "2.0", id: request.id, result: await respond(request, init) }), { headers: { "Content-Type": "application/json" } });
  } });
  return { client, requests };
}

describe("generated clients on the existing authenticated HTTP transport", () => {
  it("refuses incomplete or mistyped protocol envelopes before reporting typed success", async () => {
    const envelopes: Array<Record<string, LosslessJsonValue>> = [
      { isError: false }, { resultType: "future", isError: false },
      { resultType: "input_required", isError: false },
      { resultType: "complete", isError: "false" }, { resultType: "complete", isError: null },
    ];
    for (const envelope of envelopes) {
      const transport = clientFor(() => ({ ...envelope, content: [], structuredContent: wire }));
      await expect(invokeGenerated(binding, echo.id, transport.client, input), JSON.stringify(envelope)).rejects.toBeInstanceOf(HarnMcpError);
      expect(transport.requests).toHaveLength(1);
    }
    const optionalFlag = clientFor(() => ({ resultType: "complete", content: [], structuredContent: wire }));
    await expect(invokeGenerated(binding, echo.id, optionalFlag.client, input)).resolves.toMatchObject({ sequence: 9223372036854775807n });
    expect(optionalFlag.requests).toHaveLength(1);
  });

  it("decodes direct rich values and declared errors without losing wire identity", async () => {
    const direct = clientFor(() => ({ resultType: "complete", content: [], structuredContent: wire, isError: false }));
    const value = await invokeGenerated<{ input: unknown }, { sequence: bigint; amount: HarnDecimal; raw: Uint8Array }>(binding, echo.id, direct.client, input as { input: unknown });
    expect(value.sequence).toBe(9223372036854775807n); expect(value.amount.toString()).toBe("1.2300"); expect(value.raw).toEqual(Uint8Array.of(0, 255, 128));
    expect(direct.requests).toHaveLength(1);
    const failed = clientFor(() => ({ resultType: "complete", content: [], isError: true, _meta: { [HARN_MCP_TOOL_CONTRACT_META_KEY]: { applicationError: {
      tool: "reject", outcome: "rejected", data: { enum: "Failure", variant: "Rejected", fields: ["declared"] },
    } } } }));
    const result = await invokeGenerated(binding, "operation:reject", failed.client, input);
    expect(result).toBeInstanceOf(ApplicationFailure);
    expect(result).toMatchObject({ outcome: "rejected", error: { enum: "Failure", variant: "Rejected", fields: ["declared"] } });
  });

  it("collects server-selected task completion without invoking the handler twice", async () => {
    const transport = clientFor((request): LosslessJsonValue => request.method === "tools/call"
      ? { resultType: "task", taskId: "task-known", status: "working" }
      : { taskId: "task-known", status: "completed", result: { resultType: "complete", content: [], isError: false, structuredContent: wire } });
    const result = await invokeGenerated(binding, "operation:scheduled", transport.client, input);
    expect(result).toMatchObject({ sequence: 9223372036854775807n });
    expect(transport.requests.map(request => request.method)).toEqual(["tools/call", "tasks/get"]);
    for (const request of transport.requests) {
      const parameters = request.params as Record<string, LosslessJsonValue>;
      expect(parameters._meta).toMatchObject({ [MCP_META_KEY_CLIENT_CAPABILITIES]: { extensions: { [MCP_TASKS_EXTENSION_ID]: {} } } });
    }
  });

  it("cancels a reached task through the same auth client while preserving caller cancellation", async () => {
    const controller = new AbortController();
    const reason = new Error("caller cancelled");
    const transport = clientFor((request, init): LosslessJsonValue => {
      expect((request.params as Record<string, LosslessJsonValue>)._meta).toMatchObject({
        [MCP_META_KEY_CLIENT_CAPABILITIES]: { extensions: { [MCP_TASKS_EXTENSION_ID]: {} } },
      });
      if (request.method === "tools/call") return { resultType: "task", taskId: "task-known", status: "working" };
      if (request.method === "tasks/get") { controller.abort(reason); throw reason; }
      expect(request.method).toBe("tasks/cancel"); expect(init.signal?.aborted).toBe(false);
      return { taskId: "task-known", status: "cancelled" };
    });
    await expect(invokeGenerated(binding, "operation:scheduled", transport.client, input, { signal: controller.signal })).rejects.toBe(reason);
    expect(transport.requests.map(request => request.method)).toEqual(["tools/call", "tasks/get", "tasks/cancel"]);
  });
});
