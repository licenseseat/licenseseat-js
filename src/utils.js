/**
 * LicenseSeat SDK Utility Functions
 * @module utils
 */

// @ts-ignore - canonical-json has a default export that is the stringify function
import CJSON from "canonical-json";

/**
 * Parse active entitlements from a raw API payload into a consistent shape
 * @param {Object} [payload={}] - Raw payload from API or offline license
 * @returns {import('./types.js').Entitlement[]} Normalized entitlements array
 */
export function parseActiveEntitlements(payload = {}) {
  const raw = payload.active_ents || payload.active_entitlements || [];
  return raw.map((e) => ({
    key: e.key,
    name: e.name ?? null,
    description: e.description ?? null,
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
    console.warn(
      "[LicenseSeat SDK] canonical-json library not loaded correctly. Falling back to basic JSON.stringify. Signature verification might be unreliable if server uses different canonicalization."
    );
    try {
      const sortedObj = {};
      Object.keys(obj)
        .sort()
        .forEach((key) => {
          sortedObj[key] = obj[key];
        });
      return JSON.stringify(sortedObj);
    } catch (e) {
      return JSON.stringify(obj);
    }
  }
  return stringify(obj);
}

/**
 * Decode a Base64URL string to a Uint8Array
 * @param {string} base64UrlString - The Base64URL encoded string
 * @returns {Uint8Array} Decoded bytes
 */
export function base64UrlDecode(base64UrlString) {
  let base64 = base64UrlString.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) {
    base64 += "=";
  }
  const raw = window.atob(base64);
  const outputArray = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) {
    outputArray[i] = raw.charCodeAt(i);
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
 * Generate a unique device identifier based on browser characteristics
 * @returns {string} Unique device identifier
 */
export function generateDeviceId() {
  const nav = window.navigator;
  const screen = window.screen;
  const data = [
    nav.userAgent,
    nav.language,
    screen.colorDepth,
    screen.width + "x" + screen.height,
    new Date().getTimezoneOffset(),
    nav.hardwareConcurrency,
    getCanvasFingerprint(),
  ].join("|");

  return `web-${hashCode(data)}-${Date.now().toString(36)}`;
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
  /** @type {HTMLMetaElement|null} */
  const token = document.querySelector('meta[name="csrf-token"]');
  return token ? token.content : "";
}
