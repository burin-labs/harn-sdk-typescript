import { parseApprovalWebhook } from "../src/index.js";
import { stdin } from "node:process";

let body = "";
for await (const chunk of stdin) {
  body += String(chunk);
}
const webhook = await parseApprovalWebhook(body, {
  secret: process.env.HARN_WEBHOOK_SECRET,
  signature: process.env.HARN_WEBHOOK_SIGNATURE,
  timestamp: process.env.HARN_WEBHOOK_TIMESTAMP,
  toleranceSeconds: 300,
});

console.log({
  taskId: webhook.task?.id,
  taskStatus: webhook.task?.status,
  event: webhook.event?.event,
});
