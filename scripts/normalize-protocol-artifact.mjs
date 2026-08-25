import { existsSync, statSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const root = "src/generated/protocol";
const entries = await readdir(root, { recursive: true, withFileTypes: true });
let changed = 0;

for (const entry of entries) {
  if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
  const path = join(entry.parentPath, entry.name);
  const source = await readFile(path, "utf8");
  let normalized = source.replace(
    /(\bfrom\s+['"])(\.[^'"]+)(['"])/g,
    (_match, prefix, specifier, suffix) => {
      const withoutJs = specifier.replace(/\.js$/, "");
      const candidate = join(dirname(path), withoutJs);
      const resolved =
        existsSync(candidate) && statSync(candidate).isDirectory()
          ? `${withoutJs}/index.js`
          : hasRuntimeExtension(specifier)
            ? specifier
            : `${specifier}.js`;
      return `${prefix}${resolved}${suffix}`;
    },
  );
  if (path.endsWith("types.gen.ts")) {
    normalized = normalized.replace(/^    headers: \{$/gm, "    headers?: {");
  }
  if (normalized !== source) {
    await writeFile(path, normalized);
    changed += 1;
  }
}

console.log(`Normalized protocol artifact in ${changed} generated files.`);

function hasRuntimeExtension(specifier) {
  return /\.(?:cjs|js|json|mjs)$/.test(specifier);
}
