import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import ts from "typescript";
import { parse } from "yaml";

const EXPECTED_MANIFEST = `language=typescript
harn_version=0.10.116
sdk_version=0.10.0
openapi_spec=spec/openapi.yaml
openapi_sha256=279739bbe7aff1242dcdb68d6061776277927701b8e0da3fd1d80120b200557a
generator=@hey-api/openapi-ts@0.97.0
typescript=typescript@6.0.3
`;
const EXPECTED_SPEC_SHA256 = "279739bbe7aff1242dcdb68d6061776277927701b8e0da3fd1d80120b200557a";
const EXPECTED_NORMALIZED_ARTIFACT_SHA256 =
  "29d153a16b0bc2b5a7cf9b6e200f44edb2cc676c08e9400e7718feec523f51e3";
const artifactRoot = "src/generated/protocol";

const [manifest, specSource, generatedIndex] = await Promise.all([
  readFile("src/generated/protocol/harn-sdk-generation.txt", "utf8"),
  readFile("spec/openapi.yaml", "utf8"),
  readFile("src/generated/protocol/index.ts", "utf8"),
]);

assertEqual(manifest, EXPECTED_MANIFEST, "generation manifest");
assertEqual(
  createHash("sha256").update(specSource).digest("hex"),
  EXPECTED_SPEC_SHA256,
  "OpenAPI SHA-256",
);
assertEqual(
  await hashTree(artifactRoot),
  EXPECTED_NORMALIZED_ARTIFACT_SHA256,
  "normalized generated artifact SHA-256",
);

const document = parse(specSource);
const operationIds = new Set();
for (const pathItem of Object.values(document.paths ?? {})) {
  for (const operation of Object.values(pathItem ?? {})) {
    if (operation && typeof operation === "object" && "operationId" in operation) {
      operationIds.add(operation.operationId);
    }
  }
}

const sourceFile = ts.createSourceFile(
  "index.ts",
  generatedIndex,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
);
const exports = new Set();
for (const statement of sourceFile.statements) {
  if (!ts.isExportDeclaration(statement) || !statement.exportClause) continue;
  if (!ts.isNamedExports(statement.exportClause)) continue;
  for (const element of statement.exportClause.elements) {
    if (!element.isTypeOnly) exports.add(element.name.text);
  }
}

const missing = [...operationIds].filter((name) => !exports.has(name)).sort();
if (operationIds.size !== 85 || missing.length > 0) {
  throw new Error(
    `Expected all 85 OpenAPI operations in the generated client; found ${operationIds.size}, ` +
      `missing: ${missing.join(", ") || "none"}`,
  );
}

console.log(`Verified Harn v0.10.116 protocol artifact: ${operationIds.size} operations.`);

async function hashTree(root) {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const paths = entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
  const hash = createHash("sha256");
  for (const path of paths) {
    const content = await readFile(path);
    if (path.endsWith(".ts")) checkRelativeImports(path, content.toString("utf8"));
    hash.update(relative(root, path));
    hash.update("\0");
    hash.update(content);
    hash.update("\0");
  }
  return hash.digest("hex");
}

function checkRelativeImports(path, source) {
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
    const specifier = statement.moduleSpecifier;
    if (!specifier || !ts.isStringLiteral(specifier) || !specifier.text.startsWith(".")) continue;
    if (!specifier.text.endsWith(".js")) {
      throw new Error(`${path} has a Node-incompatible relative import: ${specifier.text}`);
    }
    const target = join(dirname(path), specifier.text.replace(/\.js$/, ".ts"));
    if (!existsSync(target)) {
      throw new Error(`${path} imports a missing generated module: ${specifier.text}`);
    }
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} does not match the pinned Harn v0.10.116 artifact`);
  }
}
