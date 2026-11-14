#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { jsonObject, parseLosslessJson, stringifyLosslessJson } from "../lossless-json.js";
import type { CodegenRole } from "../generated/codegen.js";
import { renderBindings } from "./render.js";

const limit = 64 * 1024 * 1024;

async function main(): Promise<number> {
  const arguments_ = process.argv.slice(2);
  if (arguments_.length === 0) {
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of process.stdin) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > limit) throw new Error("Codegen request exceeds 64 MiB");
      chunks.push(buffer);
    }
    const request = parseLosslessJson(Buffer.concat(chunks).toString("utf8"));
    if (!jsonObject(request) || request.schema_version !== "harn-codegen-request/1.0" ||
        (request.role !== "client" && request.role !== "server" && request.role !== "both") || !jsonObject(request.ir)) throw new Error("Unsupported Harn codegen request");
    process.stdout.write(JSON.stringify(renderBindings(stringifyLosslessJson(request.ir), request.role)) + "\n");
    return 0;
  }
  if (arguments_.includes("--help")) {
    process.stdout.write("harn-typescript-codegen --file FILE --out DIRECTORY [--role client|server|both] [--surface exports|script] [--select OPERATION] [--ir FROZEN_IR] [--check] [--harn EXECUTABLE]\nharn-typescript-codegen --input VALIDATED_IR [--role client|server|both] [--harn EXECUTABLE]\n\nHarn validates IR, isolates the renderer and owns publication and --check. --input writes a generated artifact response to stdout.\n");
    return 0;
  }
  const values = new Map<string, string>(), selected: string[] = [];
  let check = false;
  for (let index = 0; index < arguments_.length; index++) {
    const key = arguments_[index];
    if (key === "--check") { if (check) throw new Error("Duplicate --check"); check = true; continue; }
    if (!["--file", "--out", "--role", "--surface", "--select", "--ir", "--input", "--harn"].includes(key)) throw new Error(`Unknown codegen option: ${key}`);
    const value = arguments_[++index];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${key}`);
    if (key === "--select") selected.push(value);
    else { if (values.has(key)) throw new Error(`Duplicate ${key}`); values.set(key, value); }
  }
  const harn = values.get("--harn") ?? process.env.HARN_BIN ?? "harn";
  const role = values.get("--role") ?? "both";
  if (role !== "client" && role !== "server" && role !== "both") throw new Error("Invalid codegen role");
  if (values.has("--input")) {
    if (check || selected.length || ["--file", "--out", "--surface", "--ir"].some(key => values.has(key))) throw new Error("--input accepts only --role and --harn");
    const validated = spawnSync(harn, ["codegen", "validate-ir", "--input", resolve(values.get("--input")!)], { encoding: "utf8", maxBuffer: limit });
    if (validated.error) throw validated.error;
    if (validated.status !== 0) { process.stderr.write(validated.stderr); return validated.status ?? 2; }
    process.stdout.write(JSON.stringify(renderBindings(validated.stdout, role as CodegenRole)) + "\n");
    return 0;
  }
  if (!values.has("--file") || !values.has("--out")) throw new Error("--file and --out are required");
  const executable = resolve(process.argv[1]);
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const args = ["codegen", "generate", "--file", resolve(values.get("--file")!), "--out", resolve(values.get("--out")!),
    "--plugin", executable, "--plugin-read-root", packageRoot, "--role", role];
  for (const key of ["--surface", "--ir"]) if (values.has(key)) args.push(key, key === "--ir" ? resolve(values.get(key)!) : values.get(key)!);
  for (const selected_ of selected) args.push("--select", selected_);
  if (check) args.push("--check");
  const generated = spawnSync(harn, args, { stdio: "inherit" });
  if (generated.error) throw generated.error;
  return generated.status ?? 2;
}

try { process.exitCode = await main(); }
catch (error) { process.stderr.write((error instanceof Error ? error.message : "TypeScript generation failed") + "\n"); process.exitCode = 2; }
