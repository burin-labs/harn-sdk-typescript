import { HarnDecimal } from "@burin-labs/harn";
import type { Payload } from "./generated/types.js";

export function payload(): Payload {
  return {
    tag: "payload", sequence: 9223372036854775807n, floating: 1,
    raw: Uint8Array.of(0, 255, 128), amount: new HarnDecimal("1.2300"),
    names: new Set(["雪", "a"]), scalars: new Set<boolean | bigint>([true, 1n]),
    pair: ["雪", 9007199254740993n], properties: { ["__proto__"]: "own" },
    tree: { value: 7n, next: null }, choice: { enum: "Choice", variant: "Present", fields: [{ value: 8n }] },
    left: { detail: { token: "left" } }, right: { detail: { token: 9007199254740993n } },
    context: { id: 1n }, branch: { kind: "left", left: 2n }, nullable: null,
  };
}
