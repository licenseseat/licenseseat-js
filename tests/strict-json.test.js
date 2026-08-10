import { describe, expect, it } from "vitest";

import {
  StrictJsonError,
  equalJsonValues,
  parseStrictJson,
} from "../src/strict-json.js";

describe("strict JSON parsing", () => {
  it("parses every JSON value type without changing object-key semantics", () => {
    const parsed = parseStrictJson(
      ' { "text": "hello\\n🌍", "number": -1.25e2, "yes": true, "no": false, "nil": null, "items": [1, "x", {}] } '
    );

    expect(parsed).toEqual({
      text: "hello\n🌍",
      number: -125,
      yes: true,
      no: false,
      nil: null,
      items: [1, "x", {}],
    });
  });

  it.each([
    ['{"role":"user","role":"admin"}', "Duplicate JSON object key"],
    ['{"a":1,"\\u0061":2}', "Duplicate JSON object key"],
    ['{"nested":{"x":1,"x":2}}', "Duplicate JSON object key"],
    ["", "empty"],
    ["   ", "empty"],
    ["{} trailing", "trailing"],
    ["[1,]", "Unexpected token"],
    ['{"a" 1}', "Expected ':'"],
    ['{"a":1,}', "Expected a JSON string"],
    ["[1 2]", "Expected ',' or ']'"],
    ['{"a":1 "b":2}', "Expected ',' or '}'"],
    ['{"a":', "Unexpected token"],
    ['{"a":1', "Expected ',' or '}'"],
    ["[1", "Expected ',' or ']'"],
    ['"unterminated', "Unterminated JSON string"],
    ['"\\x"', "Invalid JSON string escape"],
    ['"\\u12x4"', "Invalid Unicode escape"],
    ['"line\nbreak"', "Unescaped control character"],
    ["01", "trailing"],
    ["1e", "trailing"],
    ["1e9999", "finite range"],
    ["NaN", "Unexpected token"],
    ["undefined", "Unexpected token"],
    ['"\\ud800"', "unpaired Unicode surrogate"],
    ['"\\udc00"', "unpaired Unicode surrogate"],
  ])("rejects ambiguous or invalid JSON %#", (source, message) => {
    expect(() => parseStrictJson(source)).toThrow(message);
  });

  it("creates a harmless own __proto__ property", () => {
    const parsed = parseStrictJson('{"__proto__":{"polluted":true}}');

    expect(Object.prototype.polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(parsed, "__proto__")).toBe(true);
    expect(parsed.__proto__).toEqual({ polluted: true });
  });

  it("enforces byte, depth, node, and string limits", () => {
    expect(() => parseStrictJson('"éé"', { maxBytes: 5 })).toThrow("byte limit");
    expect(() => parseStrictJson('"abcd"', { maxStringLength: 3 })).toThrow("length limit");
    expect(() => parseStrictJson("[[[0]]]", { maxDepth: 2 })).toThrow("depth limit");
    expect(() => parseStrictJson("[1,2,3]", { maxNodes: 3 })).toThrow("too many values");
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid parser limits (%s)",
    (limit) => {
      expect(() => parseStrictJson("null", { maxDepth: limit })).toThrow(StrictJsonError);
    }
  );

  it("rejects non-string input with the dedicated error type", () => {
    expect(() => parseStrictJson({})).toThrow(StrictJsonError);
  });
});

describe("strict JSON equality", () => {
  it("compares object keys independently of insertion order", () => {
    expect(equalJsonValues({ a: 1, b: [true, null] }, { b: [true, null], a: 1 })).toBe(true);
  });

  it.each([
    [{ a: 1 }, { a: 2 }],
    [{ a: 1 }, { a: 1, b: 2 }],
    [[1], [1, 2]],
    [[1], { 0: 1 }],
    [null, {}],
    [0, -0],
    ["1", 1],
  ])("rejects unequal JSON values %#", (left, right) => {
    expect(equalJsonValues(left, right)).toBe(false);
  });

  it("fails closed at the configured comparison depth", () => {
    expect(equalJsonValues({ a: { b: 1 } }, { a: { b: 1 } }, 0)).toBe(false);
  });
});
