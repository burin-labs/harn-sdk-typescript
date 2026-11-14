import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const owner = fileURLToPath(new URL("../", import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), "harn-packed-bindings-"));
const harnIndex = process.argv.indexOf("--harn");
const harn = harnIndex < 0 ? undefined : process.argv[harnIndex + 1];
if (harnIndex >= 0 && !harn) throw new Error("--harn requires an executable");
let passed = false;

function run(program, args, cwd) {
  const result = spawnSync(program, args, { cwd, encoding: "utf8", timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`${program} failed: ${result.error?.message ?? result.stderr + result.stdout}`);
  return result.stdout;
}

try {
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
  }
  passed = true;
} finally {
  if (passed) await rm(temporary, { recursive: true, force: true });
  else process.stderr.write(`Failed packed-consumer artifacts retained in ${temporary}\n`);
}
