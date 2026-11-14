import { HarnDecimal } from "./decimal.js";
import {
  WIRE_BYTES_TAG, WIRE_ENUM_FIELDS_KEY, WIRE_ENUM_NAME_KEY, WIRE_ENUM_VARIANT_KEY, WIRE_MAX_VALUE_DEPTH,
  type WireFailureCode, type WireSourceRef, type WireType, type WireTypeId,
} from "./generated/codegen.js";
import type { LosslessJsonValue } from "./lossless-json.js";
import { wireValueHash, wireValuesEqual, type WireValue } from "./wire-equality.js";

export class HarnWireError extends Error {
  constructor(readonly code: WireFailureCode, readonly type_id: WireTypeId,
    readonly source: WireSourceRef, readonly structural_path: string) {
    super(`Harn wire contract violation: ${code}`);
    this.name = "HarnWireError";
  }
}

export interface WireCodec<T> {
  encode(value: T): LosslessJsonValue;
  decode(value: LosslessJsonValue): T;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) &&
    Object.getOwnPropertySymbols(value).length === 0 &&
    Object.values(Object.getOwnPropertyDescriptors(value)).every(field => field.enumerable && "value" in field);
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let start = 0; start < bytes.length; start += 8192) binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
  return btoa(binary);
}

class StructuralSet<T> implements ReadonlySet<T> {
  readonly #items: readonly T[];
  readonly #equal: (left: T, right: T) => boolean;
  readonly [Symbol.toStringTag] = "Set";
  constructor(items: readonly T[], equal: (left: T, right: T) => boolean) {
    this.#items = items;
    this.#equal = equal;
    Object.freeze(this);
  }
  get size(): number { return this.#items.length; }
  has(value: T): boolean {
    try { return this.#items.some(item => this.#equal(item, value)); }
    catch { return false; }
  }
  values(): SetIterator<T> { return new Set(this.#items).values(); }
  keys(): SetIterator<T> { return this.values(); }
  entries(): SetIterator<[T, T]> { return new Set(this.#items).entries(); }
  [Symbol.iterator](): SetIterator<T> { return this.values(); }
  forEach(callback: (value: T, value2: T, set: ReadonlySet<T>) => void, thisArg?: unknown): void {
    for (const item of this.#items) callback.call(thisArg, item, item, this);
  }
}

/** Execute Harn's normalized wire graph; never derive types from catalog or MCP schemas. */
export function createWireCodec<T>(definitions: readonly WireType[], root: WireTypeId): WireCodec<T> {
  const types = new Map(definitions.map(type => [type.id, type]));
  if (types.size !== definitions.length || !types.has(root)) throw new Error("Invalid normalized Harn wire graph");
  type Mode = "encode" | "decode";
  function typeFor(id: WireTypeId, depth: number, path: string): WireType {
    let type = types.get(id);
    if (!type) throw new Error("Dangling normalized Harn wire type");
    const visited = new Set<string>();
    while (type.shape.kind === "alias") {
      if (visited.has(type.id)) throw new Error("Cyclic normalized Harn wire alias");
      visited.add(type.id);
      type = types.get(type.shape.target);
      if (!type) throw new Error("Dangling normalized Harn wire alias");
    }
    if (depth > WIRE_MAX_VALUE_DEPTH) throw new HarnWireError("maximum_depth", id, type.source, path);
    return type;
  }
  function walk(id: WireTypeId, value: unknown, mode: Mode, depth: number, path: string): unknown {
    const type = typeFor(id, depth, path);
    const fail = (code: WireFailureCode = "invalid_value"): never => { throw new HarnWireError(code, type.id, type.source, path); };
    const shape = type.shape;
    const child = (id: WireTypeId, value: unknown, suffix = "/*"): unknown => walk(id, value, mode, depth + 1, path + suffix);
    switch (shape.kind) {
      case "alias": return child(shape.target, value, "");
      case "null": return value === null ? null : fail();
      case "boolean": return typeof value === "boolean" ? value : fail();
      case "string": return typeof value === "string" ? value : fail();
      case "integer": {
        const minimum = BigInt(shape.minimum), maximum = BigInt(shape.maximum);
        const safe = minimum >= BigInt(Number.MIN_SAFE_INTEGER) && maximum <= BigInt(Number.MAX_SAFE_INTEGER);
        let integer: bigint;
        if (mode === "decode") { if (typeof value !== "bigint") return fail(); integer = value; }
        else if (safe && typeof value === "number" && Number.isSafeInteger(value)) integer = BigInt(value);
        else if (!safe && typeof value === "bigint") integer = value;
        else return fail("wrong_runtime_type");
        if (integer < minimum || integer > maximum) return fail("invalid_range");
        return mode === "decode" && safe ? Number(integer) : integer;
      }
      case "float": {
        const number = mode === "decode" && typeof value === "bigint" ? Number(value) : value;
        return typeof number === "number" && Number.isFinite(number) ? number : fail("non_finite_float");
      }
      case "bytes": {
        if (mode === "encode") return value instanceof Uint8Array ? { [WIRE_BYTES_TAG]: base64(value) } : fail("wrong_runtime_type");
        if (!record(value) || Object.keys(value).length !== 1 || typeof value[WIRE_BYTES_TAG] !== "string") return fail("invalid_base64");
        try {
          const binary = atob(value[WIRE_BYTES_TAG]);
          if (btoa(binary) !== value[WIRE_BYTES_TAG]) return fail("invalid_base64");
          return Uint8Array.from(binary, character => character.charCodeAt(0));
        } catch { return fail("invalid_base64"); }
      }
      case "decimal": {
        try {
          if (mode === "encode") return value instanceof HarnDecimal ? new HarnDecimal(value.toString()).toString() : fail("wrong_runtime_type");
          return typeof value === "string" ? new HarnDecimal(value) : fail("invalid_decimal");
        } catch { return fail("invalid_decimal"); }
      }
      case "literal": {
        const literal = shape.value;
        if (literal.kind === "integer") {
          const expected = BigInt(literal.value);
          const safe = expected >= BigInt(Number.MIN_SAFE_INTEGER) && expected <= BigInt(Number.MAX_SAFE_INTEGER);
          if (mode === "decode") return typeof value === "bigint" && value === expected ? (safe ? Number(value) : value) : fail();
          if (safe ? typeof value !== "number" || !Number.isSafeInteger(value) || BigInt(value) !== expected : value !== expected) return fail("wrong_runtime_type");
          return expected;
        }
        const expected = literal.kind === "null" ? null : literal.kind === "float" ? Number(literal.value) : literal.value;
        return value === expected ? value : fail();
      }
      case "list": case "tuple": case "set": {
        let items: unknown[];
        if (shape.kind === "set" && mode === "encode") {
          if (!(value instanceof Set) && !(value instanceof StructuralSet)) return fail("wrong_runtime_type");
          items = [...value];
        } else { if (!Array.isArray(value)) return fail(); items = value; }
        if (shape.kind === "tuple" && items.length !== shape.items.length) return fail();
        if (Object.keys(items).length !== items.length || Object.getOwnPropertySymbols(items).length > 0) return fail();
        for (let index = 0; index < items.length; index++) {
          const field = Object.getOwnPropertyDescriptor(items, String(index));
          if (!field || !("value" in field)) return fail();
        }
        const result = items.map((item, index) => child(shape.kind === "tuple" ? shape.items[index]! : shape.item, item, "/[]"));
        if (shape.kind !== "set") return result;
        const nativeView = (item: unknown): WireValue => semanticView(shape.item, walk(shape.item, item, "encode", depth + 1, path + "/[]"), depth + 1);
        const buckets = new Map<string, WireValue[]>();
        for (const item of result) {
          const view = mode === "decode" ? nativeView(item) : semanticView(shape.item, item, depth + 1);
          const key = wireValueHash(view), bucket = buckets.get(key) ?? [];
          if (bucket.some(previous => wireValuesEqual(previous, view))) return fail("duplicate_set_member");
          bucket.push(view);
          buckets.set(key, bucket);
        }
        return mode === "encode" ? result : new StructuralSet(result, (left, right) => wireValuesEqual(nativeView(left), nativeView(right)));
      }
      case "map": case "record": {
        if (!record(value)) return fail();
        const fields = shape.kind === "record" ? shape.fields : [];
        const additional = shape.kind === "map" ? shape.value : shape.additional;
        for (const field of fields) if (!Object.hasOwn(value, field.name) && !field.optional) return fail("missing_field");
        const result: [string, unknown][] = [];
        for (const [name, item] of Object.entries(value)) {
          const field = fields.find(field => field.name === name);
          const itemType = field?.type_id ?? additional;
          if (!itemType) return fail("unknown_field");
          result.push([name, child(itemType, item)]);
        }
        return Object.fromEntries(result);
      }
      case "enum": {
        if (!record(value) || Object.keys(value).length !== 3 || value[WIRE_ENUM_NAME_KEY] !== shape.nominal.name) return fail("invalid_nominal_discriminator");
        const variant = shape.variants.find(variant => variant.name === value[WIRE_ENUM_VARIANT_KEY]);
        const items = value[WIRE_ENUM_FIELDS_KEY];
        if (!variant || !Array.isArray(items) || items.length !== variant.fields.length) return fail("invalid_nominal_discriminator");
        return { [WIRE_ENUM_NAME_KEY]: shape.nominal.name, [WIRE_ENUM_VARIANT_KEY]: variant.name,
          [WIRE_ENUM_FIELDS_KEY]: variant.fields.map((field, index) => child(field.type_id, items[index], "/*/[]")) };
      }
      case "union": {
        const matches: unknown[] = [];
        for (const member of shape.members) {
          try { matches.push(child(member, value, "")); }
          catch (error) { if (!(error instanceof HarnWireError)) throw error; }
        }
        return matches.length === 1 ? matches[0] : fail();
      }
      default: {
        const exhaustive: never = shape;
        void exhaustive;
        throw new Error("Unsupported normalized Harn wire type");
      }
    }
  }
  function semanticView(id: WireTypeId, value: unknown, depth: number): WireValue {
    const shape = typeFor(id, depth, "").shape;
    const recurse = (id: WireTypeId, value: unknown): WireValue => semanticView(id, value, depth + 1);
    switch (shape.kind) {
      case "alias": return recurse(shape.target, value);
      case "decimal": {
        const [whole, fraction = ""] = (value as string).split(".");
        let coefficient = BigInt(whole! + fraction), scale = fraction.length;
        while (scale > 0 && coefficient % 10n === 0n) { coefficient /= 10n; scale--; }
        return { kind: "decimal", coefficient, scale };
      }
      case "integer": return { kind: "integer", value: value as bigint };
      case "float": return { kind: "float", value: Number(value) };
      case "null": return { kind: "null" };
      case "boolean": return { kind: "boolean", value: value as boolean };
      case "string": return { kind: "string", value: value as string };
      case "bytes": return { kind: "bytes", value: (value as Record<string, string>)[WIRE_BYTES_TAG]! };
      case "literal": {
        switch (shape.value.kind) {
          case "null": return { kind: "null" };
          case "integer": return { kind: "integer", value: value as bigint };
          case "float": return { kind: "float", value: value as number };
          case "string": return { kind: "string", value: value as string };
          case "boolean": return { kind: "boolean", value: value as boolean };
        }
      }
      case "list": return { kind: "list", items: (value as unknown[]).map(item => recurse(shape.item, item)) };
      case "tuple": return { kind: "list", items: (value as unknown[]).map((item, index) => recurse(shape.items[index]!, item)) };
      case "set": return { kind: "set", items: (value as unknown[]).map(item => recurse(shape.item, item)) };
      case "record": case "map": {
        const fields = shape.kind === "record" ? shape.fields : [];
        const additional = shape.kind === "map" ? shape.value : shape.additional;
        return { kind: "record", name: shape.kind === "record" ? shape.nominal?.name ?? null : null,
          fields: Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
            .map(([name, item]) => [name, recurse(fields.find(field => field.name === name)?.type_id ?? additional!, item)]) };
      }
      case "enum": {
        const object = value as Record<string, unknown>;
        const variant = shape.variants.find(variant => variant.name === object[WIRE_ENUM_VARIANT_KEY])!;
        return { kind: "enum", name: shape.nominal.name, variant: variant.name,
          items: variant.fields.map((field, index) => recurse(field.type_id, (object[WIRE_ENUM_FIELDS_KEY] as unknown[])[index])) };
      }
      case "union": {
        for (const member of shape.members) {
          try { walk(member, value, "decode", depth + 1, ""); return recurse(member, value); }
          catch (error) { if (!(error instanceof HarnWireError)) throw error; }
        }
        throw new Error("Invalid validated union value");
      }
    }
  }
  return {
    encode: value => walk(root, value, "encode", 0, "") as LosslessJsonValue,
    decode: value => walk(root, value, "decode", 0, "") as T,
  };
}
