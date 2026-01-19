/**
 * LicenseSeat JavaScript SDK
 *
 * A comprehensive client-side SDK for managing software licenses
 * with the LicenseSeat licensing system.
 *
 * Features:
 * - License activation and deactivation
 * - Local caching with encryption support
 * - Online and offline validation
 * - Automatic re-validation
 * - Entitlement checking
 * - Event-driven architecture
 * - Device fingerprinting
 * - Retry logic with exponential backoff
 *
 * @module LicenseSeat
 */

import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";

import { LicenseCache } from "./cache.js";
import { APIError, ConfigurationError, LicenseError, CryptoError } from "./errors.js";
import {
  parseActiveEntitlements,
  constantTimeEqual,
  canonicalJsonStringify,
  base64UrlDecode,
  generateDeviceId,
  sleep,
  getCsrfToken,
} from "./utils.js";

/**
 * Default configuration values
 * @type {import('./types.js').LicenseSeatConfig}
 */
const DEFAULT_CONFIG = {
  apiBaseUrl: "https://licenseseat.com/api",
  storagePrefix: "licenseseat_",
  autoValidateInterval: 3600000, // 1 hour
  networkRecheckInterval: 30000, // 30 seconds
  maxRetries: 3,
  retryDelay: 1000,
  apiKey: null,
  debug: false,
  offlineLicenseRefreshInterval: 1000 * 60 * 60 * 72, // 72 hours
  offlineFallbackEnabled: false, // default false (strict mode, matches Swift SDK)
  maxOfflineDays: 0, // 0 = disabled
  maxClockSkewMs: 5 * 60 * 1000, // 5 minutes
  autoInitialize: true,
};

/**
 * LicenseSeat SDK Main Class
 *
 * Provides license activation, validation, and entitlement checking
 * for client-side JavaScript applications.
 *
 * @example
 * ```js
 * const sdk = new LicenseSeatSDK({
 *   apiKey: 'your-api-key',
 *   debug: true
 * });
 *
 * // Activate a license
 * await sdk.activate('LICENSE-KEY-HERE');
 *
 * // Check entitlements
 * if (sdk.hasEntitlement('pro-features')) {
 *   // Enable pro features
 * }
 * ```
 */
export class LicenseSeatSDK {
  /**
   * Create a new LicenseSeat SDK instance
   * @param {import('./types.js').LicenseSeatConfig} [config={}] - Configuration options
   */
  constructor(config = {}) {
    /**
     * SDK configuration
     * @type {import('./types.js').LicenseSeatConfig}
     */
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    };

    /**
     * Event listeners map
     * @type {Object<string, import('./types.js').EventCallback[]>}
     * @private
     */
    this.eventListeners = {};

    /**
     * Auto-validation timer ID
     * @type {ReturnType<typeof setInterval>|null}
     * @private
     */
    this.validationTimer = null;

    /**
     * License cache manager
     * @type {LicenseCache}
     * @private
     */
    this.cache = new LicenseCache(this.config.storagePrefix);

    /**
     * Current online status
     * @type {boolean}
     * @private
     */
    this.online = true;

    /**
     * Current license key being auto-validated
     * @type {string|null}
     * @private
     */
    this.currentAutoLicenseKey = null;

    /**
     * Connectivity polling timer ID
     * @type {ReturnType<typeof setInterval>|null}
     * @private
     */
    this.connectivityTimer = null;

    /**
     * Offline license refresh timer ID
     * @type {ReturnType<typeof setInterval>|null}
     * @private
     */
    this.offlineRefreshTimer = null;

    /**
     * Last offline validation result (to avoid duplicate emits)
     * @type {import('./types.js').ValidationResult|null}
     * @private
     */
    this.lastOfflineValidation = null;

    /**
     * Flag to prevent concurrent syncOfflineAssets calls
     * @type {boolean}
     * @private
     */
    this.syncingOfflineAssets = false;

    /**
     * Flag indicating if SDK has been destroyed
     * @type {boolean}
     * @private
     */
    this.destroyed = false;

    // Enable synchronous SHA512 for noble-ed25519
    if (ed && ed.etc && sha512) {
      ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));
    } else {
      console.error(
        "[LicenseSeat SDK] Noble-ed25519 or Noble-hashes not loaded correctly. Sync crypto methods may fail."
      );
    }

    // Initialize on construction (unless autoInitialize is disabled)
    if (this.config.autoInitialize) {
      this.initialize();
    }
  }

  /**
   * Initialize the SDK
   * Loads cached license and starts auto-validation if configured.
   * Called automatically unless autoInitialize is set to false.
   * @returns {void}
   */
  initialize() {
    this.log("LicenseSeat SDK initialized", this.config);

    const cachedLicense = this.cache.getLicense();
    if (cachedLicense) {
      this.emit("license:loaded", cachedLicense);

      // Quick offline verification for instant UX
      if (this.config.offlineFallbackEnabled) {
        this.quickVerifyCachedOfflineLocal()
          .then((offlineResult) => {
            if (offlineResult) {
              this.cache.updateValidation(offlineResult);
              if (offlineResult.valid) {
                this.emit("validation:offline-success", offlineResult);
              } else {
                this.emit("validation:offline-failed", offlineResult);
              }
              this.lastOfflineValidation = offlineResult;
            }
          })
          .catch(() => {});
      }

      // Start auto-validation if API key is configured
      if (this.config.apiKey) {
        this.startAutoValidation(cachedLicense.license_key);

        // Validate in background
        this.validateLicense(cachedLicense.license_key).catch((err) => {
          this.log("Background validation failed:", err);

          if (
            err instanceof APIError &&
            (err.status === 401 || err.status === 501)
          ) {
            this.log(
              "Authentication issue during validation, using cached license data"
            );
            this.emit("validation:auth-failed", {
              licenseKey: cachedLicense.license_key,
              error: err,
              cached: true,
            });
          }
        });
      }
    }
  }

  /**
   * Activate a license
   * @param {string} licenseKey - The license key to activate
   * @param {import('./types.js').ActivationOptions} [options={}] - Activation options
   * @returns {Promise<import('./types.js').CachedLicense>} Activation result with cached license data
   * @throws {APIError} When the API request fails
   */
  async activate(licenseKey, options = {}) {
    const deviceId = options.deviceIdentifier || generateDeviceId();
    const payload = {
      license_key: licenseKey,
      device_identifier: deviceId,
      metadata: options.metadata || {},
    };

    if (options.softwareReleaseDate) {
      payload.software_release_date = options.softwareReleaseDate;
    }

    try {
      this.emit("activation:start", { licenseKey, deviceId });

      const response = await this.apiCall("/activations/activate", {
        method: "POST",
        body: payload,
      });

      /** @type {import('./types.js').CachedLicense} */
      const licenseData = {
        license_key: licenseKey,
        device_identifier: deviceId,
        activation: response,
        activated_at: new Date().toISOString(),
        last_validated: new Date().toISOString(),
      };

      this.cache.setLicense(licenseData);
      this.cache.updateValidation({ valid: true, optimistic: true });
      this.startAutoValidation(licenseKey);
      this.syncOfflineAssets();
      this.scheduleOfflineRefresh();

      this.emit("activation:success", licenseData);
      return licenseData;
    } catch (error) {
      this.emit("activation:error", { licenseKey, error });
      throw error;
    }
  }

  /**
   * Deactivate the current license
   * @returns {Promise<Object>} Deactivation result from the API
   * @throws {LicenseError} When no active license is found
   * @throws {APIError} When the API request fails
   */
  async deactivate() {
    const cachedLicense = this.cache.getLicense();
    if (!cachedLicense) {
      throw new LicenseError("No active license found", "no_license");
    }

    try {
      this.emit("deactivation:start", cachedLicense);

      const response = await this.apiCall("/activations/deactivate", {
        method: "POST",
        body: {
          license_key: cachedLicense.license_key,
          device_identifier: cachedLicense.device_identifier,
        },
      });

      this.cache.clearLicense();
      this.cache.clearOfflineLicense();
      this.stopAutoValidation();

      this.emit("deactivation:success", response);
      return response;
    } catch (error) {
      this.emit("deactivation:error", { error, license: cachedLicense });
      throw error;
    }
  }

  /**
   * Validate a license
   * @param {string} licenseKey - License key to validate
   * @param {import('./types.js').ValidationOptions} [options={}] - Validation options
   * @returns {Promise<import('./types.js').ValidationResult>} Validation result
   * @throws {APIError} When the API request fails and offline fallback is not available
   */
  async validateLicense(licenseKey, options = {}) {
    try {
      this.emit("validation:start", { licenseKey });

      const rawResponse = await this.apiCall("/licenses/validate", {
        method: "POST",
        body: {
          license_key: licenseKey,
          device_identifier: options.deviceIdentifier || this.cache.getDeviceId(),
          product_slug: options.productSlug,
        },
      });

      // Normalize response: API returns { valid, license: { active_entitlements, ... } }
      // SDK expects flat structure { valid, active_entitlements, ... }
      const response = {
        valid: rawResponse.valid,
        ...(rawResponse.license || {}),
      };

      // Preserve cached entitlements if server response omits them
      const cachedLicense = this.cache.getLicense();
      if (
        (!response.active_entitlements ||
          response.active_entitlements.length === 0) &&
        cachedLicense?.validation?.active_entitlements?.length
      ) {
        response.active_entitlements =
          cachedLicense.validation.active_entitlements;
      }

      if (cachedLicense && cachedLicense.license_key === licenseKey) {
        this.cache.updateValidation(response);
      }

      if (response.valid) {
        this.emit("validation:success", response);
        this.cache.setLastSeenTimestamp(Date.now());
      } else {
        this.emit("validation:failed", response);
        this.stopAutoValidation();
        this.currentAutoLicenseKey = null;
      }

      this.cache.setLastSeenTimestamp(Date.now());
      return response;
    } catch (error) {
      this.emit("validation:error", { licenseKey, error });

      // Check for offline fallback
      const isNetworkFailure =
        (error instanceof TypeError && error.message.includes("fetch")) ||
        (error instanceof APIError && [0, 408].includes(error.status));

      if (this.config.offlineFallbackEnabled && isNetworkFailure) {
        const offlineResult = await this.verifyCachedOffline();

        const cachedLicense = this.cache.getLicense();
        if (cachedLicense && cachedLicense.license_key === licenseKey) {
          this.cache.updateValidation(offlineResult);
        }

        if (offlineResult.valid) {
          this.emit("validation:offline-success", offlineResult);
          return offlineResult;
        } else {
          this.emit("validation:offline-failed", offlineResult);
          this.stopAutoValidation();
          this.currentAutoLicenseKey = null;
        }
      }

      // Persist invalid status
      if (error instanceof APIError && error.data) {
        const cachedLicense = this.cache.getLicense();
        if (cachedLicense && cachedLicense.license_key === licenseKey) {
          this.cache.updateValidation({ valid: false, ...error.data });
        }
        if (![0, 408, 429].includes(error.status)) {
          this.stopAutoValidation();
          this.currentAutoLicenseKey = null;
        }
      }

      throw error;
    }
  }

  /**
   * Check if a specific entitlement is active (detailed version)
   * @param {string} entitlementKey - The entitlement key to check
   * @returns {import('./types.js').EntitlementCheckResult} Entitlement status with details
   */
  checkEntitlement(entitlementKey) {
    const license = this.cache.getLicense();
    if (!license || !license.validation) {
      return { active: false, reason: "no_license" };
    }

    const entitlements = license.validation.active_entitlements || [];
    const entitlement = entitlements.find((e) => e.key === entitlementKey);

    if (!entitlement) {
      return { active: false, reason: "not_found" };
    }

    if (entitlement.expires_at) {
      const expiresAt = new Date(entitlement.expires_at);
      const now = new Date();

      if (expiresAt < now) {
        return {
          active: false,
          reason: "expired",
          expires_at: entitlement.expires_at,
        };
      }
    }

    return { active: true, entitlement };
  }

  /**
   * Check if a specific entitlement is active (simple boolean version)
   * This is a convenience method that returns a simple boolean.
   * Use checkEntitlement() for detailed status information.
   * @param {string} entitlementKey - The entitlement key to check
   * @returns {boolean} True if the entitlement is active, false otherwise
   */
  hasEntitlement(entitlementKey) {
    return this.checkEntitlement(entitlementKey).active;
  }

  /**
   * Get offline license data from the server
   * @returns {Promise<import('./types.js').SignedOfflineLicense>} Signed offline license data
   * @throws {LicenseError} When no active license is found
   * @throws {APIError} When the API request fails
   */
  async getOfflineLicense() {
    const license = this.cache.getLicense();
    if (!license || !license.license_key) {
      const errorMsg =
        "No active license key found in cache to fetch offline license.";
      this.emit("sdk:error", { message: errorMsg });
      throw new LicenseError(errorMsg, "no_license");
    }

    try {
      this.emit("offlineLicense:fetching", { licenseKey: license.license_key });
      const path = `/licenses/${license.license_key}/offline_license`;

      const response = await this.apiCall(path, { method: "POST" });

      this.emit("offlineLicense:fetched", {
        licenseKey: license.license_key,
        data: response,
      });
      return response;
    } catch (error) {
      this.log(
        `Failed to get offline license for ${license.license_key}:`,
        error
      );
      this.emit("offlineLicense:fetchError", {
        licenseKey: license.license_key,
        error: error,
      });
      throw error;
    }
  }

  /**
   * Fetch a public key from the server by key ID
   * @param {string} keyId - The Key ID (kid) for which to fetch the public key
   * @returns {Promise<string>} Base64-encoded public key
   * @throws {Error} When keyId is not provided or the key is not found
   */
  async getPublicKey(keyId) {
    if (!keyId) {
      throw new Error("Key ID is required to fetch a public key.");
    }
    try {
      this.log(`Fetching public key for kid: ${keyId}`);
      const response = await this.apiCall(`/public_keys/${keyId}`, {
        method: "GET",
      });
      if (response && response.public_key_b64) {
        this.log(`Successfully fetched public key for kid: ${keyId}`);
        return response.public_key_b64;
      } else {
        throw new Error(
          `Public key not found or invalid response for kid: ${keyId}`
        );
      }
    } catch (error) {
      this.log(`Failed to fetch public key for kid ${keyId}:`, error);
      throw error;
    }
  }

  /**
   * Verify a signed offline license client-side using Ed25519
   * @param {import('./types.js').SignedOfflineLicense} signedLicenseData - The signed license data
   * @param {string} publicKeyB64 - Base64-encoded public Ed25519 key
   * @returns {Promise<boolean>} True if verification is successful
   * @throws {CryptoError} When crypto library is not available
   * @throws {Error} When inputs are invalid
   */
  async verifyOfflineLicense(signedLicenseData, publicKeyB64) {
    this.log("Attempting to verify offline license client-side.");
    if (
      !signedLicenseData ||
      !signedLicenseData.payload ||
      !signedLicenseData.signature_b64u
    ) {
      throw new Error("Invalid signedLicenseData object provided.");
    }
    if (!publicKeyB64) {
      throw new Error("Public key (Base64 encoded) is required.");
    }

    if (!ed || !ed.verify || !ed.etc.sha512Sync) {
      const err = new CryptoError(
        "noble-ed25519 crypto library not available/configured for offline verification."
      );
      this.emit("sdk:error", { message: err.message });
      throw err;
    }

    try {
      const payloadString = canonicalJsonStringify(signedLicenseData.payload);
      const messageBytes = new TextEncoder().encode(payloadString);
      const publicKeyBytes = base64UrlDecode(publicKeyB64);
      const signatureBytes = base64UrlDecode(signedLicenseData.signature_b64u);

      const isValid = ed.verify(signatureBytes, messageBytes, publicKeyBytes);

      if (isValid) {
        this.log(
          "Offline license signature VERIFIED successfully client-side."
        );
        this.emit("offlineLicense:verified", {
          payload: signedLicenseData.payload,
        });
      } else {
        this.log("Offline license signature INVALID client-side.");
        this.emit("offlineLicense:verificationFailed", {
          payload: signedLicenseData.payload,
        });
      }
      return isValid;
    } catch (error) {
      this.log("Client-side offline license verification error:", error);
      this.emit("sdk:error", {
        message: "Client-side verification failed.",
        error: error,
      });
      throw error;
    }
  }

  /**
   * Get current license status
   * @returns {import('./types.js').LicenseStatus} Current license status
   */
  getStatus() {
    const license = this.cache.getLicense();
    if (!license) {
      return { status: "inactive", message: "No license activated" };
    }

    const validation = license.validation;
    if (!validation) {
      return { status: "pending", message: "License pending validation" };
    }

    if (!validation.valid) {
      if (validation.offline) {
        return {
          status: "offline-invalid",
          message: validation.reason_code || "License invalid (offline)",
        };
      }
      return {
        status: "invalid",
        message: validation.reason || "License invalid",
      };
    }

    if (validation.offline) {
      return {
        status: "offline-valid",
        license: license.license_key,
        device: license.device_identifier,
        activated_at: license.activated_at,
        last_validated: license.last_validated,
        entitlements: validation.active_entitlements || [],
      };
    }

    return {
      status: "active",
      license: license.license_key,
      device: license.device_identifier,
      activated_at: license.activated_at,
      last_validated: license.last_validated,
      entitlements: validation.active_entitlements || [],
    };
  }

  /**
   * Test server authentication
   * Useful for verifying API key/session is valid.
   * @returns {Promise<Object>} Result from the server
   * @throws {ConfigurationError} When API key is not configured
   * @throws {APIError} When authentication fails
   */
  async testAuth() {
    if (!this.config.apiKey) {
      const err = new ConfigurationError("API key is required for auth test");
      this.emit("auth_test:error", { error: err });
      throw err;
    }

    try {
      this.emit("auth_test:start");
      const response = await this.apiCall("/auth_test", { method: "GET" });
      this.emit("auth_test:success", response);
      return response;
    } catch (error) {
      this.emit("auth_test:error", { error });
      throw error;
    }
  }

  /**
   * Clear all data and reset SDK state
   * @returns {void}
   */
  reset() {
    this.stopAutoValidation();
    this.stopConnectivityPolling();
    if (this.offlineRefreshTimer) {
      clearInterval(this.offlineRefreshTimer);
      this.offlineRefreshTimer = null;
    }
    this.cache.clear();
    this.lastOfflineValidation = null;
    this.currentAutoLicenseKey = null;
    this.emit("sdk:reset");
  }

  /**
   * Destroy the SDK instance and release all resources
   * Call this when you no longer need the SDK to prevent memory leaks.
   * After calling destroy(), the SDK instance should not be used.
   * @returns {void}
   */
  destroy() {
    this.destroyed = true;
    this.stopAutoValidation();
    this.stopConnectivityPolling();
    if (this.offlineRefreshTimer) {
      clearInterval(this.offlineRefreshTimer);
      this.offlineRefreshTimer = null;
    }
    this.eventListeners = {};
    this.cache.clear();
    this.lastOfflineValidation = null;
    this.currentAutoLicenseKey = null;
    this.emit("sdk:destroyed");
  }

  // ============================================================
  // Event Handling
  // ============================================================

  /**
   * Subscribe to an event
   * @param {string} event - Event name
   * @param {import('./types.js').EventCallback} callback - Event handler
   * @returns {import('./types.js').EventUnsubscribe} Unsubscribe function
   */
  on(event, callback) {
    if (!this.eventListeners[event]) {
      this.eventListeners[event] = [];
    }
    this.eventListeners[event].push(callback);
    return () => this.off(event, callback);
  }

  /**
   * Unsubscribe from an event
   * @param {string} event - Event name
   * @param {import('./types.js').EventCallback} callback - Event handler to remove
   * @returns {void}
   */
  off(event, callback) {
    if (this.eventListeners[event]) {
      this.eventListeners[event] = this.eventListeners[event].filter(
        (cb) => cb !== callback
      );
    }
  }

  /**
   * Emit an event
   * @param {string} event - Event name
   * @param {*} data - Event data
   * @returns {void}
   * @private
   */
  emit(event, data) {
    this.log(`Event: ${event}`, data);
    if (this.eventListeners[event]) {
      this.eventListeners[event].forEach((callback) => {
        try {
          callback(data);
        } catch (error) {
          console.error(`Error in event listener for ${event}:`, error);
        }
      });
    }
  }

  // ============================================================
  // Auto-Validation & Connectivity
  // ============================================================

  /**
   * Start automatic license validation
   * @param {string} licenseKey - License key to validate
   * @returns {void}
   * @private
   */
  startAutoValidation(licenseKey) {
    this.stopAutoValidation();

    this.currentAutoLicenseKey = licenseKey;
    const validationInterval = this.config.autoValidateInterval;

    const performAndReschedule = () => {
      this.validateLicense(licenseKey).catch((err) => {
        this.log("Auto-validation failed:", err);
        this.emit("validation:auto-failed", { licenseKey, error: err });
      });
      this.emit("autovalidation:cycle", {
        nextRunAt: new Date(Date.now() + validationInterval),
      });
    };

    this.validationTimer = setInterval(performAndReschedule, validationInterval);

    this.emit("autovalidation:cycle", {
      nextRunAt: new Date(Date.now() + validationInterval),
    });
  }

  /**
   * Stop automatic validation
   * @returns {void}
   * @private
   */
  stopAutoValidation() {
    if (this.validationTimer) {
      clearInterval(this.validationTimer);
      this.validationTimer = null;
      this.emit("autovalidation:stopped");
    }
  }

  /**
   * Start connectivity polling (when offline)
   * @returns {void}
   * @private
   */
  startConnectivityPolling() {
    if (this.connectivityTimer) return;

    const heartbeat = async () => {
      try {
        await fetch(`${this.config.apiBaseUrl}/heartbeat`, {
          method: "GET",
          credentials: "omit",
        });

        if (!this.online) {
          this.online = true;
          this.emit("network:online");
          if (this.currentAutoLicenseKey && !this.validationTimer) {
            this.startAutoValidation(this.currentAutoLicenseKey);
          }
          this.syncOfflineAssets();
        }
        this.stopConnectivityPolling();
      } catch (err) {
        // Still offline
      }
    };

    this.connectivityTimer = setInterval(
      heartbeat,
      this.config.networkRecheckInterval
    );
  }

  /**
   * Stop connectivity polling
   * @returns {void}
   * @private
   */
  stopConnectivityPolling() {
    if (this.connectivityTimer) {
      clearInterval(this.connectivityTimer);
      this.connectivityTimer = null;
    }
  }

  // ============================================================
  // Offline License Management
  // ============================================================

  /**
   * Fetch and cache offline license and public key
   * Uses a lock to prevent concurrent calls from causing race conditions
   * @returns {Promise<void>}
   * @private
   */
  async syncOfflineAssets() {
    // Prevent concurrent syncs
    if (this.syncingOfflineAssets || this.destroyed) {
      this.log("Skipping syncOfflineAssets: already syncing or destroyed");
      return;
    }

    this.syncingOfflineAssets = true;
    try {
      const offline = await this.getOfflineLicense();
      this.cache.setOfflineLicense(offline);

      const kid = offline.kid || offline.payload?.kid;
      if (kid) {
        const existingKey = this.cache.getPublicKey(kid);
        if (!existingKey) {
          const pub = await this.getPublicKey(kid);
          this.cache.setPublicKey(kid, pub);
        }
      }

      this.emit("offlineLicense:ready", {
        kid: offline.kid || offline.payload?.kid,
        exp_at: offline.payload?.exp_at,
      });

      // Verify freshly-cached assets
      const res = await this.quickVerifyCachedOfflineLocal();
      if (res) {
        this.cache.updateValidation(res);
        this.emit(
          res.valid ? "validation:offline-success" : "validation:offline-failed",
          res
        );
      }
    } catch (err) {
      this.log("Failed to sync offline assets:", err);
    } finally {
      this.syncingOfflineAssets = false;
    }
  }

  /**
   * Schedule periodic offline license refresh
   * @returns {void}
   * @private
   */
  scheduleOfflineRefresh() {
    if (this.offlineRefreshTimer) clearInterval(this.offlineRefreshTimer);
    this.offlineRefreshTimer = setInterval(
      () => this.syncOfflineAssets(),
      this.config.offlineLicenseRefreshInterval
    );
  }

  /**
   * Verify cached offline license
   * @returns {Promise<import('./types.js').ValidationResult>}
   * @private
   */
  async verifyCachedOffline() {
    const signed = this.cache.getOfflineLicense();
    if (!signed) {
      return { valid: false, offline: true, reason_code: "no_offline_license" };
    }

    const kid = signed.kid || signed.payload?.kid;
    let pub = kid ? this.cache.getPublicKey(kid) : null;
    if (!pub) {
      try {
        pub = await this.getPublicKey(kid);
        this.cache.setPublicKey(kid, pub);
      } catch (e) {
        return { valid: false, offline: true, reason_code: "no_public_key" };
      }
    }

    try {
      const ok = await this.verifyOfflineLicense(signed, pub);
      if (!ok) {
        return { valid: false, offline: true, reason_code: "signature_invalid" };
      }

      /** @type {import('./types.js').OfflineLicensePayload} */
      const payload = signed.payload || {};
      const cached = this.cache.getLicense();

      // License key match
      if (
        !cached ||
        !constantTimeEqual(payload.lic_k || "", cached.license_key || "")
      ) {
        return { valid: false, offline: true, reason_code: "license_mismatch" };
      }

      // Expiry check
      const now = Date.now();
      const expAt = payload.exp_at ? Date.parse(payload.exp_at) : null;
      if (expAt && expAt < now) {
        return { valid: false, offline: true, reason_code: "expired" };
      }

      // Grace period check
      if (!expAt && this.config.maxOfflineDays > 0) {
        const pivot = cached.last_validated || cached.activated_at;
        if (pivot) {
          const ageMs = now - new Date(pivot).getTime();
          if (ageMs > this.config.maxOfflineDays * 24 * 60 * 60 * 1000) {
            return {
              valid: false,
              offline: true,
              reason_code: "grace_period_expired",
            };
          }
        }
      }

      // Clock tamper detection
      const lastSeen = this.cache.getLastSeenTimestamp();
      if (lastSeen && now + this.config.maxClockSkewMs < lastSeen) {
        return { valid: false, offline: true, reason_code: "clock_tamper" };
      }

      this.cache.setLastSeenTimestamp(now);

      const active = parseActiveEntitlements(payload);
      return {
        valid: true,
        offline: true,
        ...(active.length ? { active_entitlements: active } : {}),
      };
    } catch (e) {
      return { valid: false, offline: true, reason_code: "verification_error" };
    }
  }

  /**
   * Quick offline verification using only local data (no network)
   * Performs signature verification plus basic validity checks (expiry, license key match)
   * @returns {Promise<import('./types.js').ValidationResult|null>}
   * @private
   */
  async quickVerifyCachedOfflineLocal() {
    const signed = this.cache.getOfflineLicense();
    if (!signed) return null;
    const kid = signed.kid || signed.payload?.kid;
    const pub = kid ? this.cache.getPublicKey(kid) : null;
    if (!pub) return null;

    try {
      const ok = await this.verifyOfflineLicense(signed, pub);
      if (!ok) {
        return { valid: false, offline: true, reason_code: "signature_invalid" };
      }

      /** @type {import('./types.js').OfflineLicensePayload} */
      const payload = signed.payload || {};
      const cached = this.cache.getLicense();

      // License key match check
      if (
        !cached ||
        !constantTimeEqual(payload.lic_k || "", cached.license_key || "")
      ) {
        return { valid: false, offline: true, reason_code: "license_mismatch" };
      }

      // Expiry check
      const now = Date.now();
      const expAt = payload.exp_at ? Date.parse(payload.exp_at) : null;
      if (expAt && expAt < now) {
        return { valid: false, offline: true, reason_code: "expired" };
      }

      // Clock tamper detection
      const lastSeen = this.cache.getLastSeenTimestamp();
      if (lastSeen && now + this.config.maxClockSkewMs < lastSeen) {
        return { valid: false, offline: true, reason_code: "clock_tamper" };
      }

      const active = parseActiveEntitlements(payload);
      return {
        valid: true,
        offline: true,
        ...(active.length ? { active_entitlements: active } : {}),
      };
    } catch (_) {
      return { valid: false, offline: true, reason_code: "verification_error" };
    }
  }

  // ============================================================
  // API Communication
  // ============================================================

  /**
   * Make an API call with retry logic
   * @param {string} endpoint - API endpoint (will be appended to apiBaseUrl)
   * @param {Object} [options={}] - Fetch options
   * @param {string} [options.method="GET"] - HTTP method
   * @param {Object} [options.body] - Request body (will be JSON-stringified)
   * @param {Object} [options.headers] - Additional headers
   * @returns {Promise<Object>} API response data
   * @throws {APIError} When the request fails after all retries
   * @private
   */
  async apiCall(endpoint, options = {}) {
    const url = `${this.config.apiBaseUrl}${endpoint}`;
    let lastError;

    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...options.headers,
    };

    if (this.config.apiKey) {
      headers["Authorization"] = `Bearer ${this.config.apiKey}`;
    } else {
      this.log(
        "[Warning] No API key configured for LicenseSeat SDK. Authenticated endpoints will fail."
      );
    }

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const response = await fetch(url, {
          method: options.method || "GET",
          headers: headers,
          body: options.body ? JSON.stringify(options.body) : undefined,
          credentials: "omit",
        });

        const data = await response.json();

        if (!response.ok) {
          throw new APIError(
            data.error || "Request failed",
            response.status,
            data
          );
        }

        // Back online
        if (!this.online) {
          this.online = true;
          this.emit("network:online");
        }

        this.stopConnectivityPolling();

        if (!this.validationTimer && this.currentAutoLicenseKey) {
          this.startAutoValidation(this.currentAutoLicenseKey);
        }

        return data;
      } catch (error) {
        const networkFailure =
          (error instanceof TypeError && error.message.includes("fetch")) ||
          (error instanceof APIError && error.status === 0);

        if (networkFailure && this.online) {
          this.online = false;
          this.emit("network:offline", { error });
          this.stopAutoValidation();
          this.startConnectivityPolling();
        }

        lastError = error;

        const shouldRetry =
          attempt < this.config.maxRetries && this.shouldRetryError(error);

        if (shouldRetry) {
          const delay = this.config.retryDelay * Math.pow(2, attempt);
          this.log(
            `Retry attempt ${attempt + 1} after ${delay}ms for error:`,
            error.message
          );
          await sleep(delay);
        } else {
          throw error;
        }
      }
    }

    throw lastError;
  }

  /**
   * Determine if an error should be retried
   * @param {Error} error - The error to check
   * @returns {boolean} True if the error should trigger a retry
   * @private
   */
  shouldRetryError(error) {
    if (error instanceof TypeError && error.message.includes("fetch")) {
      return true;
    }

    if (error instanceof APIError) {
      const status = error.status;

      // Retry on server errors (5xx) except 500 and 501
      if (status >= 502 && status < 600) {
        return true;
      }

      // Retry on network-related errors
      if (status === 0 || status === 408 || status === 429) {
        return true;
      }

      return false;
    }

    return false;
  }

  // ============================================================
  // Utilities
  // ============================================================

  /**
   * Get CSRF token from meta tag
   * @returns {string} CSRF token or empty string
   */
  getCsrfToken() {
    return getCsrfToken();
  }

  /**
   * Log a message (if debug mode is enabled)
   * @param {...*} args - Arguments to log
   * @returns {void}
   * @private
   */
  log(...args) {
    if (this.config.debug) {
      console.log("[LicenseSeat SDK]", ...args);
    }
  }
}

// ============================================================
// Singleton Pattern Support
// ============================================================

/**
 * Shared singleton instance
 * @type {LicenseSeatSDK|null}
 * @private
 */
let sharedInstance = null;

/**
 * Get or create the shared singleton instance
 * @param {import('./types.js').LicenseSeatConfig} [config] - Configuration (only used on first call)
 * @returns {LicenseSeatSDK} The shared instance
 */
export function getSharedInstance(config) {
  if (!sharedInstance) {
    sharedInstance = new LicenseSeatSDK(config);
  }
  return sharedInstance;
}

/**
 * Configure the shared singleton instance
 * @param {import('./types.js').LicenseSeatConfig} config - Configuration options
 * @param {boolean} [force=false] - Force reconfiguration even if already configured
 * @returns {LicenseSeatSDK} The configured shared instance
 */
export function configure(config, force = false) {
  if (sharedInstance && !force) {
    console.warn(
      "[LicenseSeat SDK] Already configured. Call configure with force=true to reconfigure."
    );
    return sharedInstance;
  }
  sharedInstance = new LicenseSeatSDK(config);
  return sharedInstance;
}

/**
 * Reset the shared singleton instance
 * @returns {void}
 */
export function resetSharedInstance() {
  if (sharedInstance) {
    sharedInstance.reset();
    sharedInstance = null;
  }
}
