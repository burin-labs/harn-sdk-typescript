import express from "express";
import { HarnClient } from "@burin-labs/harn";
import { Client } from "./pathological/generated/client.js";
import { payload } from "./pathological/payload.js";

export function createGeneratedToolsApp(transport: HarnClient) {
  const app = express();
  const client = new Client(transport);
  app.get("/typed-echo", async (_request, response, next) => {
    const cancellation = new AbortController();
    response.once("close", () => { if (!response.writableEnded) cancellation.abort(); });
    try {
      const result = await client.echo({ input: payload() }, { signal: cancellation.signal });
      response.json({ sequence: result.sequence.toString(), amount: result.amount.toString(),
        bytes: [...result.raw], nested: result.right.detail.token.toString(), tree: result.tree.value.toString(),
        optionalPresent: Object.hasOwn(result, "optional"), nullable: result.nullable });
    } catch (error) { next(error); }
  });
  return app;
}

if (process.env.HARN_GENERATED_EXAMPLE_MAIN === "1") {
  const harn = new HarnClient({ baseUrl: process.env.HARN_MCP_BASE_URL ?? "http://127.0.0.1:8765",
    ...(process.env.HARN_ACCESS_TOKEN ? { accessToken: process.env.HARN_ACCESS_TOKEN } : {}) });
  createGeneratedToolsApp(harn).listen(3000, "127.0.0.1", () => console.log("Typed example ready at http://127.0.0.1:3000/typed-echo"));
}
