import { HarnClient, textPart } from "../src/index.js";

const client = new HarnClient({
  baseUrl: process.env.HARN_BASE_URL ?? "http://localhost:8080",
  apiKey: process.env.HARN_API_KEY ?? "dev-api-key",
});

const session = await client.createSession({
  workspace_id: "workspace_local",
  initial_messages: [{ role: "user", parts: [textPart("Prepare a release checklist.")] }],
});

const task = await client.submitSessionTask(session.id, {
  input: { role: "user", parts: [textPart("Summarize current blockers.")] },
});

console.log({ sessionId: session.id, taskId: task.id, status: task.status });
