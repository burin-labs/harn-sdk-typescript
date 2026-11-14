import { WIRE_INTEGER_TOKEN_PATTERN } from "./generated/codegen.js";

export type LosslessJsonValue =
  | null
  | boolean
  | string
  | number
  | bigint
  | LosslessJsonValue[]
  | { [key: string]: LosslessJsonValue };

export function jsonObject(value: LosslessJsonValue | undefined): value is { [key: string]: LosslessJsonValue } {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

type SourceContext = { source?: string };
type NativeJson = {
  parse(text: string, reviver: (key: string, value: unknown, context: SourceContext) => unknown): unknown;
  rawJSON?: (text: string) => unknown;
};

let nativeJson: Required<NativeJson> | undefined;
const integerToken = new RegExp(WIRE_INTEGER_TOKEN_PATTERN);

function requireLosslessJson(): Required<NativeJson> {
  if (nativeJson) return nativeJson;
  const candidate = JSON as unknown as NativeJson;
  let source: string | undefined;
  candidate.parse("9007199254740993", (_key, value, context) => {
    source = context?.source;
    return value;
  });
  if (
    source !== "9007199254740993" ||
    typeof candidate.rawJSON !== "function" ||
    JSON.stringify(candidate.rawJSON("9007199254740993")) !== "9007199254740993"
  ) {
    throw new Error("Harn wire transport requires JSON.parse source context and JSON.rawJSON support");
  }
  nativeJson = candidate as Required<NativeJson>;
  return nativeJson;
}

/** Retain JSON integer tokens as bigint and floating tokens as number. */
export function parseLosslessJson(text: string): LosslessJsonValue {
  const json = requireLosslessJson();
  return json.parse(text, (_key, value, context) => {
    if (typeof value !== "number") return value;
    if (!Number.isFinite(value)) throw new Error("Harn wire JSON contains a non-finite number");
    if (context?.source && integerToken.test(context.source)) {
      return BigInt(context.source);
    }
    return value;
  }) as LosslessJsonValue;
}

/** Emit bigint as JSON numbers, including inside opaque Harn-prepared schema projections. */
export function stringifyLosslessJson(value: unknown): string {
  const json = requireLosslessJson();
  return JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item === "bigint") return json.rawJSON(item.toString());
    if (typeof item === "number") {
      if (!Number.isFinite(item)) throw new Error("Harn wire JSON cannot contain a non-finite number");
      if (Object.is(item, -0)) return json.rawJSON("-0.0");
      const text = String(item);
      if (!/[.eE]/.test(text)) return json.rawJSON(`${text}.0`);
    }
    if (item === undefined || typeof item === "function" || typeof item === "symbol") {
      throw new Error("Harn wire JSON contains a value JSON cannot represent");
    }
    return item;
  });
}
