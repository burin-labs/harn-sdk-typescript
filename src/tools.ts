import type { JsonObject, JsonValue, Part } from "./types.js";

export interface HarnToolContext {
  taskId?: string;
  sessionId?: string;
  metadata?: JsonObject;
}

export type ToolResult<TOutput extends JsonValue = JsonValue> = TOutput | Promise<TOutput>;
export type ToolHandler<TInput extends JsonObject = JsonObject, TOutput extends JsonValue = JsonValue> = (
  input: TInput,
  context: HarnToolContext,
) => ToolResult<TOutput>;

export interface HarnTool<TInput extends JsonObject = JsonObject, TOutput extends JsonValue = JsonValue> {
  name: string;
  description?: string;
  inputSchema?: JsonObject;
  handler: ToolHandler<TInput, TOutput>;
}

export function defineTool<TInput extends JsonObject, TOutput extends JsonValue>(
  tool: HarnTool<TInput, TOutput>,
): HarnTool<TInput, TOutput> {
  return tool;
}

export async function runTool<TInput extends JsonObject, TOutput extends JsonValue>(
  tool: HarnTool<TInput, TOutput>,
  input: TInput,
  context: HarnToolContext = {},
): Promise<TOutput> {
  return tool.handler(input, context);
}

type PartVisibility = "public" | "internal" | "receipt_only";

export function textPart(text: string, visibility: PartVisibility = "public"): Part {
  return { type: "text", text, visibility };
}

export function toolCallPart(
  toolCallId: string,
  name: string,
  input: JsonObject,
  visibility: PartVisibility = "internal",
): Part {
  return { type: "tool_call", tool_call_id: toolCallId, name, input, visibility };
}

export function toolResultPart(
  toolCallId: string,
  output: JsonValue,
  status: "ok" | "error" = "ok",
  visibility: PartVisibility = "internal",
): Part {
  return { type: "tool_result", tool_call_id: toolCallId, output, status, visibility };
}
