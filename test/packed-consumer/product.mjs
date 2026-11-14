import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = process.cwd();
const harn = process.argv[2];
assert(harn, "the real Harn executable is required");
const backend = join(root, "node_modules/.bin/harn-typescript-codegen");
function run(program, args) {
  const result = spawnSync(program, args, { cwd: root, encoding: "utf8", timeout: 120000,
    maxBuffer: 64 * 1024 * 1024 });
  assert.equal(result.status, 0, result.error?.message ?? result.stderr + result.stdout);
  return result;
}
const source = "examples/pathological/source/server.harn";
const generated = "examples/pathological/generated";
const commands = new Map();
let identity;
await writeFile("contract.ir.json", run(harn, ["codegen", "ir", "--file", source]).stdout);
for (const role of ["client", "server", "both"]) {
  const args = ["--harn", harn, "--file", source, "--out", role === "both" ? generated : role,
    "--role", role, "--ir", "contract.ir.json"];
  run(backend, args);
  run(backend, [...args, "--check"]);
  const ir = JSON.parse(await readFile("contract.ir.json", "utf8"));
  if (identity) assert.deepEqual(ir.identity, identity);
  identity = ir.identity;
  const offline = JSON.parse(run(backend, ["--harn", harn, "--input", "contract.ir.json", "--role", role]).stdout);
  assert.deepEqual(offline.identity, identity);
  assert.equal(offline.artifacts.some(artifact => artifact.path === "client.ts"), role !== "server");
  assert.equal(offline.artifacts.some(artifact => artifact.path === "server.ts"), role !== "client");
  commands.set(role, args);
}
const clientPath = join(generated, "client.ts");
const original = await readFile(clientPath, "utf8");
const modified = original + "\n// deliberate consumer drift\n";
await writeFile(clientPath, modified);
const drift = spawnSync(backend, [...commands.get("both"), "--check"], { cwd: root, encoding: "utf8", timeout: 120000 });
assert.equal(drift.status, 2, drift.stderr);
assert.equal(JSON.parse(drift.stderr).code, "artifact_drift");
assert.equal(await readFile(clientPath, "utf8"), modified);
await writeFile(clientPath, original);

await writeFile("worker.ts", `import { defineHandlers, serve } from './${generated}/server.js';
import { ApplicationFailure } from '@burin-labs/harn';
import { appendFileSync } from 'node:fs';
import { Transform, Writable } from 'node:stream';
const trace = ${JSON.stringify(join(root, "native-frames.jsonl"))};
const stdin = new Transform({ transform(chunk, _encoding, next) {
  appendFileSync(trace, JSON.stringify({direction:'in',bytes:String(chunk)})+'\\n'); next(null, chunk);
}});
process.stdin.pipe(stdin);
const stdout = new Writable({ write(chunk, _encoding, next) {
  appendFileSync(trace, JSON.stringify({direction:'out',bytes:String(chunk)})+'\\n'); process.stdout.write(chunk, next);
}});
serve(defineHandlers({
  echo: ({input}) => ({...input, optional: 'native-handler-reached'}),
  mutate: ({input}) => input,
  reject: () => new ApplicationFailure({enum:'Failure' as const, variant:'Rejected' as const, fields:['native-rejected'] as const}),
  scheduled: ({input}) => input
}), {maxConcurrency:2, stdin, stdout});\n`);
await writeFile("tsconfig-product.json", JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext",
  moduleResolution: "NodeNext", strict: true, exactOptionalPropertyTypes: true, skipLibCheck: true,
  rootDir: ".", outDir: "product-build" }, include: ["examples/**/*.ts", "worker.ts"] }));
run(join(root, "node_modules/.bin/tsc"), ["-p", "tsconfig-product.json"]);
const { HarnClient, HarnDecimal, ApplicationFailure } = await import("@burin-labs/harn");
const { Client } = await import("./product-build/examples/pathological/generated/client.js");
const { payload } = await import("./product-build/examples/pathological/payload.js");
const { createGeneratedToolsApp } = await import("./product-build/examples/express-generated-tools.js");

// Compare complete values while ignoring the implementation of ReadonlySet.
// Every scalar kind and every present record key remains part of the assertion.
function comparable(value) {
  if (value === null) return ["null"];
  if (typeof value === "bigint") return ["integer", String(value)];
  if (typeof value !== "object") return [typeof value, value];
  if (value instanceof HarnDecimal) return ["decimal", value.toString()];
  if (value instanceof Uint8Array) return ["bytes", [...value]];
  if (Array.isArray(value)) return ["list", value.map(comparable)];
  if (Object.prototype.toString.call(value) === "[object Set]") {
    return ["set", [...value].map(comparable).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))];
  }
  return ["record", Object.keys(value).sort().map(key => [key, comparable(value[key])])];
}
function equalValues(actual, expected) { assert.deepEqual(comparable(actual), comparable(expected)); }
assert.throws(() => equalValues({ value: 1n }, { value: 1 }));
assert.throws(() => equalValues({ optional: undefined }, {}));
assert.throws(() => equalValues(new Set([true, 1n]), new Set([1n])));

async function withServer(file, surface, check) {
  const process_ = spawn(harn, ["serve", "mcp", "--surface", surface, "--transport", "http", "--bind",
    "127.0.0.1:0", "--obs", "off", file], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  let logs = "";
  process_.stdout.resume();
  process_.stderr.setEncoding("utf8");
  try {
    const baseUrl = await new Promise((resolveReady, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Harn readiness timed out: ${logs}`)), 30000);
      timeout.unref();
      process_.once("exit", (code, signal) => { clearTimeout(timeout); reject(new Error(`Harn exited ${code}/${signal}: ${logs}`)); });
      process_.stderr.on("data", chunk => {
        logs += chunk;
        const match = logs.match(/MCP workflow server ready on (http:\/\/127\.0\.0\.1:[0-9]+)\/mcp/);
        if (match) { clearTimeout(timeout); resolveReady(match[1]); }
      });
    });
    await check(baseUrl);
  } finally {
    if (process_.exitCode === null && process_.signalCode === null) {
      process_.kill("SIGTERM");
      await once(process_, "exit");
    }
    await writeFile(`harn-${surface}.log`, logs);
  }
}

const input = payload();
const methods = [];
await withServer(source, "exports", async baseUrl => {
  const transport = new HarnClient({ baseUrl, fetch: async (url, options) => {
    methods.push(JSON.parse(String(options?.body)).method);
    return await fetch(url, options);
  } });
  const client = new Client(transport);
  equalValues(await client.echo({ input }), input);
  const failure = await client.reject({ input });
  assert(failure instanceof ApplicationFailure);
  assert.deepEqual(failure.error, { enum: "Failure", variant: "Rejected", fields: ["rejected"] });
  equalValues(await client.scheduled({ input }), input);
  assert(methods.includes("tasks/get"), "the actual Harn task owner must be reached");
  const app = createGeneratedToolsApp(transport).listen(0, "127.0.0.1");
  try {
    await once(app, "listening");
    const address = app.address();
    assert(address && typeof address === "object");
    const response = await fetch(`http://127.0.0.1:${address.port}/typed-echo`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { sequence: "9223372036854775807", amount: "1.2300",
      bytes: [0, 255, 128], nested: "9007199254740993", tree: "7", optionalPresent: false, nullable: null });
  } finally { await new Promise((resolveClosed, reject) => app.close(error => error ? reject(error) : resolveClosed())); }
});

run(harn, ["skill", "list", "--json"]);
await writeFile("native.harn", `import { native_tool_registry } from "std/tools";
fn main(harness: Harness) {
  const registry = native_tool_registry(harness.tools, {
    program: ${JSON.stringify(process.execPath)}, args: [${JSON.stringify(resolve("product-build/worker.js"))}],
    cwd: ${JSON.stringify(root)}
  }, json_parse(harness.fs.read_text(${JSON.stringify(resolve("contract.ir.json"))})), 2);
  harness.tools.mcp_tools(registry);
}\n`);
await writeFile("arguments.json", '{"input":' + (await readFile("pathological.input.json", "utf8")).trim() + '}');
const nativeCli = run(harn, ["tool", "run", "native.harn", "echo", "--harn-input", "@arguments.json"]);
assert(nativeCli.stdout.includes("native-handler-reached"), "the installed TypeScript handler must change the result");
await withServer("native.harn", "script", async baseUrl => {
  const client = new Client(new HarnClient({ baseUrl }));
  equalValues(await client.echo({ input }), { ...input, optional: "native-handler-reached" });
  const failure = await client.reject({ input });
  assert(failure instanceof ApplicationFailure);
  assert.deepEqual(failure.error, { enum: "Failure", variant: "Rejected", fields: ["native-rejected"] });
  equalValues(await client.scheduled({ input }), input);
});
const report = { packed_install: true, canonical_generation: true, roles: [...commands.keys()], identity,
  standalone_ir: true, check_and_preserved_drift: true, strict_generated_compile: true,
  actual_harn_exports: true, exact_rich_values: true, typed_application_failure: true,
  harn_task_owner_reached: true, express_http: true, native_cli_handler_reached: true,
  native_public_mcp_handler_reached: true, methods, pending: 0, failing: [] };
await writeFile("product-report.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
