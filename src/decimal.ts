import { WIRE_DECIMAL_MAX_MANTISSA, WIRE_DECIMAL_MAX_SCALE, WIRE_DECIMAL_PATTERN } from "./generated/codegen.js";

const pattern = new RegExp(WIRE_DECIMAL_PATTERN);
const maximum = BigInt(WIRE_DECIMAL_MAX_MANTISSA);

/** An exact Harn decimal. Its canonical spelling retains fractional scale. */
export class HarnDecimal {
  readonly #text: string;

  constructor(text: string) {
    if (typeof text !== "string" || text.length > WIRE_DECIMAL_MAX_MANTISSA.length + 2 || !pattern.test(text)) throw new TypeError("Invalid canonical Harn decimal");
    const digits = text.replace("-", "").replace(".", "");
    const coefficient = BigInt(digits);
    const scale = text.includes(".") ? text.length - text.indexOf(".") - 1 : 0;
    if (coefficient > maximum || scale > WIRE_DECIMAL_MAX_SCALE || (coefficient === 0n && text.startsWith("-"))) {
      throw new TypeError("Invalid canonical Harn decimal");
    }
    this.#text = text;
    Object.freeze(this);
  }

  toString(): string { return this.#text; }
  toJSON(): string { return this.#text; }
}
