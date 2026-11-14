import { expect, it } from "vitest";
import { wireValueHash, wireValuesEqual, type WireValue } from "../src/wire-equality.js";

it("keeps aggregate candidate hashes fixed-size through recursive values", () => {
  let value: WireValue = { kind: "enum", name: "Node", variant: "End", items: [] };
  for (let depth = 0; depth < 128; depth++) {
    expect(wireValueHash(value)).toHaveLength(8);
    value = { kind: "enum", name: "Node", variant: "Next", items: [value] };
  }
});

it("confirms colliding numeric candidates with exact equality", () => {
  const left: WireValue = { kind: "integer", value: 9007199254740992n };
  const right: WireValue = { kind: "integer", value: 9007199254740993n };
  expect(wireValueHash(left)).toBe(wireValueHash(right));
  expect(wireValuesEqual(left, right)).toBe(false);
});
