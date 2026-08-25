import express from "express";
import { pathToFileURL } from "node:url";
import {
  createHarnProtocolClient,
  HARN_PROTOCOL_HEADERS,
} from "../src/index.js";
import { getProviderCatalog } from "../src/protocol.js";
import type { ProtocolClient } from "../src/protocol.js";

export function createProviderCatalogApp(client: ProtocolClient) {
  const app = express();

  app.get("/models", async (_request, response, next) => {
    try {
      const result = await getProviderCatalog({
        client,
        headers: HARN_PROTOCOL_HEADERS,
      });
      if (result.error !== undefined) {
        response.status(result.response?.status ?? 502).json(result.error);
        return;
      }
      response.json(result.data);
    } catch (error) {
      next(error);
    }
  });

  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const client = createHarnProtocolClient({
    baseUrl: process.env.HARN_BASE_URL,
    accessToken: process.env.HARN_ACCESS_TOKEN,
  });
  const port = Number(process.env.PORT ?? 3000);
  createProviderCatalogApp(client).listen(port, () => {
    console.log(`Provider catalog route listening on http://localhost:${port}/models`);
  });
}
