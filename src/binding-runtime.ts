import { ApplicationFailure, type HandlerContext } from "./bindings.js";
import type { HarnClient, McpRequestOptions } from "./client.js";
import {
  HARN_MCP_TOOL_CONTRACT_META_KEY, MCP_META_KEY_CLIENT_CAPABILITIES,
  MCP_METHOD_TASKS_CANCEL, MCP_METHOD_TASKS_GET, MCP_METHOD_TOOLS_CALL, MCP_TASKS_EXTENSION_ID,
  type CodegenIr, type CodegenOperation,
} from "./generated/codegen.js";
import { parseLosslessJson, type LosslessJsonValue } from "./lossless-json.js";
import { HarnMcpError, jsonObject } from "./mcp-rpc.js";
import { createWireCodec } from "./wire-codec.js";

/** Private data emitted by the generator after Harn validates the complete IR. */
export interface GeneratedBinding {
  readonly ir: CodegenIr;
  readonly tools: readonly LosslessJsonValue[];
}

export function generatedBinding(validatedIr: string): GeneratedBinding {
  const ir: CodegenIr = JSON.parse(validatedIr);
  const lossless = parseLosslessJson(validatedIr);
  if (!jsonObject(lossless) || !Array.isArray(lossless.mcp_tools)) throw new Error("Invalid generated Harn binding");
  return { ir, tools: lossless.mcp_tools };
}

function operationFor(binding: GeneratedBinding, operationId: string): CodegenOperation {
  const operation = binding.ir.operations.find(operation => operation.id === operationId);
  if (!operation || operation.output.kind !== "value") throw new Error("Missing generated Harn operation");
  return operation;
}

export async function invokeGenerated<I, O>(binding: GeneratedBinding, operationId: string,
  client: HarnClient, input: I, options: McpRequestOptions = {}): Promise<O> {
  const operation = operationFor(binding, operationId);
  const arguments_ = createWireCodec<I>(binding.ir.types, operation.input).encode(input);
  if (!jsonObject(arguments_)) throw new HarnMcpError("MCP operation input must be a record");
  const capabilities: Record<string, LosslessJsonValue> = operation.execution.task_support === "forbidden"
    ? {} : { extensions: { [MCP_TASKS_EXTENSION_ID]: {} } };
  const metadata = { [MCP_META_KEY_CLIENT_CAPABILITIES]: capabilities };
  let result = await client.mcpRequest(MCP_METHOD_TOOLS_CALL, {
    name: operation.name, arguments: arguments_, _meta: metadata,
  }, options);
  if (jsonObject(result) && result.resultType === "task") {
    if (operation.execution.task_support === "forbidden" || typeof result.taskId !== "string") throw new HarnMcpError("Unexpected MCP task response");
    const taskId = result.taskId;
    try {
      for (;;) {
        options.signal?.throwIfAborted();
        const task = await client.mcpRequest(MCP_METHOD_TASKS_GET, { taskId, _meta: metadata }, options);
        if (!jsonObject(task) || task.taskId !== taskId || typeof task.status !== "string") throw new HarnMcpError("Malformed MCP task response");
        if (task.status === "completed") {
          if (!Object.hasOwn(task, "result")) throw new HarnMcpError("Completed MCP task has no result");
          result = task.result;
          break;
        }
        if (task.status !== "working" && task.status !== "input_required") throw new HarnMcpError("MCP task did not complete successfully");
        if (task.status === "input_required") throw new HarnMcpError("MCP task requires unsupported interactive input");
        await waitForTask(options.signal);
      }
    } catch (error) {
      if (options.signal?.aborted) {
        try { await client.mcpRequest(MCP_METHOD_TASKS_CANCEL, { taskId, _meta: metadata }, { ...options, signal: AbortSignal.timeout(5000) }); }
        catch { /* Keep the caller's cancellation as the primary fault. */ }
      }
      throw error;
    }
  }
  return decodeGeneratedResult<O>(binding, operation, result);
}

function waitForTask(signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const finish = (): void => { signal?.removeEventListener("abort", abort); resolve(); };
    const timer = setTimeout(finish, 250);
    const abort = (): void => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(signal?.reason); };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

function decodeGeneratedResult<O>(binding: GeneratedBinding, operation: CodegenOperation, value: LosslessJsonValue): O {
  if (!jsonObject(value) || value.resultType !== "complete" ||
      (Object.hasOwn(value, "isError") && typeof value.isError !== "boolean")) {
    throw new HarnMcpError("Malformed MCP tool result");
  }
  const meta = value._meta;
  const contract = jsonObject(meta) ? meta[HARN_MCP_TOOL_CONTRACT_META_KEY] : undefined;
  const application = jsonObject(contract) ? contract.applicationError : undefined;
  if (value.isError === true) {
    if (!operation.application_error || !jsonObject(application) || application.tool !== operation.name ||
        !Object.hasOwn(application, "data") || Object.hasOwn(value, "structuredContent") ||
        (application.outcome !== undefined && application.outcome !== "error" && application.outcome !== "rejected")) {
      throw new HarnMcpError("MCP handler failed outside its declared application error contract");
    }
    const error = createWireCodec(binding.ir.types, operation.application_error).decode(application.data);
    return new ApplicationFailure(error, application.outcome) as O;
  }
  if (application !== undefined || !Object.hasOwn(value, "structuredContent") || operation.output.kind !== "value") throw new HarnMcpError("MCP tool result violates its output contract");
  let content = value.structuredContent;
  if (operation.output.mcp_envelope === "result_property") {
    if (!jsonObject(content) || Object.keys(content).length !== 1 || !Object.hasOwn(content, "result")) throw new HarnMcpError("Malformed MCP output envelope");
    content = content.result;
  }
  return createWireCodec<O>(binding.ir.types, operation.output.type_id).decode(content);
}

export type RuntimeHandler = (input: never, context: HandlerContext) => unknown;

/** Decode once before handler entry and encode once before returning to MCP. */
export async function dispatchGenerated(binding: GeneratedBinding, handlers: Readonly<Record<string, RuntimeHandler>>,
  name: string, arguments_: LosslessJsonValue, signal: AbortSignal): Promise<Record<string, LosslessJsonValue>> {
  const operation = binding.ir.operations.find(operation => operation.name === name);
  if (!operation || operation.output.kind !== "value" || !Object.hasOwn(handlers, operation.name)) throw new HarnMcpError("Unknown generated MCP operation");
  signal.throwIfAborted();
  const input = createWireCodec(binding.ir.types, operation.input).decode(arguments_);
  const value = await handlers[operation.name](input as never, { signal });
  signal.throwIfAborted();
  if (value instanceof ApplicationFailure) {
    if (!operation.application_error || (value.outcome !== undefined && value.outcome !== "error" && value.outcome !== "rejected")) throw new HarnMcpError("Handler returned an undeclared application failure");
    const data = createWireCodec(binding.ir.types, operation.application_error).encode(value.error);
    const application: Record<string, LosslessJsonValue> = { tool: operation.name, data };
    if (value.outcome !== undefined) application.outcome = value.outcome;
    return { isError: true, content: [], _meta: { [HARN_MCP_TOOL_CONTRACT_META_KEY]: { applicationError: application } } };
  }
  const encoded = createWireCodec(binding.ir.types, operation.output.type_id).encode(value);
  return { isError: false, content: [], structuredContent: operation.output.mcp_envelope === "bare" ? encoded : { result: encoded } };
}
