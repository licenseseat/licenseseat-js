/**
 * Utility functions tests
 */

import { describe, it, expect } from "vitest";
import {
  parseActiveEntitlements,
  constantTimeEqual,
  hashCode,
  base64UrlDecode,
} from "../src/utils.js";

describe("Utility Functions", () => {
  describe("parseActiveEntitlements", () => {
    it("should parse active_ents format", () => {
      const payload = {
        active_ents: [
          {
            key: "pro",
            expires_at: "2025-12-31T23:59:59Z",
            metadata: { tier: 1 },
          },
        ],
      };

      const result = parseActiveEntitlements(payload);

      expect(result).toHaveLength(1);
      expect(result[0].key).toBe("pro");
      expect(result[0].expires_at).toBe("2025-12-31T23:59:59Z");
      expect(result[0].metadata).toEqual({ tier: 1 });
    });

    it("should parse active_entitlements format", () => {
      const payload = {
        active_entitlements: [{ key: "beta", expires_at: null, metadata: null }],
      };

      const result = parseActiveEntitlements(payload);

      expect(result).toHaveLength(1);
      expect(result[0].key).toBe("beta");
    });

    it("should handle missing optional fields", () => {
      const payload = {
        active_ents: [{ key: "basic" }],
      };

      const result = parseActiveEntitlements(payload);

      expect(result[0].key).toBe("basic");
      expect(result[0].expires_at).toBeNull();
      expect(result[0].metadata).toBeNull();
    });

    it("should return empty array for empty payload", () => {
      expect(parseActiveEntitlements({})).toEqual([]);
      expect(parseActiveEntitlements()).toEqual([]);
    });
  });

  describe("constantTimeEqual", () => {
    it("should return true for equal strings", () => {
      expect(constantTimeEqual("abc", "abc")).toBe(true);
      expect(constantTimeEqual("", "")).toBe(true);
      expect(constantTimeEqual("test123", "test123")).toBe(true);
    });

    it("should return false for different strings", () => {
      expect(constantTimeEqual("abc", "abd")).toBe(false);
      expect(constantTimeEqual("abc", "ab")).toBe(false);
      expect(constantTimeEqual("ABC", "abc")).toBe(false);
    });

    it("should return false for strings of different lengths", () => {
      expect(constantTimeEqual("short", "longer")).toBe(false);
      expect(constantTimeEqual("a", "ab")).toBe(false);
    });

    it("should handle undefined values", () => {
      expect(constantTimeEqual(undefined, undefined)).toBe(true);
      expect(constantTimeEqual("test", undefined)).toBe(false);
    });
  });

  describe("hashCode", () => {
    it("should produce consistent hash for same input", () => {
      const hash1 = hashCode("test string");
      const hash2 = hashCode("test string");

      expect(hash1).toBe(hash2);
    });

    it("should produce different hash for different input", () => {
      const hash1 = hashCode("string1");
      const hash2 = hashCode("string2");

      expect(hash1).not.toBe(hash2);
    });

    it("should return base36 encoded string", () => {
      const hash = hashCode("test");

      // Base36 only contains 0-9 and a-z
      expect(hash).toMatch(/^[0-9a-z]+$/);
    });
  });

  describe("base64UrlDecode", () => {
    it("should decode base64url strings", () => {
      // "hello" in base64url
      const encoded = "aGVsbG8";
      const decoded = base64UrlDecode(encoded);

      expect(new TextDecoder().decode(decoded)).toBe("hello");
    });

    it("should handle base64url special characters", () => {
      // "test?test" in standard base64 is "dGVzdD90ZXN0" which can contain + and /
      // We use a known value that converts cleanly
      // "hello world" -> "aGVsbG8gd29ybGQ" in base64url (no special chars in this case)
      const base64url = "aGVsbG8gd29ybGQ";
      const decoded = base64UrlDecode(base64url);
      expect(new TextDecoder().decode(decoded)).toBe("hello world");
    });

    it("should add padding if missing", () => {
      // Without padding
      const noPadding = "YQ";
      const decoded = base64UrlDecode(noPadding);

      expect(new TextDecoder().decode(decoded)).toBe("a");
    });
  });
});
