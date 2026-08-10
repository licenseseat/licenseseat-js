/**
 * Small, dependency-free JSON parser used at trust boundaries.
 *
 * JSON.parse silently accepts duplicate object keys (the last value wins),
 * which makes signed and security-sensitive payloads ambiguous. This parser
 * rejects duplicates and applies conservative resource limits while parsing.
 */

export class StrictJsonError extends SyntaxError {
  /**
   * @param {string} message
   * @param {number} [offset]
   */
  constructor(message, offset) {
    super(offset === undefined ? message : `${message} at offset ${offset}`);
    this.name = "StrictJsonError";
    this.offset = offset;
  }
}

/**
 * @typedef {Object} StrictJsonOptions
 * @property {number} [maxBytes]
 * @property {number} [maxDepth]
 * @property {number} [maxNodes]
 * @property {number} [maxStringLength]
 */

const DEFAULT_OPTIONS = Object.freeze({
  maxBytes: 1024 * 1024,
  maxDepth: 32,
  maxNodes: 20_000,
  maxStringLength: 256 * 1024,
});

/**
 * Parse unambiguous JSON with bounded depth, node count, and string size.
 * Objects are constructed with ordinary prototypes but properties are defined
 * directly, so even a literal "__proto__" key cannot invoke a setter.
 *
 * @param {string} source
 * @param {StrictJsonOptions} [options]
 * @returns {*}
 */
export function parseStrictJson(source, options = {}) {
  if (typeof source !== "string") {
    throw new StrictJsonError("JSON input must be a string");
  }

  const limits = { ...DEFAULT_OPTIONS, ...options };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new StrictJsonError(`${name} must be a positive safe integer`);
    }
  }

  if (new TextEncoder().encode(source).byteLength > limits.maxBytes) {
    throw new StrictJsonError("JSON input exceeds the configured byte limit");
  }

  let offset = 0;
  let nodes = 0;

  const fail = (message) => {
    throw new StrictJsonError(message, offset);
  };

  const countNode = () => {
    nodes += 1;
    if (nodes > limits.maxNodes) fail("JSON input has too many values");
  };

  const skipWhitespace = () => {
    while (offset < source.length) {
      const code = source.charCodeAt(offset);
      if (code === 0x20 || code === 0x0a || code === 0x0d || code === 0x09) {
        offset += 1;
      } else {
        break;
      }
    }
  };

  const parseString = () => {
    if (source[offset] !== '"') fail("Expected a JSON string");
    const start = offset;
    offset += 1;
    while (offset < source.length) {
      const code = source.charCodeAt(offset);
      if (code === 0x22) {
        offset += 1;
        let value;
        try {
          value = JSON.parse(source.slice(start, offset));
        } catch (_) {
          fail("Invalid JSON string escape");
        }
        for (let index = 0; index < value.length; index += 1) {
          const code = value.charCodeAt(index);
          if (code >= 0xd800 && code <= 0xdbff) {
            const next = value.charCodeAt(index + 1);
            if (!(next >= 0xdc00 && next <= 0xdfff)) {
              fail("JSON string contains an unpaired Unicode surrogate");
            }
            index += 1;
          } else if (code >= 0xdc00 && code <= 0xdfff) {
            fail("JSON string contains an unpaired Unicode surrogate");
          }
        }
        if (value.length > limits.maxStringLength) {
          fail("JSON string exceeds the configured length limit");
        }
        return value;
      }
      if (code < 0x20) fail("Unescaped control character in JSON string");
      if (code === 0x5c) {
        offset += 1;
        if (offset >= source.length) fail("Unterminated JSON string escape");
        const escaped = source[offset];
        if (escaped === "u") {
          const hex = source.slice(offset + 1, offset + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail("Invalid Unicode escape");
          offset += 4;
        } else if (!'"\\/bfnrt'.includes(escaped)) {
          fail("Invalid JSON string escape");
        }
      }
      offset += 1;
    }
    fail("Unterminated JSON string");
  };

  const parseNumber = () => {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(
      source.slice(offset)
    );
    if (!match) fail("Invalid JSON number");
    offset += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) fail("JSON number is outside the finite range");
    return value;
  };

  /** @type {(depth: number) => *} */
  const parseValue = (depth) => {
    if (depth > limits.maxDepth) fail("JSON input exceeds the depth limit");
    skipWhitespace();
    countNode();
    const current = source[offset];

    if (current === '"') return parseString();
    if (current === "{") {
      offset += 1;
      skipWhitespace();
      const result = {};
      const keys = new Set();
      if (source[offset] === "}") {
        offset += 1;
        return result;
      }
      while (offset < source.length) {
        skipWhitespace();
        const key = parseString();
        if (keys.has(key)) fail(`Duplicate JSON object key ${JSON.stringify(key)}`);
        keys.add(key);
        skipWhitespace();
        if (source[offset] !== ":") fail("Expected ':' after JSON object key");
        offset += 1;
        const value = parseValue(depth + 1);
        Object.defineProperty(result, key, {
          value,
          enumerable: true,
          configurable: true,
          writable: true,
        });
        skipWhitespace();
        if (source[offset] === "}") {
          offset += 1;
          return result;
        }
        if (source[offset] !== ",") fail("Expected ',' or '}' in JSON object");
        offset += 1;
      }
      fail("Unterminated JSON object");
    }

    if (current === "[") {
      offset += 1;
      skipWhitespace();
      const result = [];
      if (source[offset] === "]") {
        offset += 1;
        return result;
      }
      while (offset < source.length) {
        result.push(parseValue(depth + 1));
        skipWhitespace();
        if (source[offset] === "]") {
          offset += 1;
          return result;
        }
        if (source[offset] !== ",") fail("Expected ',' or ']' in JSON array");
        offset += 1;
      }
      fail("Unterminated JSON array");
    }

    if (source.startsWith("true", offset)) {
      offset += 4;
      return true;
    }
    if (source.startsWith("false", offset)) {
      offset += 5;
      return false;
    }
    if (source.startsWith("null", offset)) {
      offset += 4;
      return null;
    }
    if (current === "-" || (current >= "0" && current <= "9")) {
      return parseNumber();
    }
    fail("Unexpected token in JSON input");
  };

  skipWhitespace();
  if (offset === source.length) fail("JSON input is empty");
  const result = parseValue(0);
  skipWhitespace();
  if (offset !== source.length) fail("Unexpected trailing JSON data");
  return result;
}

/**
 * Compare JSON values without invoking user-controlled prototypes or coercions.
 *
 * @param {*} left
 * @param {*} right
 * @param {number} [maxDepth]
 * @returns {boolean}
 */
export function equalJsonValues(left, right, maxDepth = 32) {
  const compare = (a, b, depth) => {
    if (Object.is(a, b)) return true;
    if (depth > maxDepth || a === null || b === null || typeof a !== typeof b) {
      return false;
    }
    if (Array.isArray(a) || Array.isArray(b)) {
      if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
      return a.every((value, index) => compare(value, b[index], depth + 1));
    }
    if (typeof a !== "object") return false;
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    const bKeySet = new Set(bKeys);
    return aKeys.every(
      (key) => bKeySet.has(key) && compare(a[key], b[key], depth + 1)
    );
  };

  return compare(left, right, 0);
}
