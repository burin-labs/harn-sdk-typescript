import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const owner = fileURLToPath(new URL("../", import.meta.url));
const harnIndex = process.argv.indexOf("--harn");
const harn = harnIndex < 0 ? undefined : process.argv[harnIndex + 1];
const receiptIndex = process.argv.indexOf("--receipt");
const receiptArgument = receiptIndex < 0 ? undefined : process.argv[receiptIndex + 1];
if (receiptIndex >= 0 && (!receiptArgument || receiptArgument.startsWith("--"))) throw new Error("--receipt requires a path");
const receipt = receiptArgument && resolve(receiptArgument);
if (receipt) {
  await mkdir(dirname(receipt), { recursive: true });
  await writeFile(receipt, JSON.stringify({ status: "running", pending: 1, failing: [] }) + "\n");
}
if (harnIndex >= 0 && (!harn || harn.startsWith("--"))) throw new Error("--harn requires an executable");
if (receiptArgument && (!harn || !isAbsolute(harn))) throw new Error("--receipt requires --harn with an absolute executable path");
const temporary = await mkdtemp(join(tmpdir(), "harn-packed-bindings-"));
let passed = false;

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function run(program, args, cwd) {
  const result = spawnSync(program, args, { cwd, encoding: "utf8", timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`${program} failed: ${result.error?.message ?? result.stderr + result.stdout}`);
  return result.stdout;
}

try {
  const runtimeVersion = harn && JSON.parse(run(harn, ["version", "--json"], temporary));
  const package_ = JSON.parse(await readFile(join(owner, "package.json"), "utf8"));
  run("pnpm", ["pack", "--pack-destination", temporary], owner);
  const artifact = join(temporary, `${package_.name.replace(/^@/, "").replace("/", "-")}-${package_.version}.tgz`);
  await writeFile(join(temporary, "package.json"), JSON.stringify({ name: "harn-packed-consumer-proof", private: true, type: "module" }));
  run("pnpm", ["add", artifact, `typescript@${package_.devDependencies.typescript.replace(/^\^/, "")}`], temporary);
  for (const name of ["pathological.ir.json", "pathological.input.json"]) await cp(join(owner, "test/fixtures", name), join(temporary, name));
  await cp(join(owner, "test/packed-consumer/probe.mjs"), join(temporary, "probe.mjs"));
  process.stdout.write(run(process.execPath, ["probe.mjs"], temporary));
  if (harn) {
    run("pnpm", ["add", `express@${package_.devDependencies.express.replace(/^\^/, "")}`,
      `@types/express@${package_.devDependencies["@types/express"].replace(/^\^/, "")}`], temporary);
    await cp(join(owner, "examples/pathological/source"), join(temporary, "examples/pathological/source"), { recursive: true });
    await cp(join(owner, "examples/pathological/payload.ts"), join(temporary, "examples/pathological/payload.ts"));
    await cp(join(owner, "examples/express-generated-tools.ts"), join(temporary, "examples/express-generated-tools.ts"));
    await cp(join(owner, "test/packed-consumer/product.mjs"), join(temporary, "product.mjs"));
    process.stdout.write(run(process.execPath, ["product.mjs", harn], temporary));
    if (receipt) {
      const report = JSON.parse(await readFile(join(temporary, "product-report.json"), "utf8"));
      assert.equal(report.packed_install, true);
      assert.equal(report.pending, 0);
      assert.deepEqual(report.failing, []);
      await writeFile(receipt, JSON.stringify({ ...report, status: "passed",
        runtime_version: runtimeVersion,
        runtime_sha256: await sha256(harn), package_archive_sha256: await sha256(artifact),
      }, null, 2) + "\n");
    }
  }
  passed = true;
} finally {
  if (passed) await rm(temporary, { recursive: true, force: true });
  else process.stderr.write(`Failed packed-consumer artifacts retained in ${temporary}\n`);
}
