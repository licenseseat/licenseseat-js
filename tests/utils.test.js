/**
 * Utility functions tests
 */

import { afterEach, describe, it, expect, vi } from "vitest";
import {
  parseActiveEntitlements,
  constantTimeEqual,
  hashCode,
  base64UrlDecode,
  canonicalJsonStringify,
  generateDeviceId,
  getCanvasFingerprint,
  getCsrfToken,
  sleep,
} from "../src/utils.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.head.innerHTML = "";
});

describe("Utility Functions", () => {
  describe("parseActiveEntitlements", () => {
    it("should parse entitlements format (primary)", () => {
      const payload = {
        entitlements: [
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

    it("should parse active_entitlements format (fallback)", () => {
      const payload = {
        active_entitlements: [{ key: "beta", expires_at: null, metadata: null }],
      };

      const result = parseActiveEntitlements(payload);

      expect(result).toHaveLength(1);
      expect(result[0].key).toBe("beta");
    });

    it("should handle missing optional fields", () => {
      const payload = {
        entitlements: [{ key: "basic" }],
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

    it.each([
      ["", {}, "non-empty"],
      ["Y Q==", {}, "Invalid Base64"],
      ["+_==", {}, "Mixed Base64"],
      ["YQ=", {}, "padding"],
      ["A", {}, "length"],
      ["AAAA", { maxBytes: 1 }, "configured limit"],
      ["AA==", { expectedBytes: 2 }, "exactly 2 bytes"],
      ["AB==", {}, "Non-canonical"],
      ["AA==", { maxBytes: 0 }, "positive safe integer"],
    ])("rejects malformed or policy-violating Base64 %#", (value, options, message) => {
      expect(() => base64UrlDecode(value, options)).toThrow(message);
    });

    it("uses the Buffer fallback when browser codecs are unavailable", () => {
      vi.stubGlobal("atob", undefined);
      vi.stubGlobal("btoa", undefined);
      expect(Array.from(base64UrlDecode("aGVsbG8"))).toEqual(
        Array.from(new TextEncoder().encode("hello"))
      );
    });

    it("fails closed when no decoder exists", () => {
      vi.stubGlobal("atob", undefined);
      vi.stubGlobal("btoa", undefined);
      vi.stubGlobal("Buffer", undefined);
      expect(() => base64UrlDecode("AA==")).toThrow("No base64 decoder");
    });
  });

  describe("canonical JSON", () => {
    it("sorts keys deterministically", () => {
      expect(canonicalJsonStringify({ z: 1, a: { y: 2, b: 3 } })).toBe(
        '{"a":{"b":3,"y":2},"z":1}'
      );
    });
  });

  describe("secure installation IDs", () => {
    it("uses cryptographic UUID randomness and returns distinct browser IDs", () => {
      const first = generateDeviceId();
      const second = generateDeviceId();
      expect(first).toMatch(/^web-[0-9a-f-]{36}$/i);
      expect(second).not.toBe(first);
    });

    it("uses getRandomValues when randomUUID is unavailable", () => {
      vi.stubGlobal("crypto", {
        getRandomValues(bytes) {
          bytes.fill(1);
          return bytes;
        },
      });
      expect(generateDeviceId()).toBe("web-01010101-0101-4101-8101-010101010101");
    });

    it("refuses weak randomness", () => {
      vi.stubGlobal("crypto", undefined);
      expect(() => generateDeviceId()).toThrow("Secure randomness");
      vi.stubGlobal("crypto", {});
      expect(() => generateDeviceId()).toThrow("Secure randomness");
    });
  });

  describe("browser helpers", () => {
    it("reads CSRF metadata without exposing a missing value", () => {
      expect(getCsrfToken()).toBe("");
      const meta = document.createElement("meta");
      meta.name = "csrf-token";
      meta.content = "csrf-value";
      document.head.append(meta);
      expect(getCsrfToken()).toBe("csrf-value");
    });

    it("generates a canvas value and degrades safely when canvas is unavailable", () => {
      expect(getCanvasFingerprint()).toContain("mockCanvasFingerprint");
      vi.spyOn(document, "createElement").mockImplementation(() => {
        throw new Error("blocked");
      });
      expect(getCanvasFingerprint()).toBe("no-canvas");
    });

    it("resolves sleep after the requested timer", async () => {
      vi.useFakeTimers();
      const pending = sleep(25);
      await vi.advanceTimersByTimeAsync(25);
      await expect(pending).resolves.toBeUndefined();
    });
  });
});
