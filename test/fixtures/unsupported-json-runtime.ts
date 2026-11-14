import assert from "node:assert/strict";
import { parseLosslessJson, stringifyLosslessJson } from "../../src/lossless-json.js";

if (process.argv[2] === "rawJSON") {
  Object.defineProperty(JSON, "rawJSON", { value: undefined });
} else {
  const parse = JSON.parse;
  JSON.parse = (text, reviver) => parse(text, reviver && ((key, value) => reviver(key, value)));
}
assert.throws(() => parseLosslessJson("1"), /requires JSON.parse source context/);
console.log("parse refused");
assert.throws(() => stringifyLosslessJson({ value: 1n }), /requires JSON.parse source context/);
console.log("stringify refused");
