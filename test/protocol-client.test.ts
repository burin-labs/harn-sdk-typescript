import { describe, expect, it } from "vitest";
import { createHarnProtocolClient } from "../src/index.js";
import { getHealth } from "../src/protocol.js";

describe("generated protocol client security", () => {
  it("omits bearer and protocol headers from public discovery", async () => {
    const seen: Request[] = [];
    const client = createHarnProtocolClient({
      baseUrl: "http://localhost:3000/proxy",
      accessToken: "test-token",
      headers: {
        Authorization: "Bearer caller-supplied-token",
        "Harn-Agents-Protocol-Version": "caller-supplied-version",
      },
      fetch: async (input) => {
        const request = input instanceof Request ? input : new Request(input);
        seen.push(request);
        return Response.json({ ok: true, status: "ready", version: "0.10.116" });
      },
    });

    const result = await getHealth({ client });

    expect(result.data).toMatchObject({ ok: true });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.headers.has("authorization")).toBe(false);
    expect(seen[0]?.headers.has("harn-agents-protocol-version")).toBe(false);
  });
});
