import { Buffer } from "node:buffer";
import type { CodegenFeature, CodegenIr, CodegenResponse, CodegenRole, GeneratedArtifact, GeneratedRange } from "../generated/codegen.js";
import { jsonObject, parseLosslessJson, stringifyLosslessJson } from "../lossless-json.js";
import { renderTypes } from "./render-types.js";
import { allocateSymbols, operationReservedNames } from "./names.js";

const supported = {
  exact_json_integer: true, base64_bytes: true, canonical_decimal: true, sets: true,
  tuples: true, string_maps: true, optional_fields: true, nominal_types: true,
  recursive_types: true, disjoint_unions: true, declared_application_errors: true,
  mcp_tasks: true, request_cancellation: true,
} satisfies Record<CodegenFeature, true>;

/** The caller supplies an IR validated by Harn, never a catalog schema. */
export function renderBindings(validatedIr: string, role: CodegenRole): CodegenResponse {
  const ir: CodegenIr = JSON.parse(validatedIr);
  if (ir.schema_version !== "harn-codegen/1.0") throw new Error("Unsupported Harn codegen IR version");
  if (role !== "client" && role !== "server" && role !== "both") throw new Error("Unsupported Harn codegen role");
  for (const feature of ir.required_features) if (!Object.hasOwn(supported, feature)) throw new Error(`Unsupported Harn codegen feature: ${feature}`);
  const parsed = parseLosslessJson(validatedIr);
  if (!jsonObject(parsed)) throw new Error("Invalid Harn codegen IR");
  const canonical = stringifyLosslessJson(parsed);
  const { artifact, names } = renderTypes(ir);
  const operations = [...ir.operations].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const operationNames = allocateSymbols(operations, operationReservedNames);
  const ref = (id: string): string => {
    const name = names.get(id);
    if (!name) throw new Error("Generated operation references an absent type");
    return `T.${name}`;
  };
  const output = (operation: typeof operations[number]): string => {
    if (operation.output.kind !== "value") throw new Error(`Missing output for operation ${operation.id}`);
    return ref(operation.output.type_id) + (operation.application_error ? ` | ApplicationFailure<${ref(operation.application_error)}>` : "");
  };
  const artifacts: GeneratedArtifact[] = [artifact, {
    path: "contract.ts", source_mappings: [],
    content: `// Generated from harn-codegen/1.0. Do not edit.\nimport { generatedBinding } from "@burin-labs/harn/bindings";\nexport const binding = generatedBinding(${JSON.stringify(canonical)});\nexport const identity = Object.freeze(${JSON.stringify(ir.identity)});\n`,
  }];
  if (role !== "server") {
    let content = '// Generated from harn-codegen/1.0. Do not edit.\nimport type { HarnClient, McpRequestOptions, ApplicationFailure } from "@burin-labs/harn";\nimport { invokeGenerated } from "@burin-labs/harn/bindings";\nimport { binding } from "./contract.js";\nimport type * as T from "./types.js";\n\nexport class Client {\n  constructor(readonly transport: HarnClient) {}\n';
    const source_mappings: GeneratedRange[] = [];
    for (const operation of operations) {
      const start = Buffer.byteLength(content);
      content += `  ${operationNames.get(operation.id)!}(input: ${ref(operation.input)}, options?: McpRequestOptions): Promise<${output(operation)}> {\n    return invokeGenerated(binding, ${JSON.stringify(operation.id)}, this.transport, input, options);\n  }\n`;
      source_mappings.push({ start, end: Buffer.byteLength(content), source: operation.source });
    }
    content += '}\n';
    artifacts.push({ path: "client.ts", content, source_mappings });
  }
  if (role !== "client") {
    let content = '// Generated from harn-codegen/1.0. Do not edit.\nimport type { Handler, ExactHandlers, ApplicationFailure } from "@burin-labs/harn";\nimport { serveGenerated, type NativeServerOptions } from "@burin-labs/harn/native";\nimport { binding } from "./contract.js";\nimport type * as T from "./types.js";\n\nexport interface Handlers {\n';
    const source_mappings: GeneratedRange[] = [];
    for (const operation of operations) {
      const start = Buffer.byteLength(content);
      content += `  readonly ${operationNames.get(operation.id)!}: Handler<${ref(operation.input)}, ${output(operation)}>;\n`;
      source_mappings.push({ start, end: Buffer.byteLength(content), source: operation.source });
    }
    content += '}\n\nexport function defineHandlers<H extends Handlers>(handlers: H & ExactHandlers<H, Handlers>): H { return handlers; }\nexport function serve<H extends Handlers>(handlers: H & ExactHandlers<H, Handlers>, options: NativeServerOptions) {\n  return serveGenerated(binding, {\n';
    for (const operation of operations) {
      content += `    [${JSON.stringify(operation.name)}]: handlers.${operationNames.get(operation.id)!},\n`;
    }
    content += '  }, options);\n}\n';
    artifacts.push({ path: "server.ts", content, source_mappings });
  }
  artifacts.push({ path: "index.ts", source_mappings: [], content: 'export type * from "./types.js";\nexport { identity } from "./contract.js";\n' +
    (role !== "server" ? 'export { Client } from "./client.js";\n' : '') +
    (role !== "client" ? 'export { defineHandlers, serve, type Handlers } from "./server.js";\n' : '') });
  return { schema_version: "harn-codegen-response/1.0", identity: ir.identity,
    supported_features: (Object.keys(supported) as CodegenFeature[]).sort(), artifacts };
}
