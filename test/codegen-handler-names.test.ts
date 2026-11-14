import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";
import { allocateSymbols, operationReservedNames } from "../src/codegen/names.js";
import { renderBindings } from "../src/codegen/render.js";
import type { CodegenIr } from "../src/generated/codegen.js";
import { jsonObject, stringifyLosslessJson } from "../src/lossless-json.js";
import { mcpRequest } from "../src/mcp-rpc.js";

it("runs every canonical wire name through an ordinary compiled handler literal", async () => {
  const raw = await readFile(new URL("./fixtures/harn-codegen-names.ir.json", import.meta.url), "utf8");
  const ir: CodegenIr = JSON.parse(raw);
  expect(ir.operations).toHaveLength(18);
  expect(ir.operations.some(operation => operation.name === "__proto__")).toBe(true);
  const names = allocateSymbols(ir.operations, operationReservedNames);
  const properties = ir.operations.map(operation => {
    const name = names.get(operation.id)!;
    return `${JSON.stringify(name)}: (input: Parameters<Handlers[${JSON.stringify(name)}]>[0]) => { reached.push(${JSON.stringify(operation.name)}); return input; }`;
  }).join(",\n");
  const input = Object.fromEntries(ir.operations.map(operation => [operation.name, 1n]));
  Object.assign(input, { wire_bytes: { $bytes_b64: "AAE=" }, wire_decimal: "1.2300",
    wire_list: [1n], wire_set: [1n, 2n], wire_map: { key: 1n },
    wire_tuple: [{ $bytes_b64: "AAE=" }, 1n] });
  expect(Object.keys(input)).toHaveLength(24);
  const frames = [stringifyLosslessJson(mcpRequest("server/discover", {}, undefined, "discover").body),
    stringifyLosslessJson(mcpRequest("tools/list", {}, undefined, "list").body),
    ...ir.operations.map(operation => {
      const frame = mcpRequest("tools/call", { name: "stdio-fixture", arguments: input }, undefined, operation.id).body;
      if (!jsonObject(frame.params)) throw new Error("Missing canonical request parameters");
      frame.params.name = operation.name;
      return stringifyLosslessJson(frame);
    })];
  const directory = await mkdtemp(join(tmpdir(), "harn-typescript-handler-names-"));
  try {
    await writeFile(join(directory, "package.json"), '{"type":"module"}');
    await mkdir(join(directory, "node_modules/@burin-labs"), { recursive: true });
    await symlink(resolve("."), join(directory, "node_modules/@burin-labs/harn"), "junction");
    for (const artifact of renderBindings(raw, "both").artifacts) {
      await writeFile(join(directory, artifact.path), artifact.content);
    }
    await writeFile(join(directory, "consumer.ts"), `
import { PassThrough } from "node:stream";
import { deepStrictEqual } from "node:assert";
import { defineHandlers, serve, type Handlers } from "./server.js";
function lossless(text: string): unknown {
  return JSON.parse(text, (_key: string, value: unknown, context?: { source?: string }) =>
    typeof value === "number" && context?.source && /^-?(?:0|[1-9][0-9]*)$/.test(context.source) ? BigInt(context.source) : value);
}
const expected = lossless(${JSON.stringify(raw)}) as { mcp_tools: object[] };
if ((lossless('{"value":9223372036854775807}') as { value: bigint }).value !== 9223372036854775807n) throw new Error("Independent integer reader rounded its positive control");
const reached: string[] = [];
const handlers = defineHandlers({ ${properties} });
if (Object.keys(handlers).length !== 18 || Object.getPrototypeOf(handlers) !== Object.prototype) throw new Error("Handler literal lost a property");
const input = new PassThrough(), output = new PassThrough();
const responses: object[] = [], waiters: Array<(value: object) => void> = [];
let buffer = "";
output.setEncoding("utf8");
output.on("data", (chunk: string) => {
  buffer += chunk;
  let newline: number;
  while ((newline = buffer.indexOf("\\n")) >= 0) {
    const response = lossless(buffer.slice(0, newline)) as object;
    buffer = buffer.slice(newline + 1);
    const waiter = waiters.shift();
    if (waiter) waiter(response); else responses.push(response);
  }
});
const handle = serve(handlers, { maxConcurrency: 2, stdin: input, stdout: output });
try {
  for (const frame of ${JSON.stringify(frames)}) {
    input.write(frame + "\\n");
    const response = (responses.shift() ?? await new Promise<object>(resolve => waiters.push(resolve))) as { id: string; error?: object; result?: { tools?: Array<{ inputSchema: { properties: object } }>; structuredContent?: object } };
    if (response.error || !response.result) throw new Error("Canonical operation refused before handler: " + reached.join(","));
    if (response.id === "list") {
      deepStrictEqual(response.result.tools, expected.mcp_tools);
      if (response.result.tools?.length !== 18) throw new Error("Catalog census changed");
      for (const tool of response.result.tools) {
        const properties = tool.inputSchema.properties;
        if (Object.keys(properties).length !== 24 || !Object.hasOwn(properties, "__proto__")) throw new Error("Catalog lost a reserved property");
      }
    }
    if (reached.length && Object.keys(response.result.structuredContent ?? {}).length !== 24) throw new Error("Wire output lost a reserved field");
  }
  if (JSON.stringify(reached) !== ${JSON.stringify(JSON.stringify(ir.operations.map(operation => operation.name)))}) throw new Error("Wire name reached the wrong handler");
  console.log(JSON.stringify({ expected: 18, ownHandlers: Object.keys(handlers).length, reached, pending: 0 }));
} finally { await handle.close(); }
`);
    const program = ts.createProgram([join(directory, "consumer.ts")], {
      strict: true, exactOptionalPropertyTypes: true, skipLibCheck: true,
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      types: ["node"], typeRoots: [resolve("node_modules/@types")], outDir: join(directory, "built"),
    });
    const diagnostics = ts.getPreEmitDiagnostics(program).map(diagnostic => ({ code: diagnostic.code,
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, " ") }));
    expect(diagnostics).toEqual([]);
    expect(program.emit().emitSkipped).toBe(false);
    const result = spawnSync(process.execPath, [join(directory, "built/consumer.js")], {
      encoding: "utf8", timeout: 30000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report).toEqual({ expected: 18, ownHandlers: 18,
      reached: ir.operations.map(operation => operation.name), pending: 0 });
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 40000);
