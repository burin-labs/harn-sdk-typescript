import { HarnClient, pollForApproval } from "../src/index.js";

const taskId = process.argv[2];
if (!taskId) {
  throw new Error("Usage: pnpm tsx examples/approval-polling.ts <task-id>");
}

const client = new HarnClient({
  baseUrl: process.env.HARN_BASE_URL ?? "http://localhost:8080",
  apiKey: process.env.HARN_API_KEY ?? "dev-api-key",
});

const task = await pollForApproval(client, taskId, { timeoutMs: 60_000 });
console.log(`Task ${task.id} needs approval: ${task.status}`);
