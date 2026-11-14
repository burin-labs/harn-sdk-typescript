import { Buffer } from "node:buffer";
import type { CodegenIr, GeneratedArtifact, GeneratedRange, WireLiteral, WireShape, WireType, WireTypeId } from "../generated/codegen.js";
import { allocateSymbols } from "./names.js";

const runtimeTypes = {
  bytes: "Uint8Array", decimal: "HarnDecimal", list: "ReadonlyArray",
  set: "ReadonlySet", record: "Record", readonly: "Readonly",
} as const;

export class TypeScriptTargetError extends Error {
  readonly code = "unsupported_target_type";
  constructor(readonly operation: string | null, readonly type: WireType) {
    super(`TypeScript cannot render wire type ${type.id}`);
    this.name = "TypeScriptTargetError";
  }
  toJSON(): object { return { code: this.code, operation: this.operation, type_id: this.type.id, source: this.type.source }; }
}

function integerType(minimum: string, maximum: string): "number" | "bigint" {
  return BigInt(minimum) >= BigInt(Number.MIN_SAFE_INTEGER) && BigInt(maximum) <= BigInt(Number.MAX_SAFE_INTEGER) ? "number" : "bigint";
}

function literalType(value: WireLiteral): string {
  switch (value.kind) {
    case "null": return "null";
    case "boolean": return String(value.value);
    case "string": return JSON.stringify(value.value);
    case "integer": return integerType(value.value, value.value) === "bigint" ? `${value.value}n` : value.value;
    case "float": return value.value;
  }
}

/** Render the normalized graph. Catalog JSON and its opaque MCP projection are never interpreted. */
export function renderTypes(ir: CodegenIr): { artifact: GeneratedArtifact; names: ReadonlyMap<WireTypeId, string> } {
  const types = [...ir.types].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  const byId = new Map(types.map(type => [type.id, type]));
  const operationNames = new Map<string, string>();
  for (const operation of [...ir.operations].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)) {
    const [first = "", ...rest] = [...operation.name];
    if (!operationNames.has(operation.input)) operationNames.set(operation.input, `${first.toUpperCase()}${rest.join("")}Input`);
  }
  function hint(type: WireType, seen = new Set<string>()): string {
    if (type.name) return type.name;
    if (seen.has(type.id)) return "Recursive";
    seen.add(type.id);
    const value = type.shape;
    if (value.kind === "alias") return value.declaration.name;
    if ((value.kind === "record" || value.kind === "enum") && value.nominal) {
      const arguments_ = value.nominal.arguments.map(id => hint(byId.get(id)!, new Set(seen)));
      return value.nominal.name + (arguments_.length ? `Of${arguments_.join("And")}` : "");
    }
    if (operationNames.has(type.id)) return operationNames.get(type.id)!;
    switch (value.kind) {
      case "integer": return "Integer";
      case "boolean": return "Boolean";
      case "string": return "String";
      case "bytes": return "Bytes";
      case "decimal": return "Decimal";
      case "null": return "Null";
      case "float": return "Float";
      case "list": case "set": return `${value.kind === "list" ? "List" : "Set"}Of${hint(byId.get(value.item)!, seen)}`;
      case "map": return `MapOf${hint(byId.get(value.value)!, seen)}`;
      case "union": return value.members.map(id => hint(byId.get(id)!, new Set(seen))).join("Or");
      case "literal": return value.value.kind === "null" ? "NullLiteral" : `Literal_${value.value.value}`;
      case "tuple": return "Tuple";
      case "record": return "Record";
      case "enum": return value.nominal.name;
    }
  }
  const names = allocateSymbols(types.map(type => ({ id: type.id, name: hint(type) })), Object.values(runtimeTypes));
  function reference(id: WireTypeId): string {
    const name = names.get(id);
    if (!name) throw new Error("Validated codegen graph has a dangling type reference");
    return name;
  }
  function shape(type: WireType): string {
    const value: WireShape = type.shape;
    switch (value.kind) {
      case "null": return "null";
      case "boolean": return "boolean";
      case "integer": return integerType(value.minimum, value.maximum);
      case "float": return "number";
      case "string": return "string";
      case "bytes": return runtimeTypes.bytes;
      case "decimal": return runtimeTypes.decimal;
      case "literal": return literalType(value.value);
      case "list": return `${runtimeTypes.list}<${reference(value.item)}>`;
      case "set": return `${runtimeTypes.set}<${reference(value.item)}>`;
      case "tuple": return `readonly [${value.items.map(reference).join(", ")}]`;
      case "map": return `${runtimeTypes.readonly}<${runtimeTypes.record}<string, ${reference(value.value)}>>`;
      case "alias": return reference(value.target);
      case "union": return value.members.map(reference).join(" | ");
      case "record": {
        const fields = value.fields.map(field => `readonly ${JSON.stringify(field.name)}${field.optional ? "?" : ""}: ${reference(field.type_id)};`).join(" ");
        const record = `{ ${fields} }`;
        if (!value.additional) return record;
        const indexValues = new Set([reference(value.additional), ...value.fields.map(field => reference(field.type_id))]);
        if (value.fields.some(field => field.optional)) indexValues.add("undefined");
        return `${record} & ${runtimeTypes.readonly}<${runtimeTypes.record}<string, ${[...indexValues].sort().join(" | ")}>>`;
      }
      case "enum": return value.variants.map(variant => `{ readonly enum: ${JSON.stringify(value.nominal.name)}; readonly variant: ${JSON.stringify(variant.name)}; readonly fields: readonly [${variant.fields.map(field => reference(field.type_id)).join(", ")}]; }`).join(" | ");
      default: {
        const exhaustive: never = value;
        void exhaustive;
        throw new TypeScriptTargetError(ir.operations.find(operation => operation.input === type.id || (operation.output.kind === "value" && operation.output.type_id === type.id))?.id ?? null, type);
      }
    }
  }
  // Resolve every referenced type through the complete graph before emitting files.
  for (const operation of ir.operations) {
    if (!byId.has(operation.input) || (operation.output.kind === "value" && !byId.has(operation.output.type_id)) || (operation.application_error !== null && !byId.has(operation.application_error))) {
      throw new Error("Validated codegen operation has a dangling type reference");
    }
  }
  let content = `// Generated from harn-codegen/1.0. Do not edit.\nimport type { ${runtimeTypes.decimal} } from "@burin-labs/harn";\n\n`;
  const source_mappings: GeneratedRange[] = [];
  for (const type of types) {
    const start = Buffer.byteLength(content);
    content += `export type ${reference(type.id)} = ${shape(type)};\n`;
    source_mappings.push({ start, end: Buffer.byteLength(content), source: type.source });
  }
  return { names, artifact: { path: "types.ts", content, source_mappings } };
}
