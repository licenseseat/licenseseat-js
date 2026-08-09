/**
 * LicenseSeat SDK Cache Manager
 * Handles persistent storage of license data, offline licenses, and public keys.
 * @module cache
 */

import { parseStrictJson } from "./strict-json.js";

const MAX_CACHE_ENTRY_BYTES = 1024 * 1024;
const CACHE_SUFFIXES = Object.freeze([
  "license",
  "offline_token",
  "public_keys",
  "last_seen_ts",
  "device_id",
]);

function validPrefix(prefix) {
  return (
    typeof prefix === "string" &&
    prefix.length >= 3 &&
    prefix.length <= 128 &&
    /^[A-Za-z0-9._:-]+$/.test(prefix)
  );
}

function validKeyId(keyId) {
  return (
    typeof keyId === "string" &&
    keyId.length >= 1 &&
    keyId.length <= 255 &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(keyId)
  );
}

/**
 * License Cache Manager
 * Manages persistent storage of license data using localStorage.
 */
export class LicenseCache {
  /**
   * Create a LicenseCache instance
   * @param {string} [prefix="licenseseat_"] - Prefix for all localStorage keys
   */
  constructor(prefix = "licenseseat_") {
    if (!validPrefix(prefix)) {
      throw new TypeError(
        "Cache prefix must be 3-128 characters using only letters, digits, '.', '_', ':', or '-'"
      );
    }
    /** @type {string} */
    this.prefix = prefix;
    /** @type {string} */
    this.publicKeyCacheKey = this.prefix + "public_keys";
    /** @type {Storage|null} */
    this.storage = null;
    try {
      this.storage = typeof globalThis.localStorage === "undefined"
        ? null
        : globalThis.localStorage;
    } catch (_) {
      this.storage = null;
    }
  }

  /**
   * @param {string} suffix
   * @returns {*|null}
   * @private
   */
  readJson(suffix) {
    if (!this.storage) return null;
    try {
      const data = this.storage.getItem(this.prefix + suffix);
      if (!data) return null;
      return parseStrictJson(data, {
        maxBytes: MAX_CACHE_ENTRY_BYTES,
        maxDepth: 32,
        maxNodes: 20_000,
        maxStringLength: 256 * 1024,
      });
    } catch (_) {
      return null;
    }
  }

  /**
   * @param {string} suffix
   * @param {*} value
   * @returns {boolean}
   * @private
   */
  writeJson(suffix, value) {
    if (!this.storage) return false;
    try {
      const serialized = JSON.stringify(value);
      if (
        typeof serialized !== "string" ||
        new TextEncoder().encode(serialized).byteLength > MAX_CACHE_ENTRY_BYTES
      ) {
        return false;
      }
      this.storage.setItem(this.prefix + suffix, serialized);
      return true;
    } catch (_) {
      return false;
    }
  }

  /**
   * Get the cached license data
   * @returns {import('./types.js').CachedLicense|null} Cached license or null if not found
   */
  getLicense() {
    const value = this.readJson("license");
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : null;
  }

  /**
   * Store license data in cache
   * @param {import('./types.js').CachedLicense} data - License data to cache
   * @returns {void}
   */
  setLicense(data) {
    this.writeJson("license", data);
  }

  /**
   * Update the validation data for the cached license
   * @param {import('./types.js').ValidationResult} validationData - Validation result to store
   * @returns {void}
   */
  updateValidation(validationData) {
    const license = this.getLicense();
    if (license) {
      license.validation = validationData;
      license.last_validated = new Date().toISOString();
      this.setLicense(license);
    }
  }

  /**
   * Get the device ID from the cached license
   * @returns {string|null} Device ID or null if not found
   */
  getDeviceId() {
    const license = this.getLicense();
    return license ? license.device_id : null;
  }

  /**
   * Get the cryptographically random installation identifier used when the
   * caller does not provide an explicit device fingerprint.
   * @returns {string|null}
   */
  getInstallationId() {
    if (!this.storage) return null;
    try {
      const value = this.storage.getItem(this.prefix + "device_id");
      return typeof value === "string" && value.length <= 255 ? value : null;
    } catch (_) {
      return null;
    }
  }

  /** @param {string} value */
  setInstallationId(value) {
    if (!this.storage || typeof value !== "string" || value.length > 255) return;
    try {
      this.storage.setItem(this.prefix + "device_id", value);
    } catch (_) {
      // Storage is best-effort; the active license record also stores the ID.
    }
  }

  /**
   * Clear the cached license data
   * @returns {void}
   */
  clearLicense() {
    try {
      this.storage?.removeItem(this.prefix + "license");
    } catch (_) {
      // Storage is best-effort. In-memory authorization is maintained by the SDK.
    }
  }

  /**
   * Get the cached offline token
   * @returns {import('./types.js').OfflineToken|null} Offline token or null if not found
   */
  getOfflineToken() {
    const value = this.readJson("offline_token");
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;

    // JSON.stringify normalizes representationally equivalent numbers such as
    // signed -0.0 to 0. Rebuild the cached visible payload from the exact
    // signed canonical bytes so a legitimate cross-language token survives a
    // storage round trip. The verifier still checks the canonical signature;
    // attacker-controlled cached token fields are never an authority root.
    if (typeof value.canonical === "string") {
      try {
        return {
          ...value,
          token: parseStrictJson(value.canonical, {
            maxBytes: MAX_CACHE_ENTRY_BYTES,
            maxDepth: 32,
            maxNodes: 20_000,
            maxStringLength: 256 * 1024,
          }),
        };
      } catch (_) {
        // Return the stored envelope so trust-boundary validation can produce
        // the normal fail-closed error code for malformed canonical data.
      }
    }

    return value;
  }

  /**
   * Store offline token data in cache
   * @param {import('./types.js').OfflineToken} data - Offline token to cache
   * @returns {void}
   */
  setOfflineToken(data) {
    this.writeJson("offline_token", data);
  }

  /**
   * Clear the cached offline token
   * @returns {void}
   */
  clearOfflineToken() {
    try {
      this.storage?.removeItem(this.prefix + "offline_token");
    } catch (_) {
      // Best-effort cache removal.
    }
  }

  /**
   * Get a cached public key by key ID
   * @param {string} keyId - The key ID to look up
   * @returns {string|null} Base64-encoded public key or null if not found
   */
  getPublicKey(keyId) {
    if (!validKeyId(keyId)) return null;
    const cache = this.readJson("public_keys");
    if (!cache || typeof cache !== "object" || Array.isArray(cache)) return null;
    const value = Object.prototype.hasOwnProperty.call(cache, keyId)
      ? cache[keyId]
      : null;
    return typeof value === "string" && value.length <= 128 ? value : null;
  }

  /**
   * Store a public key in cache
   * @param {string} keyId - The key ID
   * @param {string} publicKeyB64 - Base64-encoded public key
   * @returns {void}
   */
  setPublicKey(keyId, publicKeyB64) {
    if (!validKeyId(keyId) || typeof publicKeyB64 !== "string" || publicKeyB64.length > 128) {
      return;
    }
    const existing = this.readJson("public_keys");
    const cache = Object.create(null);
    if (existing && typeof existing === "object" && !Array.isArray(existing)) {
      for (const [key, value] of Object.entries(existing)) {
        if (validKeyId(key) && typeof value === "string" && value.length <= 128) {
          cache[key] = value;
        }
      }
    }
    cache[keyId] = publicKeyB64;
    this.writeJson("public_keys", cache);
  }

  /**
   * Clear all LicenseSeat SDK data for this prefix
   * @returns {void}
   */
  clear() {
    for (const suffix of CACHE_SUFFIXES) {
      try {
        this.storage?.removeItem(this.prefix + suffix);
      } catch (_) {
        // Continue clearing the remaining known SDK keys.
      }
    }
  }

  /**
   * Get the last seen timestamp (for clock tamper detection)
   * @returns {number|null} Unix timestamp in milliseconds or null if not set
   */
  getLastSeenTimestamp() {
    if (!this.storage) return null;
    try {
      const value = this.storage.getItem(this.prefix + "last_seen_ts");
      if (!value || !/^\d{1,16}$/.test(value)) return null;
      const timestamp = Number(value);
      return Number.isSafeInteger(timestamp) && timestamp >= 0 ? timestamp : null;
    } catch (_) {
      return null;
    }
  }

  /**
   * Store the last seen timestamp
   * @param {number} ts - Unix timestamp in milliseconds
   * @returns {void}
   */
  setLastSeenTimestamp(ts) {
    if (!Number.isSafeInteger(ts) || ts < 0 || !this.storage) return;
    try {
      this.storage.setItem(this.prefix + "last_seen_ts", String(ts));
    } catch (_) {
      // Ignore storage errors for timestamp
    }
  }
}
