import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import * as projection from "../src/generated/codegen.js";

it("uses the complete mechanically generated Harn protocol facts", async () => {
  const facts = JSON.parse(await readFile(new URL("../spec/harn-codegen-protocol.json", import.meta.url), "utf8"));
  expect(facts.WIRE_MAX_VALUE_DEPTH).toBe(128);
  expect(facts.MCP_PROTOCOL_VERSION).toBe("2026-07-28");
  expect({ ...projection }).toEqual(facts);
});
