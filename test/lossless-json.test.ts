import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseLosslessJson, stringifyLosslessJson } from "../src/lossless-json.js";

describe("lossless wire JSON", () => {
  it("distinguishes adjacent integers that native JSON decoding rounds together", () => {
    const text = "[9007199254740992,9007199254740993,-9223372036854775808,9223372036854775807]";
    expect(JSON.parse(text)[0]).toBe(JSON.parse(text)[1]);
    const value = parseLosslessJson(text);
    expect(value).toEqual([9007199254740992n, 9007199254740993n, -9223372036854775808n, 9223372036854775807n]);
    expect(stringifyLosslessJson(value)).toBe(text);
  });

  it("retains exact opaque schema bounds and reserved record keys", () => {
    const text = '{"__proto__":{"maximum":9223372036854775807},"constructor":"雪","nested":[null,true,42]}';
    const value = parseLosslessJson(text);
    expect(Object.hasOwn(value as object, "__proto__")).toBe(true);
    expect(stringifyLosslessJson(value)).toBe(text);
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
  });

  it("preserves floating point values and signed zero", () => {
    expect(parseLosslessJson("[0,1,-1,1.0,1e0]")).toEqual([0n, 1n, -1n, 1, 1]);
    const value = parseLosslessJson("[1.25,1e20,1e-20,-0]");
    expect(value).toEqual([1.25, 1e20, 1e-20, -0]);
    expect(stringifyLosslessJson(value)).toBe("[1.25,100000000000000000000.0,1e-20,-0.0]");
    expect(stringifyLosslessJson([1n, 1])).toBe("[1,1.0]");
    expect(Object.is((parseLosslessJson("[-0.0]") as number[])[0], -0)).toBe(true);
  });

  it("refuses numbers and values that JSON would silently replace or drop", () => {
    expect(() => parseLosslessJson("1e400")).toThrow("non-finite");
    for (const value of [NaN, Infinity, -Infinity, undefined, { missing: undefined }, [undefined], Symbol("x")]) {
      expect(() => stringifyLosslessJson(value)).toThrow();
    }
    expect(() => parseLosslessJson('{"x":')).toThrow(SyntaxError);
  });

  it("fails before transport on runtimes without either exact JSON primitive", () => {
    for (const primitive of ["rawJSON", "source"]) {
      const child = spawnSync(process.execPath, [
        "--import", "tsx", fileURLToPath(new URL("./fixtures/unsupported-json-runtime.ts", import.meta.url)), primitive,
      ], { encoding: "utf8" });
      expect(child.error).toBeUndefined();
      expect(child.status, child.stderr).toBe(0);
      expect(child.stdout).toBe("parse refused\nstringify refused\n");
    }
  });
});
