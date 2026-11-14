import { describe, expect, it } from "vitest";
import { allocateSymbols } from "../src/codegen/names.js";

describe("TypeScript codegen names", () => {
  it("resolves actual normalization and reserved-name collisions by semantic identity", () => {
    const symbols = [
      { id: "one", name: "class" }, { id: "two", name: "class_" },
      { id: "three", name: "a-b" }, { id: "four", name: "a_u2d_b" },
      { id: "five", name: "Promise" }, { id: "six", name: "0invalid" },
      { id: "seven", name: "雪" }, { id: "eight", name: "__proto__" }, { id: "nine", name: "" },
    ];
    const names = allocateSymbols(symbols, ["Promise"]);
    expect(new Set(names.values()).size).toBe(symbols.length);
    expect(names.get("one")).toMatch(/^class_[a-z0-9_]+$/);
    expect(names.get("one")).not.toBe(names.get("two"));
    expect(names.get("three")).not.toBe(names.get("four"));
    expect(names.get("five")).not.toBe("Promise");
    expect(names.get("six")).toBe("_u30_invalid");
    expect(names.get("seven")).toBe("雪");
    expect(names.get("eight")).toBe("__proto__");
    expect(names.get("nine")).toBe("Unnamed");
    expect([...allocateSymbols([...symbols].reverse(), ["Promise"])].sort()).toEqual([...names].sort());
  });

  it("refuses duplicate identities before generating declarations", () => {
    expect(() => allocateSymbols([{ id: "same", name: "A" }, { id: "same", name: "B" }])).toThrow("semantic ID");
    expect(() => allocateSymbols([{ id: "", name: "A" }])).toThrow("semantic ID");
  });
});
