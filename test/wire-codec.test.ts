import { describe, expect, it } from "vitest";
import { HarnDecimal } from "../src/decimal.js";
import { createWireCodec, HarnWireError } from "../src/wire-codec.js";
import { parseLosslessJson, stringifyLosslessJson, type LosslessJsonValue } from "../src/lossless-json.js";
import { WIRE_BYTES_TAG, type WireShape, type WireType } from "../src/generated/codegen.js";

const source = { kind: "synthetic", owner: "codec-control" } as const;
const type = (id: string, shape: WireShape): WireType => ({ id, name: null, documentation: null, source, shape });
const field = (name: string, type_id: string, optional = false) => ({ id: name, name, type_id, optional, source, documentation: null });
const types: WireType[] = [
  type("int", { kind: "integer", encoding: "json_number", minimum: "-9223372036854775808", maximum: "9223372036854775807" }),
  type("small", { kind: "integer", encoding: "json_number", minimum: "-10", maximum: "10" }),
  type("float", { kind: "float" }), type("string", { kind: "string" }), type("bool", { kind: "boolean" }), type("null", { kind: "null" }),
  type("bytes", { kind: "bytes", encoding: "base64_envelope" }), type("decimal", { kind: "decimal", encoding: "canonical_string" }),
  type("nullable", { kind: "union", members: ["string", "null"] }),
  type("record", { kind: "record", nominal: null, additional: null, fields: [field("value", "int"), field("optional", "nullable", true)] }),
  type("reserved", { kind: "record", nominal: null, additional: null, fields: [field("__proto__", "string"), field("constructor", "int")] }),
  type("records", { kind: "set", item: "record" }), type("decimals", { kind: "set", item: "decimal" }), type("integers", { kind: "set", item: "int" }),
  type("mixed", { kind: "union", members: ["bool", "int"] }), type("mixedSet", { kind: "set", item: "mixed" }),
  type("nested", { kind: "set", item: "integers" }),
  type("list", { kind: "list", item: "list" }),
];

describe("normalized wire values", () => {
  it("preserves all integer bits and refuses rounded or floating tokens", () => {
    const codec = createWireCodec<bigint>(types, "int");
    const value = 9007199254740993n;
    expect(codec.decode(parseLosslessJson(String(value)))).toBe(value);
    expect(stringifyLosslessJson(codec.encode(value))).toBe(String(value));
    for (const invalid of [1, true, "1", 9223372036854775808n, -9223372036854775809n]) expect(() => codec.encode(invalid as bigint)).toThrow(HarnWireError);
    for (const invalid of ["1.0", "1e0", "-0", "0.99999999999999999"]) expect(() => codec.decode(parseLosslessJson(invalid))).toThrow(HarnWireError);
    const small = createWireCodec<number>(types, "small");
    expect(small.decode(10n)).toBe(10);
    expect(small.encode(10)).toBe(10n);
    expect(() => small.encode(11)).toThrow(HarnWireError);
  });

  it("keeps absent, null, and undefined distinct and refuses unknown output fields", () => {
    const codec = createWireCodec<{ value: bigint; optional?: string | null }>(types, "record");
    expect(codec.decode({ value: 1n })).toEqual({ value: 1n });
    expect(codec.decode({ value: 1n, optional: null })).toEqual({ value: 1n, optional: null });
    expect(() => codec.encode({ value: 1n, optional: undefined } as never)).toThrow(HarnWireError);
    expect(() => codec.decode({ value: 1n, extra: true })).toThrow(HarnWireError);
    expect(() => codec.decode({})).toThrow(HarnWireError);
    expect(() => codec.encode(Object.defineProperty({}, "value", { value: 1n }) as never)).toThrow(HarnWireError);
  });

  it("keeps reserved record keys as own data without changing prototypes", () => {
    const codec = createWireCodec<Record<string, unknown>>(types, "reserved");
    const result = codec.decode(parseLosslessJson('{"__proto__":"雪","constructor":9007199254740993}'));
    expect(Object.hasOwn(result, "__proto__")).toBe(true);
    expect(result["__proto__"]).toBe("雪");
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(codec.encode(result)).toEqual(result);
  });

  it("uses canonical bytes envelopes and rejects whitespace, extra fields, and padding bits", () => {
    const codec = createWireCodec<Uint8Array>(types, "bytes");
    const bytes = Uint8Array.of(0, 255, 128);
    expect(codec.decode(codec.encode(bytes))).toEqual(bytes);
    expect(codec.encode(bytes)).toEqual({ [WIRE_BYTES_TAG]: "AP+A" });
    const invalid: LosslessJsonValue[] = [{ [WIRE_BYTES_TAG]: "Zg==\n" }, { [WIRE_BYTES_TAG]: "Zh==" }, { [WIRE_BYTES_TAG]: "Zg" }, { [WIRE_BYTES_TAG]: "Zg==", extra: true }];
    for (const value of invalid) {
      expect(() => codec.decode(value)).toThrow(HarnWireError);
    }
  });

  it("retains decimal scale while comparing set members by exact decimal value", () => {
    const codec = createWireCodec<HarnDecimal>(types, "decimal");
    expect(codec.decode("1.2300").toString()).toBe("1.2300");
    expect(codec.encode(new HarnDecimal("1.2300"))).toBe("1.2300");
    expect(() => codec.encode(1.23 as never)).toThrow(HarnWireError);
    expect(() => createWireCodec(types, "decimals").decode(["1.0", "1.00"])).toThrow(HarnWireError);
  });

  it("supports record-valued sets with structural membership and ordered iteration", () => {
    const codec = createWireCodec<ReadonlySet<{ value: bigint }>>(types, "records");
    const result = codec.decode([{ value: 2n }, { value: 1n }]);
    expect(result.size).toBe(2);
    expect(result.has({ value: 2n })).toBe(true);
    expect(result.has({ value: 3n })).toBe(false);
    expect([...result]).toEqual([{ value: 2n }, { value: 1n }]);
    expect(codec.encode(result)).toEqual([{ value: 2n }, { value: 1n }]);
    expect(() => codec.encode(new Set([{ value: 1n }, { value: 1n }]))).toThrow(HarnWireError);
  });

  it("confirms exact integer equality inside a shared numeric hash bucket", () => {
    const codec = createWireCodec<ReadonlySet<bigint>>(types, "integers");
    const result = codec.decode([9007199254740992n, 9007199254740993n]);
    expect(result.size).toBe(2);
    expect(result.has(9007199254740993n)).toBe(true);
    expect(result.has(9007199254740994n)).toBe(false);
    expect(createWireCodec<ReadonlySet<boolean | bigint>>(types, "mixedSet").decode([true, 1n]).size).toBe(2);
    expect(() => codec.decode([1n, 1n])).toThrow(HarnWireError);
  });

  it("compares nested sets independently of insertion order", () => {
    expect(() => createWireCodec(types, "nested").decode([[1n, 2n], [2n, 1n]])).toThrow(HarnWireError);
    const set = createWireCodec<ReadonlySet<ReadonlySet<bigint>>>(types, "nested").decode([[1n, 2n]]);
    expect(set.has(new Set([2n, 1n]))).toBe(true);
  });

  it("refuses deep/cyclic values and sparse arrays without echoing payloads", () => {
    const codec = createWireCodec(types, "list");
    const cyclic: unknown[] = []; cyclic.push(cyclic);
    expect(() => codec.encode(cyclic)).toThrow(HarnWireError);
    expect(() => codec.encode(Array(1))).toThrow(HarnWireError);
    const disguised = Array(1) as unknown[] & { extra: string }; disguised.extra = "secret payload";
    expect(() => codec.encode(disguised)).toThrow(HarnWireError);
    expect(() => codec.encode(["secret payload"])).toThrow("Harn wire contract violation");
  });

  it("counts semantic value depth while keeping aliases transparent", () => {
    const graph = [...types];
    let id = "int", value: unknown = 1n;
    for (let depth = 1; depth <= 129; depth++) {
      graph.push(type(`depth${depth}`, { kind: "list", item: id }));
      id = `depth${depth}`; value = [value];
      if (depth === 128) expect(createWireCodec(graph, id).encode(value)).toBeDefined();
    }
    expect(() => createWireCodec(graph, id).encode(value)).toThrow(HarnWireError);
    id = "int";
    for (let alias = 0; alias < 256; alias++) {
      const next = `alias${alias}`;
      graph.push(type(next, { kind: "alias", target: id, declaration: { declaration_id: next, name: next, arguments: [] } }));
      id = next;
    }
    expect(createWireCodec(graph, id).encode(1n)).toBe(1n);
  });

  it("compares deep recursive enums inside sets without counting wire envelopes", () => {
    const graph = [...types, type("enum", { kind: "enum", nominal: { declaration_id: "recursive-enum", name: "Chain", arguments: [] }, variants: [
      { id: "end", name: "End", fields: [], source, documentation: null },
      { id: "next", name: "Next", fields: [field("next", "enum")], source, documentation: null },
    ] }), type("enum-set", { kind: "set", item: "enum" })];
    let value: LosslessJsonValue = { enum: "Chain", variant: "End", fields: [] };
    for (let depth = 0; depth < 100; depth++) value = { enum: "Chain", variant: "Next", fields: [value] };
    const codec = createWireCodec<ReadonlySet<unknown>>(graph, "enum-set");
    const decoded = codec.decode([value]);
    expect(decoded.has(value)).toBe(true);
    expect(() => codec.decode([value, value])).toThrow(HarnWireError);
    expect(codec.encode(decoded)).toEqual([value]);
  });
});
