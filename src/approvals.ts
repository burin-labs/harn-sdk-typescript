import type { HarnClient } from "./client.js";
import type { Event, JsonObject, Task, TaskStatus } from "./types.js";

export const APPROVAL_STATUSES = ["INPUT_REQUIRED", "AUTH_REQUIRED"] as const satisfies readonly TaskStatus[];
export const TERMINAL_TASK_STATUSES = ["COMPLETED", "FAILED", "CANCELED"] as const satisfies readonly TaskStatus[];

export interface WaitForTaskOptions {
  signal?: AbortSignal;
  intervalMs?: number;
  timeoutMs?: number;
}

export interface PollForApprovalOptions extends WaitForTaskOptions {
  throwOnTerminal?: boolean;
}

export interface ApprovalWebhook {
  task?: Task;
  event?: Event;
  payload: JsonObject;
}

export interface ApprovalWebhookOptions {
  secret?: string;
  signature?: string | null;
  toleranceSeconds?: number;
  timestamp?: string | null;
}

export function isApprovalRequired(task: Pick<Task, "status">): boolean {
  return task.status === "INPUT_REQUIRED" || task.status === "AUTH_REQUIRED";
}

export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return status === "COMPLETED" || status === "FAILED" || status === "CANCELED";
}

export async function waitForTask(
  client: HarnClient,
  taskId: string,
  options: WaitForTaskOptions = {},
): Promise<Task> {
  const startedAt = Date.now();
  const intervalMs = options.intervalMs ?? 1000;

  while (true) {
    const task = await client.getTask(taskId, { signal: options.signal });
    if (isTerminalTaskStatus(task.status)) {
      return task;
    }
    assertNotTimedOut(startedAt, options.timeoutMs);
    await sleep(intervalMs, options.signal);
  }
}

export async function pollForApproval(
  client: HarnClient,
  taskId: string,
  options: PollForApprovalOptions = {},
): Promise<Task> {
  const startedAt = Date.now();
  const intervalMs = options.intervalMs ?? 1000;

  while (true) {
    const task = await client.getTask(taskId, { signal: options.signal });
    if (isApprovalRequired(task)) {
      return task;
    }
    if (isTerminalTaskStatus(task.status) && options.throwOnTerminal !== false) {
      throw new Error(`Task ${taskId} reached terminal status ${task.status} before approval was requested.`);
    }
    if (isTerminalTaskStatus(task.status)) {
      return task;
    }
    assertNotTimedOut(startedAt, options.timeoutMs);
    await sleep(intervalMs, options.signal);
  }
}

export async function parseApprovalWebhook(
  body: string | Uint8Array | JsonObject,
  options: ApprovalWebhookOptions = {},
): Promise<ApprovalWebhook> {
  const raw = typeof body === "string" ? body : body instanceof Uint8Array ? new TextDecoder().decode(body) : JSON.stringify(body);
  if (options.secret) {
    if (!options.signature) {
      throw new Error("Approval webhook signature is required when a secret is configured.");
    }
    await verifyHmacSha256(raw, options.secret, options.signature);
  }
  if (options.toleranceSeconds !== undefined && !options.timestamp) {
    throw new Error("Approval webhook timestamp is required when a tolerance is configured.");
  }
  if (options.timestamp && options.toleranceSeconds !== undefined) {
    const ageSeconds = Math.abs(Date.now() / 1000 - Number(options.timestamp));
    if (!Number.isFinite(ageSeconds) || ageSeconds > options.toleranceSeconds) {
      throw new Error("Approval webhook timestamp is outside the accepted tolerance.");
    }
  }

  const payload = JSON.parse(raw) as JsonObject;
  return {
    task: isTaskLike(payload.task) ? payload.task : undefined,
    event: isEventLike(payload.event) ? payload.event : undefined,
    payload,
  };
}

async function verifyHmacSha256(payload: string, secret: string, signature: string): Promise<void> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("WebCrypto subtle crypto is required to verify webhook signatures.");
  }

  const normalized = signature.startsWith("sha256=") ? signature.slice("sha256=".length) : signature;
  const key = await subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const digest = await subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  const expected = bytesToHex(new Uint8Array(digest));
  if (!constantTimeEqual(expected, normalized)) {
    throw new Error("Approval webhook signature verification failed.");
  }
}

function isTaskLike(value: unknown): value is Task {
  return typeof value === "object" && value !== null && (value as { object?: unknown }).object === "task";
}

function isEventLike(value: unknown): value is Event {
  return typeof value === "object" && value !== null && (value as { object?: unknown }).object === "event";
}

function assertNotTimedOut(startedAt: number, timeoutMs: number | undefined): void {
  if (timeoutMs !== undefined && Date.now() - startedAt > timeoutMs) {
    throw new Error("Timed out waiting for Harn task state.");
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(new DOMException("Operation was aborted.", "AbortError"));
      },
      { once: true },
    );
  });
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }
  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return result === 0;
}
