import { describe, expect, it } from "vitest";
import { HarnDecimal } from "../src/decimal.js";

describe("canonical Harn decimals", () => {
  it("preserves exact coefficient and scale across JSON", () => {
    for (const value of ["0", "0.00", "-1.2300", "79228162514264337593543950335", "-79228162514264337593543950335", "0.0000000000000000000000000001"]) {
      const decimal = new HarnDecimal(value);
      expect(String(decimal)).toBe(value);
      expect(JSON.stringify(decimal)).toBe(JSON.stringify(value));
      expect(Object.isFrozen(decimal)).toBe(true);
    }
  });

  it("refuses rounding, noncanonical spellings, negative zero, and excessive scale", () => {
    for (const value of ["+1", "01", "1.", ".1", "1e2", "-0", "-0.00", "1x25", "NaN", "79228162514264337593543950336", "0.00000000000000000000000000001"]) {
      expect(() => new HarnDecimal(value)).toThrow(TypeError);
    }
  });
});
