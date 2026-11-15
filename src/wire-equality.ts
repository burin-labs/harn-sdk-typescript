/** Runtime value identity after the normalized graph has supplied each value's kind. */
export type WireValue =
  | { kind: "null" }
  | { kind: "boolean"; value: boolean }
  | { kind: "integer"; value: bigint }
  | { kind: "float"; value: number }
  | { kind: "string" | "bytes"; value: string }
  | { kind: "decimal"; coefficient: bigint; scale: number }
  | { kind: "list" | "set"; items: WireValue[] }
  | { kind: "record"; name: string | null; fields: [string, WireValue][] }
  | { kind: "enum"; name: string; variant: string; items: WireValue[] };

/** Hashes identify candidate buckets; exact equality always confirms a match. */
export function wireValueHash(value: WireValue): string {
  switch (value.kind) {
    case "integer": case "float": return `number:${Number(value.value)}`;
    case "list": return hashParts(["list", ...value.items.map(wireValueHash)]);
    case "set": return hashParts(["set", ...value.items.map(wireValueHash).sort()]);
    case "record": return hashParts(["record", JSON.stringify(value.name), ...value.fields.flatMap(([key, item]) => [key, wireValueHash(item)])]);
    case "enum": return hashParts(["enum", value.name, value.variant, ...value.items.map(wireValueHash)]);
    case "decimal": return hashParts(["decimal", String(value.coefficient), String(value.scale)]);
    case "null": return hashParts(["null"]);
    case "boolean": return hashParts(["boolean", String(value.value)]);
    case "string": case "bytes": return hashParts([value.kind, value.value]);
  }
}

// Fixed-size candidate hashes keep recursive values from repeatedly escaping
// an already-serialized child hash. Collisions always reach exact equality.
function hashParts(parts: readonly string[]): string {
  let hash = 2166136261;
  for (const part of parts) {
    const length = `${part.length}:`;
    for (let index = 0; index < length.length; index++) hash = Math.imul(hash ^ length.charCodeAt(index), 16777619);
    for (let index = 0; index < part.length; index++) hash = Math.imul(hash ^ part.charCodeAt(index), 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function wireValuesEqual(left: WireValue, right: WireValue): boolean {
  if (left.kind === "integer" && right.kind === "float") return Number(left.value) === right.value;
  if (left.kind === "float" && right.kind === "integer") return left.value === Number(right.value);
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case "null": return true;
    case "boolean": return right.kind === "boolean" && left.value === right.value;
    case "integer": return right.kind === "integer" && left.value === right.value;
    case "float": return right.kind === "float" && left.value === right.value;
    case "string": case "bytes": return (right.kind === "string" || right.kind === "bytes") && left.value === right.value;
    case "decimal": return right.kind === "decimal" && left.coefficient === right.coefficient && left.scale === right.scale;
    case "list": return right.kind === "list" && sequenceEqual(left.items, right.items);
    case "record": return right.kind === "record" && left.name === right.name && left.fields.length === right.fields.length &&
      left.fields.every(([key, item], index) => key === right.fields[index]![0] && wireValuesEqual(item, right.fields[index]![1]));
    case "enum": return right.kind === "enum" && left.name === right.name && left.variant === right.variant && sequenceEqual(left.items, right.items);
    case "set": return right.kind === "set" && setEqual(left.items, right.items);
  }
}

function sequenceEqual(left: WireValue[], right: WireValue[]): boolean {
  return left.length === right.length && left.every((value, index) => wireValuesEqual(value, right[index]!));
}

function setEqual(left: WireValue[], right: WireValue[]): boolean {
  if (left.length !== right.length) return false;
  // Mixed integer/float equality is not transitive. Match each member once;
  // neither a subset check nor greedy pairing preserves Harn's set equality.
  const buckets = new Map<string, number[]>();
  right.forEach((value, index) => {
    const key = wireValueHash(value), bucket = buckets.get(key) ?? [];
    bucket.push(index); buckets.set(key, bucket);
  });
  const leftMatches = Array<number | undefined>(left.length), rightMatches = Array<number | undefined>(right.length);
  const parent = Array<number>(right.length);
  for (let root = 0; root < left.length; root++) {
    const pending = [root], seen = new Set<number>();
    let endpoint: number | undefined;
    search: while (pending.length) {
      const index = pending.pop()!;
      for (const other of buckets.get(wireValueHash(left[index]!)) ?? []) {
        if (seen.has(other) || !wireValuesEqual(left[index]!, right[other]!)) continue;
        seen.add(other); parent[other] = index;
        const previous = rightMatches[other];
        if (previous === undefined) { endpoint = other; break search; }
        pending.push(previous);
      }
    }
    if (endpoint === undefined) return false;
    while (endpoint !== undefined) {
      const index: number = parent[endpoint]!;
      const previous: number | undefined = leftMatches[index];
      leftMatches[index] = endpoint; rightMatches[endpoint] = index; endpoint = previous;
    }
  }
  return true;
}
