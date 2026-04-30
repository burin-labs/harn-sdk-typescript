import { HarnClient } from "../src/index.js";

const taskId = process.argv[2];
if (!taskId) {
  throw new Error("Usage: pnpm tsx examples/stream-task-events.ts <task-id>");
}

const client = new HarnClient({
  baseUrl: process.env.HARN_BASE_URL ?? "http://localhost:8080",
  apiKey: process.env.HARN_API_KEY ?? "dev-api-key",
});

for await (const event of client.streamTaskEvents(taskId)) {
  console.log(event.sequence, event.event, event.payload);
}
