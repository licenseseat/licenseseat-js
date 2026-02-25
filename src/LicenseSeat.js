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
import { collectTelemetry } from "./telemetry.js";

/**
 * SDK version constant
 * @type {string}
 */
export const SDK_VERSION = "0.4.1";

/**
 * Default configuration values
 * @type {import('./types.js').LicenseSeatConfig}
 */
const DEFAULT_CONFIG = {
  apiBaseUrl: "https://licenseseat.com/api/v1",
  productSlug: null, // Required: Product slug for API calls (e.g., "my-app")
  storagePrefix: "licenseseat_",
  autoValidateInterval: 3600000, // 1 hour
  heartbeatInterval: 300000, // 5 minutes
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
  telemetryEnabled: true, // Set false to disable telemetry (e.g. for GDPR compliance)
  appVersion: null, // User-provided app version, sent as app_version in telemetry
  appBuild: null, // User-provided app build, sent as app_build in telemetry
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
     * Heartbeat timer ID (separate from auto-validation)
     * @type {ReturnType<typeof setInterval>|null}
     * @private
     */
    this.heartbeatTimer = null;

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

      // Start auto-validation and heartbeat if API key is configured
      if (this.config.apiKey) {
        this.startAutoValidation(cachedLicense.license_key);
        this.startHeartbeat();

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
   * @throws {ConfigurationError} When productSlug is not configured
   * @throws {APIError} When the API request fails
   */
  async activate(licenseKey, options = {}) {
    if (!this.config.productSlug) {
      throw new ConfigurationError("productSlug is required for activation");
    }

    const deviceId = options.deviceId || generateDeviceId();
    const payload = {
      device_id: deviceId,
      metadata: options.metadata || {},
    };

    if (options.deviceName) {
      payload.device_name = options.deviceName;
    }

    try {
      this.emit("activation:start", { licenseKey, deviceId });

      // New v1 API: POST /products/{slug}/licenses/{key}/activate
      const response = await this.apiCall(
        `/products/${this.config.productSlug}/licenses/${encodeURIComponent(licenseKey)}/activate`,
        {
          method: "POST",
          body: payload,
        }
      );

      /** @type {import('./types.js').CachedLicense} */
      const licenseData = {
        license_key: licenseKey,
        device_id: deviceId,
        activation: response,
        activated_at: new Date().toISOString(),
        last_validated: new Date().toISOString(),
      };

      this.cache.setLicense(licenseData);
      this.cache.updateValidation({ valid: true, optimistic: true });
      this.startAutoValidation(licenseKey);
      this.startHeartbeat();
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
   * @throws {ConfigurationError} When productSlug is not configured
   * @throws {LicenseError} When no active license is found
   * @throws {APIError} When the API request fails
   */
  async deactivate() {
    if (!this.config.productSlug) {
      throw new ConfigurationError("productSlug is required for deactivation");
    }

    const cachedLicense = this.cache.getLicense();
    if (!cachedLicense) {
      throw new LicenseError("No active license found", "no_license");
    }

    try {
      this.emit("deactivation:start", cachedLicense);

      // New v1 API: POST /products/{slug}/licenses/{key}/deactivate
      const response = await this.apiCall(
        `/products/${this.config.productSlug}/licenses/${encodeURIComponent(cachedLicense.license_key)}/deactivate`,
        {
          method: "POST",
          body: {
            device_id: cachedLicense.device_id,
          },
        }
      );

      this.cache.clearLicense();
      this.cache.clearOfflineToken();
      this.stopAutoValidation();
      this.stopHeartbeat();

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
   * @throws {ConfigurationError} When productSlug is not configured
   * @throws {APIError} When the API request fails and offline fallback is not available
   */
  async validateLicense(licenseKey, options = {}) {
    if (!this.config.productSlug) {
      throw new ConfigurationError("productSlug is required for validation");
    }

    try {
      this.emit("validation:start", { licenseKey });

      // New v1 API: POST /products/{slug}/licenses/{key}/validate
      const rawResponse = await this.apiCall(
        `/products/${this.config.productSlug}/licenses/${encodeURIComponent(licenseKey)}/validate`,
        {
          method: "POST",
          body: {
            device_id: options.deviceId || this.cache.getDeviceId(),
          },
        }
      );

      // Normalize response: API returns { object: "validation_result", valid, license: {...}, activation: {...} }
      // SDK internal structure uses active_entitlements at the top level
      const response = {
        valid: rawResponse.valid,
        code: rawResponse.code,
        message: rawResponse.message,
        warnings: rawResponse.warnings,
        license: rawResponse.license,
        activation: rawResponse.activation,
        // Extract entitlements from license for easy access
        active_entitlements: rawResponse.license?.active_entitlements || [],
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

      // Persist invalid status from error response
      if (error instanceof APIError && error.data) {
        const cachedLicense = this.cache.getLicense();
        if (cachedLicense && cachedLicense.license_key === licenseKey) {
          // Extract code from new error format: { error: { code, message } }
          const errorCode = error.data.error?.code || error.data.code;
          const errorMessage = error.data.error?.message || error.data.message;
          this.cache.updateValidation({
            valid: false,
            code: errorCode,
            message: errorMessage,
          });
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
   * Get offline token data from the server
   * @param {Object} [options={}] - Options for offline token generation
   * @param {string} [options.deviceId] - Device ID to bind the token to (required for hardware_locked mode)
   * @param {number} [options.ttlDays] - Token lifetime in days (default: 30, max: 90)
   * @returns {Promise<import('./types.js').OfflineToken>} Offline token data
   * @throws {ConfigurationError} When productSlug is not configured
   * @throws {LicenseError} When no active license is found
   * @throws {APIError} When the API request fails
   */
  async getOfflineToken(options = {}) {
    if (!this.config.productSlug) {
      throw new ConfigurationError("productSlug is required for offline token");
    }

    const license = this.cache.getLicense();
    if (!license || !license.license_key) {
      const errorMsg =
        "No active license key found in cache to fetch offline token.";
      this.emit("sdk:error", { message: errorMsg });
      throw new LicenseError(errorMsg, "no_license");
    }

    try {
      this.emit("offlineToken:fetching", { licenseKey: license.license_key });

      // Build request body
      const body = {};
      if (options.deviceId) {
        body.device_id = options.deviceId;
      }
      if (options.ttlDays) {
        body.ttl_days = options.ttlDays;
      }

      // New v1 API: POST /products/{slug}/licenses/{key}/offline_token
      const path = `/products/${this.config.productSlug}/licenses/${encodeURIComponent(license.license_key)}/offline_token`;

      const response = await this.apiCall(path, {
        method: "POST",
        body: Object.keys(body).length > 0 ? body : undefined,
      });

      this.emit("offlineToken:fetched", {
        licenseKey: license.license_key,
        data: response,
      });
      return response;
    } catch (error) {
      this.log(
        `Failed to get offline token for ${license.license_key}:`,
        error
      );
      this.emit("offlineToken:fetchError", {
        licenseKey: license.license_key,
        error: error,
      });
      throw error;
    }
  }

  /**
   * Fetch a signing key from the server by key ID
   * @param {string} keyId - The Key ID (kid) for which to fetch the signing key
   * @returns {Promise<import('./types.js').SigningKey>} Signing key data
   * @throws {Error} When keyId is not provided or the key is not found
   */
  async getSigningKey(keyId) {
    if (!keyId) {
      throw new Error("Key ID is required to fetch a signing key.");
    }
    try {
      this.log(`Fetching signing key for kid: ${keyId}`);
      // New v1 API: GET /signing_keys/{key_id}
      const response = await this.apiCall(`/signing_keys/${encodeURIComponent(keyId)}`, {
        method: "GET",
      });
      if (response && response.public_key) {
        this.log(`Successfully fetched signing key for kid: ${keyId}`);
        return response;
      } else {
        throw new Error(
          `Signing key not found or invalid response for kid: ${keyId}`
        );
      }
    } catch (error) {
      this.log(`Failed to fetch signing key for kid ${keyId}:`, error);
      throw error;
    }
  }

  /**
   * Verify a signed offline token client-side using Ed25519
   * @param {import('./types.js').OfflineToken} offlineTokenData - The offline token data
   * @param {string} publicKeyB64 - Base64-encoded public Ed25519 key
   * @returns {Promise<boolean>} True if verification is successful
   * @throws {CryptoError} When crypto library is not available
   * @throws {Error} When inputs are invalid
   */
  async verifyOfflineToken(offlineTokenData, publicKeyB64) {
    this.log("Attempting to verify offline token client-side.");

    if (!offlineTokenData || !offlineTokenData.canonical || !offlineTokenData.signature) {
      throw new Error("Invalid offline token object provided. Expected format: { token, signature, canonical }");
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
      const messageBytes = new TextEncoder().encode(offlineTokenData.canonical);
      const signatureBytes = base64UrlDecode(offlineTokenData.signature.value);
      const publicKeyBytes = base64UrlDecode(publicKeyB64);

      const isValid = ed.verify(signatureBytes, messageBytes, publicKeyBytes);

      if (isValid) {
        this.log("Offline token signature VERIFIED successfully client-side.");
        this.emit("offlineToken:verified", { token: offlineTokenData.token });
      } else {
        this.log("Offline token signature INVALID client-side.");
        this.emit("offlineToken:verificationFailed", { token: offlineTokenData.token });
      }
      return isValid;
    } catch (error) {
      this.log("Client-side offline token verification error:", error);
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
          message: validation.code || "License invalid (offline)",
        };
      }
      return {
        status: "invalid",
        message: validation.message || validation.code || "License invalid",
      };
    }

    if (validation.offline) {
      return {
        status: "offline-valid",
        license: license.license_key,
        device: license.device_id,
        activated_at: license.activated_at,
        last_validated: license.last_validated,
        entitlements: validation.active_entitlements || [],
      };
    }

    return {
      status: "active",
      license: license.license_key,
      device: license.device_id,
      activated_at: license.activated_at,
      last_validated: license.last_validated,
      entitlements: validation.active_entitlements || [],
    };
  }

  /**
   * Test API connectivity
   * Makes a request to the health endpoint to verify connectivity.
   * Note: To fully verify API key validity, attempt an actual operation like activate() or validateLicense().
   * @returns {Promise<{authenticated: boolean, healthy: boolean, api_version: string}>}
   * @throws {ConfigurationError} If API key is not configured
   * @throws {APIError} If the health check fails
   */
  async testAuth() {
    if (!this.config.apiKey) {
      const err = new ConfigurationError("API key is required for auth test");
      this.emit("auth_test:error", { error: err });
      throw err;
    }

    try {
      this.emit("auth_test:start");
      // Use health endpoint to verify API connectivity
      const response = await this.apiCall("/health", { method: "GET" });
      const result = {
        authenticated: true, // API key was included in request
        healthy: response.status === "healthy",
        api_version: response.api_version,
      };
      this.emit("auth_test:success", result);
      return result;
    } catch (error) {
      this.emit("auth_test:error", { error });
      throw error;
    }
  }

  /**
   * Send a heartbeat for the current license.
   * Heartbeats let the server know the device is still active.
   * @returns {Promise<Object|undefined>} Heartbeat response, or undefined if no active license
   * @throws {ConfigurationError} When productSlug is not configured
   * @throws {APIError} When the API request fails
   */
  async heartbeat() {
    if (!this.config.productSlug) {
      throw new ConfigurationError("productSlug is required for heartbeat");
    }

    const cached = this.cache.getLicense();
    if (!cached) {
      this.log("No active license for heartbeat");
      return;
    }

    const body = { device_id: cached.device_id };

    const response = await this.apiCall(
      `/products/${this.config.productSlug}/licenses/${encodeURIComponent(cached.license_key)}/heartbeat`,
      {
        method: "POST",
        body: body,
      }
    );

    this.emit("heartbeat:success", response);
    this.log("Heartbeat sent successfully");
    return response;
  }

  /**
   * Clear all data and reset SDK state
   * @returns {void}
   */
  reset() {
    this.stopAutoValidation();
    this.stopHeartbeat();
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
    this.stopHeartbeat();
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

    // Don't start auto-validation if interval is 0 or negative
    if (!validationInterval || validationInterval <= 0) {
      this.log("Auto-validation disabled (interval:", validationInterval, ")");
      return;
    }

    const performAndReschedule = () => {
      this.validateLicense(licenseKey)
        .then(() => {
          this.heartbeat().catch((err) => this.log("Heartbeat failed:", err));
        })
        .catch((err) => {
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
   * Start separate heartbeat timer
   * Sends periodic heartbeats between auto-validation cycles.
   * @returns {void}
   * @private
   */
  startHeartbeat() {
    this.stopHeartbeat();

    const interval = this.config.heartbeatInterval;
    if (!interval || interval <= 0) {
      this.log("Heartbeat timer disabled (interval:", interval, ")");
      return;
    }

    this.heartbeatTimer = setInterval(() => {
      this.heartbeat()
        .then(() => this.emit("heartbeat:cycle", { nextRunAt: new Date(Date.now() + interval) }))
        .catch((err) => this.log("Heartbeat timer failed:", err));
    }, interval);

    this.log("Heartbeat timer started (interval:", interval, "ms)");
  }

  /**
   * Stop the separate heartbeat timer
   * @returns {void}
   * @private
   */
  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Start connectivity polling (when offline)
   * @returns {void}
   * @private
   */
  startConnectivityPolling() {
    if (this.connectivityTimer) return;

    const healthCheck = async () => {
      try {
        // New v1 API: GET /health
        const res = await fetch(`${this.config.apiBaseUrl}/health`, {
          method: "GET",
          credentials: "omit",
        });
        // Consume the response body to release the connection
        await res.text().catch(() => {});

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
      healthCheck,
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
   * Download and cache the offline token and its corresponding public signing key.
   * Emits `offlineToken:ready` on success. Safe to call multiple times — concurrent
   * calls are deduplicated automatically.
   * @returns {Promise<void>}
   */
  async syncOfflineAssets() {
    // Prevent concurrent syncs
    if (this.syncingOfflineAssets || this.destroyed) {
      this.log("Skipping syncOfflineAssets: already syncing or destroyed");
      return;
    }

    this.syncingOfflineAssets = true;
    try {
      const offline = await this.getOfflineToken();
      this.cache.setOfflineToken(offline);

      const kid = offline.signature?.key_id || offline.token?.kid;
      if (kid) {
        const existingKey = this.cache.getPublicKey(kid);
        if (!existingKey) {
          const signingKey = await this.getSigningKey(kid);
          this.cache.setPublicKey(kid, signingKey.public_key);
        }
      }

      this.emit("offlineToken:ready", {
        kid: kid,
        exp: offline.token?.exp,
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
   * Verify the cached offline token and return a validation result.
   * Use this to validate the license when the device is offline.
   * The offline token must have been previously downloaded via {@link syncOfflineAssets}.
   * @returns {Promise<import('./types.js').ValidationResult>}
   */
  async verifyCachedOffline() {
    const signed = this.cache.getOfflineToken();
    if (!signed) {
      return { valid: false, offline: true, code: "no_offline_token" };
    }

    const kid = signed.signature?.key_id || signed.token?.kid;
    let pub = kid ? this.cache.getPublicKey(kid) : null;
    if (!pub) {
      try {
        const signingKey = await this.getSigningKey(kid);
        pub = signingKey.public_key;
        this.cache.setPublicKey(kid, pub);
      } catch (e) {
        return { valid: false, offline: true, code: "no_public_key" };
      }
    }

    try {
      const ok = await this.verifyOfflineToken(signed, pub);
      if (!ok) {
        return { valid: false, offline: true, code: "signature_invalid" };
      }

      const token = signed.token;
      const cached = this.cache.getLicense();

      // License key match
      if (!cached || !constantTimeEqual(token.license_key || "", cached.license_key || "")) {
        return { valid: false, offline: true, code: "license_mismatch" };
      }

      // Expiry check (exp is Unix timestamp in seconds)
      const now = Date.now();
      const expAt = token.exp ? token.exp * 1000 : null;
      if (expAt && expAt < now) {
        return { valid: false, offline: true, code: "expired" };
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
              code: "grace_period_expired",
            };
          }
        }
      }

      // Clock tamper detection
      const lastSeen = this.cache.getLastSeenTimestamp();
      if (lastSeen && now + this.config.maxClockSkewMs < lastSeen) {
        return { valid: false, offline: true, code: "clock_tamper" };
      }

      this.cache.setLastSeenTimestamp(now);

      const active = parseActiveEntitlements(token);
      return {
        valid: true,
        offline: true,
        ...(active.length ? { active_entitlements: active } : {}),
      };
    } catch (e) {
      return { valid: false, offline: true, code: "verification_error" };
    }
  }

  /**
   * Quick offline verification using only local data (no network)
   * Performs signature verification plus basic validity checks (expiry, license key match)
   * @returns {Promise<import('./types.js').ValidationResult|null>}
   * @private
   */
  async quickVerifyCachedOfflineLocal() {
    const signed = this.cache.getOfflineToken();
    if (!signed) return null;

    const kid = signed.signature?.key_id || signed.token?.kid;
    const pub = kid ? this.cache.getPublicKey(kid) : null;
    if (!pub) return null;

    try {
      const ok = await this.verifyOfflineToken(signed, pub);
      if (!ok) {
        return { valid: false, offline: true, code: "signature_invalid" };
      }

      const token = signed.token;
      const cached = this.cache.getLicense();

      // License key match check
      if (!cached || !constantTimeEqual(token.license_key || "", cached.license_key || "")) {
        return { valid: false, offline: true, code: "license_mismatch" };
      }

      // Expiry check (exp is Unix timestamp in seconds)
      const now = Date.now();
      const expAt = token.exp ? token.exp * 1000 : null;
      if (expAt && expAt < now) {
        return { valid: false, offline: true, code: "expired" };
      }

      // Clock tamper detection
      const lastSeen = this.cache.getLastSeenTimestamp();
      if (lastSeen && now + this.config.maxClockSkewMs < lastSeen) {
        return { valid: false, offline: true, code: "clock_tamper" };
      }

      const active = parseActiveEntitlements(token);
      return {
        valid: true,
        offline: true,
        ...(active.length ? { active_entitlements: active } : {}),
      };
    } catch (_) {
      return { valid: false, offline: true, code: "verification_error" };
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

    // Inject telemetry into POST request bodies
    const method = options.method || "GET";
    let body = options.body;
    if (method === "POST" && body && this.config.telemetryEnabled !== false) {
      body = { ...body, telemetry: collectTelemetry(SDK_VERSION, {
        appVersion: this.config.appVersion,
        appBuild: this.config.appBuild,
      }) };
    }

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const response = await fetch(url, {
          method: method,
          headers: headers,
          body: body ? JSON.stringify(body) : undefined,
          credentials: "omit",
        });

        const data = await response.json();

        if (!response.ok) {
          // Handle new error format: { error: { code, message, details } }
          // Also support legacy format: { error: "message", reason_code: "code" }
          const errorObj = data.error;
          let errorMessage = "Request failed";
          if (typeof errorObj === "object" && errorObj !== null) {
            errorMessage = errorObj.message || "Request failed";
          } else if (typeof errorObj === "string") {
            errorMessage = errorObj;
          }
          throw new APIError(errorMessage, response.status, data);
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
