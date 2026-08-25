import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createProviderCatalogApp } from "../examples/express-provider-catalog.js";
import { createHarnProtocolClient } from "../src/index.js";

describe("Express incremental-adoption example", () => {
  it("executes a generated v0.10.116 operation through an existing app route", async () => {
    const seen: Request[] = [];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const client = createHarnProtocolClient({
      baseUrl: "https://example.test",
      accessToken: "test-token",
      fetch: async (input) => {
        const recorded = input instanceof Request ? input : new Request(input);
        seen.push(recorded);
        return Response.json({
          schema_version: 6,
          schema: "https://harnlang.com/schemas/provider-catalog.v6.json",
          generated_by: "test",
          providers: [],
          models: [],
          aliases: [],
          variants: [],
          families: [],
          qc_defaults: {},
        });
      },
    });

    const response = await request(createProviderCatalogApp(client)).get("/models");

    expect(response.status).toBe(200);
    expect(response.body.schema_version).toBe(6);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe("https://example.test/v1/provider-catalog");
    expect(seen[0]?.headers.get("authorization")).toBe("Bearer test-token");
    expect(seen[0]?.headers.get("harn-agents-protocol-version")).toBe(
      "agents-protocol-2026-04-25",
    );
    warn.mockRestore();
  });
});
