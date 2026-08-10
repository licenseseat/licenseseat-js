/**
 * LicenseSeat SDK Utility Functions
 * @module utils
 */

// @ts-ignore - canonical-json has a default export that is the stringify function
import CJSON from "canonical-json";

/**
 * Parse active entitlements from a raw API payload into a consistent shape
 * @param {Object} [payload={}] - Raw payload from API or offline token
 * @returns {import('./types.js').Entitlement[]} Normalized entitlements array
 */
export function parseActiveEntitlements(payload = {}) {
  // New v1 API uses "entitlements" or "active_entitlements"
  const raw = payload.entitlements || payload.active_entitlements || [];
  if (!Array.isArray(raw)) return [];
  return raw.map((e) => ({
    key: e.key,
    expires_at: e.expires_at ?? null,
    metadata: e.metadata ?? null,
  }));
}

/**
 * Constant-time string comparison to mitigate timing attacks
 * @param {string} [a=""] - First string
 * @param {string} [b=""] - Second string
 * @returns {boolean} True if strings are equal
 */
export function constantTimeEqual(a = "", b = "") {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let res = 0;
  for (let i = 0; i < a.length; i++) {
    res |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return res === 0;
}

/**
 * Generate a canonical JSON string from an object (keys sorted)
 * This is crucial for consistent signature verification.
 * @param {Object} obj - The object to stringify
 * @returns {string} Canonical JSON string
 */
export function canonicalJsonStringify(obj) {
  // canonical-json exports the stringify function directly as default
  /** @type {Function|undefined} */
  const stringify = typeof CJSON === "function" ? CJSON : (CJSON && typeof CJSON === "object" ? /** @type {any} */ (CJSON).stringify : undefined);
  if (!stringify || typeof stringify !== "function") {
    throw new Error("canonical-json is unavailable; refusing unsafe canonicalization fallback");
  }
  const result = stringify(obj);
  if (typeof result !== "string") {
    throw new Error("canonical-json returned an invalid result");
  }
  return result;
}

/**
 * Decode a Base64URL string to a Uint8Array
 * Works in both browser and Node.js environments.
 * @param {string} base64UrlString - The Base64URL encoded string
 * @param {{expectedBytes?: number, maxBytes?: number}} [options] - Decoding limits
 * @returns {Uint8Array} Decoded bytes
 */
export function base64UrlDecode(base64UrlString, options = {}) {
  if (typeof base64UrlString !== "string" || base64UrlString.length === 0) {
    throw new Error("Base64 input must be a non-empty string");
  }
  const { expectedBytes, maxBytes = 1024 * 1024 } = options;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error("maxBytes must be a positive safe integer");
  }
  if (/\s/.test(base64UrlString) || !/^[A-Za-z0-9+/_-]*={0,2}$/.test(base64UrlString)) {
    throw new Error("Invalid Base64 encoding");
  }
  if ((base64UrlString.includes("+") || base64UrlString.includes("/")) &&
      (base64UrlString.includes("-") || base64UrlString.includes("_"))) {
    throw new Error("Mixed Base64 and Base64URL alphabets are not allowed");
  }
  const firstPadding = base64UrlString.indexOf("=");
  if (firstPadding !== -1 && base64UrlString.length % 4 !== 0) {
    throw new Error("Invalid Base64 padding");
  }
  const unpadded = base64UrlString.replace(/=+$/, "");
  if (unpadded.length % 4 === 1) throw new Error("Invalid Base64 length");
  if (Math.floor((unpadded.length * 3) / 4) > maxBytes) {
    throw new Error("Decoded Base64 data exceeds the configured limit");
  }

  let base64 = unpadded.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) base64 += "=";

  // Cross-platform base64 decoding
  /** @type {string} */
  let raw;
  if (typeof atob === "function") {
    // Browser environment (or Node.js 16+ with global atob)
    raw = atob(base64);
  } else if (typeof Buffer !== "undefined") {
    // Node.js environment
    raw = Buffer.from(base64, "base64").toString("binary");
  } else {
    throw new Error("No base64 decoder available (neither atob nor Buffer found)");
  }

  if (raw.length > maxBytes) throw new Error("Decoded Base64 data exceeds the configured limit");
  const outputArray = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) {
    outputArray[i] = raw.charCodeAt(i);
  }
  if (expectedBytes !== undefined && outputArray.length !== expectedBytes) {
    throw new Error(`Decoded Base64 data must be exactly ${expectedBytes} bytes`);
  }

  let canonical;
  if (typeof btoa === "function") {
    canonical = btoa(raw).replace(/=+$/, "");
  } else if (typeof Buffer !== "undefined") {
    canonical = Buffer.from(outputArray).toString("base64").replace(/=+$/, "");
  }
  if (canonical !== undefined && canonical !== base64.replace(/=+$/, "")) {
    throw new Error("Non-canonical Base64 encoding");
  }
  return outputArray;
}

/**
 * Simple hash function for generating device fingerprints
 * @param {string} str - String to hash
 * @returns {string} Base36 encoded hash
 */
export function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

/**
 * Get canvas fingerprint for device identification
 * @returns {string} Canvas fingerprint or "no-canvas" if unavailable
 */
export function getCanvasFingerprint() {
  try {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    ctx.textBaseline = "top";
    ctx.font = "14px Arial";
    ctx.fillText("LicenseSeat SDK", 2, 2);
    return canvas.toDataURL().slice(-50);
  } catch (e) {
    return "no-canvas";
  }
}

/**
 * Generate a cryptographically random installation identifier. The SDK stores
 * this value so it remains stable across calls and reloads. Callers using this
 * low-level helper directly are responsible for persisting the returned value.
 * @returns {string} Random device identifier
 */
export function generateDeviceId() {
  if (typeof globalThis.crypto === "undefined") {
    throw new Error(
      "Secure randomness is unavailable; provide an explicit deviceId"
    );
  }
  const prefix = typeof window === "undefined" ? "node" : "web";
  if (typeof globalThis.crypto.randomUUID === "function") {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }
  if (typeof globalThis.crypto.getRandomValues !== "function") {
    throw new Error(
      "Secure randomness is unavailable; provide an explicit deviceId"
    );
  }
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  // RFC 4122 version/variant bits make the fallback shape familiar while all
  // security comes from getRandomValues.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${prefix}-${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Sleep for a specified duration
 * @param {number} ms - Duration in milliseconds
 * @returns {Promise<void>} Resolves after the specified duration
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Get CSRF token from meta tag (for browser form submissions)
 * @returns {string} CSRF token or empty string if not found
 */
export function getCsrfToken() {
  if (typeof document === "undefined") return "";
  /** @type {HTMLMetaElement|null} */
  const token = document.querySelector('meta[name="csrf-token"]');
  return token ? token.content : "";
}
