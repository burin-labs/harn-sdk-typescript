import { describe, expect, it } from "vitest";
import {
  apiKeyAuth,
  defineTool,
  isApprovalRequired,
  oauth2DeviceFlow,
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

  it("verifies Harn Cloud outbound webhook signatures over timestamp and raw body", async () => {
    const body = JSON.stringify({
      task: { object: "task", status: "INPUT_REQUIRED" },
      event: { object: "event", event: "approval.requested" },
    });
    const timestamp = "1778889600";
    const signature = `t=${timestamp},v1=${await hmacSha256Hex("whsec_test", `${timestamp}.${body}`)}`;

    const webhook = await parseApprovalWebhook(body, {
      secret: "whsec_test",
      signature,
      toleranceSeconds: 300,
      now: () => 1778889600 * 1000,
    });

    expect(webhook.task?.status).toBe("INPUT_REQUIRED");
  });

  it("rejects webhook signatures that do not cover the timestamp", async () => {
    const body = JSON.stringify({ ok: true });
    const signature = `t=1778889600,v1=${await hmacSha256Hex("whsec_test", body)}`;

    await expect(
      parseApprovalWebhook(body, {
        secret: "whsec_test",
        signature,
        toleranceSeconds: 300,
        now: () => 1778889600 * 1000,
      }),
    ).rejects.toThrow("signature verification failed");
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

  it("preserves pathful OIDC issuer URLs and uses injectable polling clocks", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const clientFetch: typeof fetch = async (url, init = {}) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/tenant/.well-known/openid-configuration")) {
        return Response.json({
          device_authorization_endpoint: "https://auth.example.test/tenant/oauth/device/code",
          token_endpoint: "https://auth.example.test/tenant/oauth/token",
        });
      }
      if (String(url).endsWith("/oauth/device/code")) {
        return Response.json({
          device_code: "device_1",
          user_code: "ABCD",
          verification_uri: "https://auth.example.test/activate",
          expires_in: 60,
          interval: 1,
        });
      }
      return Response.json({ access_token: "access_1", token_type: "Bearer" });
    };

    const flow = await oauth2DeviceFlow({
      issuerUrl: "https://auth.example.test/tenant",
      clientId: "client_1",
      fetch: clientFetch,
    });
    const token = await flow.pollForToken({ now: () => 0, sleep: async () => undefined });

    expect(calls[0]?.url).toBe("https://auth.example.test/tenant/.well-known/openid-configuration");
    expect(token.access_token).toBe("access_1");
    await expect(flow.auth({ method: "GET", url: new URL("https://api.example.test") })).resolves.toEqual({
      Authorization: "Bearer access_1",
    });
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

async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
