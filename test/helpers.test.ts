import { describe, expect, it } from "vitest";
import {
  apiKeyAuth,
  defineTool,
  isApprovalRequired,
  parseApprovalWebhook,
  runTool,
  textPart,
  toolCallPart,
  toolResultPart,
} from "../src/index.js";

describe("helpers", () => {
  it("creates bearer auth headers from API keys", async () => {
    await expect(apiKeyAuth("key")({ method: "GET", url: new URL("https://example.test") })).resolves.toEqual({
      Authorization: "Bearer key",
    });
  });

  it("detects approval task states", () => {
    expect(isApprovalRequired({ status: "INPUT_REQUIRED" })).toBe(true);
    expect(isApprovalRequired({ status: "AUTH_REQUIRED" })).toBe(true);
    expect(isApprovalRequired({ status: "WORKING" })).toBe(false);
  });

  it("parses approval webhooks without mutating payloads", async () => {
    const webhook = await parseApprovalWebhook({
      task: { object: "task", status: "INPUT_REQUIRED" },
      event: { object: "event", event: "approval.requested" },
    });

    expect(webhook.task?.status).toBe("INPUT_REQUIRED");
    expect(webhook.event?.event).toBe("approval.requested");
  });

  it("requires webhook timestamps when replay tolerance is configured", async () => {
    await expect(parseApprovalWebhook({}, { toleranceSeconds: 300 })).rejects.toThrow("timestamp is required");
  });

  it("defines and runs typed tools", async () => {
    const tool = defineTool<{ value: number }, { doubled: number }>({
      name: "double",
      handler: ({ value }) => ({ doubled: value * 2 }),
    });

    await expect(runTool(tool, { value: 4 })).resolves.toEqual({ doubled: 8 });
  });

  it("builds common message parts", () => {
    expect(textPart("hello")).toEqual({ type: "text", text: "hello", visibility: "public" });
    expect(toolCallPart("call_1", "lookup", { q: "harn" })).toMatchObject({
      type: "tool_call",
      visibility: "internal",
    });
    expect(toolResultPart("call_1", { ok: true })).toMatchObject({
      type: "tool_result",
      status: "ok",
      visibility: "internal",
    });
  });
});
