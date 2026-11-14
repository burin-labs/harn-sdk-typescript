import type { JsonObject, JsonValue, Part } from "./types.js";

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
