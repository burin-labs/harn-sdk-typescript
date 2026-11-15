import { createHash } from "node:crypto";

const reserved = new Set([
  "abstract", "any", "arguments", "as", "asserts", "async", "await", "bigint", "boolean", "break", "case", "catch",
  "class", "const", "constructor", "continue", "debugger", "declare", "default", "delete", "do", "else",
  "enum", "eval", "export", "extends", "false", "finally", "for", "from", "function", "get", "global", "if",
  "implements", "import", "in", "infer", "instanceof", "interface", "is", "keyof", "let", "module",
  "namespace", "never", "new", "null", "number", "object", "of", "package", "private", "protected",
  "public", "readonly", "require", "return", "satisfies", "set", "static", "string", "super", "switch",
  "symbol", "this", "throw", "true", "try", "type", "typeof", "undefined", "unique", "unknown", "using",
  "var", "void", "while", "with", "yield",
]);

export interface CodegenSymbol {
  id: string;
  name: string;
}

/** Generated instances and ordinary handler objects retain JavaScript's object APIs. */
export const operationReservedNames = [
  "transport", "constructor", "__proto__", "toString", "toLocaleString", "valueOf",
  "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable", "__defineGetter__",
  "__defineSetter__", "__lookupGetter__", "__lookupSetter__",
] as const;

function identifier(name: string): string {
  const encoded = [...name].map((character, index) => {
    const allowed = index === 0 ? /^[$_\p{ID_Start}]$/u : /^[$_\u200c\u200d\p{ID_Continue}]$/u;
    return allowed.test(character) ? character : `_u${character.codePointAt(0)!.toString(16)}_`;
  }).join("") || "Unnamed";
  return reserved.has(encoded) ? `${encoded}_` : encoded;
}

/** Allocate one namespace from semantic IDs, independently of declaration order. */
export function allocateSymbols(symbols: readonly CodegenSymbol[], reservedNames: readonly string[] = []): Map<string, string> {
  const byId = new Map<string, string>();
  const groups = new Map<string, CodegenSymbol[]>();
  for (const symbol of symbols) {
    if (!symbol.id || byId.has(symbol.id)) throw new Error(`Duplicate or empty codegen semantic ID: ${symbol.id}`);
    byId.set(symbol.id, "");
    const base = identifier(symbol.name);
    const group = groups.get(base) ?? [];
    group.push(symbol);
    groups.set(base, group);
  }
  const used = new Set(reservedNames);
  for (const [base, group] of [...groups].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) {
    for (const symbol of group) {
      const suffix = createHash("sha256").update(symbol.id).digest("hex").slice(0, 12);
      const name = group.length > 1 || used.has(base) ? `${base}_${suffix}` : base;
      if (used.has(name)) throw new Error(`Codegen symbol collision for semantic ID ${symbol.id}: ${name}`);
      used.add(name);
      byId.set(symbol.id, name);
    }
  }
  return byId;
}
