import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { renderBindings } from "../src/codegen/render.js";

const raw = await readFile(new URL("./fixtures/pathological.ir.json", import.meta.url), "utf8");

describe("shared Harn fixture generation", () => {
  it("compiles the canonical operation-name corpus without colliding with Client members", async () => {
    const corpus = await readFile(new URL("./fixtures/harn-codegen-names.ir.json", import.meta.url), "utf8");
    const ir = JSON.parse(corpus);
    expect(ir.operations).toHaveLength(18);
    expect(ir.operations.some((operation: { name: string }) => operation.name === "constructor")).toBe(true);
    expect(ir.operations.some((operation: { name: string }) => operation.name === "transport")).toBe(true);
    expect(ir.types.map((type: { shape: { kind: string } }) => type.shape.kind)).toEqual(
      expect.arrayContaining(["bytes", "decimal", "list", "set", "map", "tuple"]));
    const directory = await mkdtemp(join(tmpdir(), "harn-typescript-name-corpus-"));
    try {
      const response = renderBindings(corpus, "both");
      for (const artifact of response.artifacts) await writeFile(join(directory, artifact.path), artifact.content);
      await writeFile(join(directory, "package.json"), '{"type":"module"}');
      const program = ts.createProgram([join(directory, "index.ts")], {
        strict: true, exactOptionalPropertyTypes: true, noEmit: true, skipLibCheck: true,
        target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
        types: ["node"], typeRoots: [resolve("node_modules/@types")],
        paths: {
          "@burin-labs/harn": [resolve("dist/index.d.ts")],
          "@burin-labs/harn/bindings": [resolve("dist/binding-runtime.d.ts")],
          "@burin-labs/harn/native": [resolve("dist/native.d.ts")],
        },
      });
      const diagnostics = ts.getPreEmitDiagnostics(program).map(diagnostic => ({ code: diagnostic.code,
        message: ts.flattenDiagnosticMessageText(diagnostic.messageText, " ") }));
      expect(diagnostics).toEqual([]);
      const server = response.artifacts.find(artifact => artifact.path === "server.ts")!.content;
      expect(server).toContain('["constructor"]: handlers.constructor_');
      expect(server).toContain('["transport"]: handlers.transport_');
      expect(server).toContain('["__proto__"]: handlers.__proto___');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("renders each role deterministically without weakening any generated type", () => {
    for (const role of ["client", "server", "both"] as const) {
      const response = renderBindings(raw, role);
      expect(response).toEqual(renderBindings(raw, role));
      expect(response.identity).toEqual(JSON.parse(raw).identity);
      expect(response.artifacts.some(artifact => artifact.path === "client.ts")).toBe(role !== "server");
      expect(response.artifacts.some(artifact => artifact.path === "server.ts")).toBe(role !== "client");
      for (const artifact of response.artifacts.filter(artifact => artifact.path !== "contract.ts")) expect(artifact.content).not.toMatch(/\b(any|unknown)\b/);
    }
  });

  it("compiles real generated client/server types and pins each handler diagnostic", async () => {
    const directory = await mkdtemp(join(tmpdir(), "harn-typescript-compile-"));
    try {
      for (const artifact of renderBindings(raw, "both").artifacts) await writeFile(join(directory, artifact.path), artifact.content);
      await writeFile(join(directory, "package.json"), '{"type":"module"}');
      const base = 'import { defineHandlers } from "./server.js";\nimport { ApplicationFailure } from "@burin-labs/harn";\nconst valid = { echo: (input: import("./types.js").EchoInput) => input.input, mutate: (input: import("./types.js").EchoInput) => input.input, reject: (input: import("./types.js").EchoInput) => new ApplicationFailure({ enum: "Failure" as const, variant: "Rejected" as const, fields: ["reason"] as const }), scheduled: (input: import("./types.js").EchoInput) => input.input };\n';
      const cases = [
        { name: "positive", code: 'defineHandlers(valid);\n', expected: [] as number[] },
        { name: "missing", code: 'defineHandlers({ echo: valid.echo });\n', expected: [2345] },
        { name: "extra", code: 'defineHandlers({ ...valid, extra: valid.echo });\n', expected: [2322] },
        { name: "input", code: 'defineHandlers({ ...valid, echo: (input: string) => valid.echo({ input }) });\n', expected: [2322, 2322] },
        { name: "output", code: 'defineHandlers({ ...valid, echo: input => ({ ...input.input, sequence: "wrong" }) });\n', expected: [2322] },
        { name: "integer", code: 'const unsafe: import("./types.js").Payload["sequence"] = 9007199254740993;\n', expected: [2322] },
        { name: "extra-output", code: 'defineHandlers({ ...valid, echo: input => ({ ...input.input, extra: true }) });\n', expected: [2322] },
        { name: "duplicate", code: 'defineHandlers({ ...valid, echo: valid.echo, echo: valid.echo });\n', expected: [1117] },
      ];
      const file = join(directory, "case.ts");
      for (const fixture of cases) {
        await writeFile(file, base + fixture.code);
        const program = ts.createProgram([file, join(directory, "index.ts")], {
          strict: true, exactOptionalPropertyTypes: true, noEmit: true, skipLibCheck: true,
          target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
          types: ["node"], typeRoots: [resolve("node_modules/@types")],
          paths: {
            "@burin-labs/harn": [resolve("dist/index.d.ts")],
            "@burin-labs/harn/bindings": [resolve("dist/binding-runtime.d.ts")],
            "@burin-labs/harn/native": [resolve("dist/native.d.ts")],
          },
        });
        const diagnostics = ts.getPreEmitDiagnostics(program);
        const actual = diagnostics.map(diagnostic => ({ code: diagnostic.code, file: diagnostic.file?.fileName,
          line: diagnostic.file && diagnostic.start !== undefined ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1 : null,
          message: ts.flattenDiagnosticMessageText(diagnostic.messageText, " ") }));
        expect(actual.map(diagnostic => diagnostic.code), JSON.stringify({ fixture: fixture.name, actual })).toEqual(fixture.expected);
        for (const diagnostic of actual) { expect(diagnostic.file).toBe(file); expect(diagnostic.line).toBe(4); }
      }
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, 30000);
});
