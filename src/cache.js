/**
 * LicenseSeat SDK Cache Manager
 * Handles persistent storage of license data, offline licenses, and public keys.
 * @module cache
 */

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
    /** @type {string} */
    this.prefix = prefix;
    /** @type {string} */
    this.publicKeyCacheKey = this.prefix + "public_keys";
  }

  /**
   * Get the cached license data
   * @returns {import('./types.js').CachedLicense|null} Cached license or null if not found
   */
  getLicense() {
    try {
      const data = localStorage.getItem(this.prefix + "license");
      return data ? JSON.parse(data) : null;
    } catch (e) {
      console.error("Failed to read license cache:", e);
      return null;
    }
  }

  /**
   * Store license data in cache
   * @param {import('./types.js').CachedLicense} data - License data to cache
   * @returns {void}
   */
  setLicense(data) {
    try {
      localStorage.setItem(this.prefix + "license", JSON.stringify(data));
    } catch (e) {
      console.error("Failed to cache license:", e);
    }
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
   * Get the device identifier from the cached license
   * @returns {string|null} Device identifier or null if not found
   */
  getDeviceId() {
    const license = this.getLicense();
    return license ? license.device_identifier : null;
  }

  /**
   * Clear the cached license data
   * @returns {void}
   */
  clearLicense() {
    localStorage.removeItem(this.prefix + "license");
  }

  /**
   * Get the cached offline license
   * @returns {import('./types.js').SignedOfflineLicense|null} Offline license or null if not found
   */
  getOfflineLicense() {
    try {
      const data = localStorage.getItem(this.prefix + "offline_license");
      return data ? JSON.parse(data) : null;
    } catch (e) {
      console.error("Failed to read offline license cache:", e);
      return null;
    }
  }

  /**
   * Store offline license data in cache
   * @param {import('./types.js').SignedOfflineLicense} data - Signed offline license to cache
   * @returns {void}
   */
  setOfflineLicense(data) {
    try {
      localStorage.setItem(
        this.prefix + "offline_license",
        JSON.stringify(data)
      );
    } catch (e) {
      console.error("Failed to cache offline license:", e);
    }
  }

  /**
   * Clear the cached offline license
   * @returns {void}
   */
  clearOfflineLicense() {
    localStorage.removeItem(this.prefix + "offline_license");
  }

  /**
   * Get a cached public key by key ID
   * @param {string} keyId - The key ID to look up
   * @returns {string|null} Base64-encoded public key or null if not found
   */
  getPublicKey(keyId) {
    try {
      const cache = JSON.parse(
        localStorage.getItem(this.publicKeyCacheKey) || "{}"
      );
      return cache[keyId] || null;
    } catch (e) {
      console.error("Failed to read public key cache:", e);
      return null;
    }
  }

  /**
   * Store a public key in cache
   * @param {string} keyId - The key ID
   * @param {string} publicKeyB64 - Base64-encoded public key
   * @returns {void}
   */
  setPublicKey(keyId, publicKeyB64) {
    try {
      const cache = JSON.parse(
        localStorage.getItem(this.publicKeyCacheKey) || "{}"
      );
      cache[keyId] = publicKeyB64;
      localStorage.setItem(this.publicKeyCacheKey, JSON.stringify(cache));
    } catch (e) {
      console.error("Failed to cache public key:", e);
    }
  }

  /**
   * Clear all LicenseSeat SDK data for this prefix
   * @returns {void}
   */
  clear() {
    Object.keys(localStorage).forEach((key) => {
      if (key.startsWith(this.prefix)) {
        localStorage.removeItem(key);
      }
    });
    this.clearOfflineLicense();
    localStorage.removeItem(this.prefix + "last_seen_ts");
  }

  /**
   * Get the last seen timestamp (for clock tamper detection)
   * @returns {number|null} Unix timestamp in milliseconds or null if not set
   */
  getLastSeenTimestamp() {
    const v = localStorage.getItem(this.prefix + "last_seen_ts");
    return v ? parseInt(v, 10) : null;
  }

  /**
   * Store the last seen timestamp
   * @param {number} ts - Unix timestamp in milliseconds
   * @returns {void}
   */
  setLastSeenTimestamp(ts) {
    try {
      localStorage.setItem(this.prefix + "last_seen_ts", String(ts));
    } catch (e) {
      // Ignore storage errors for timestamp
    }
  }
}
