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
 */

import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import CJSON from "canonical-json";

class LicenseSeatSDK {
  constructor(config = {}) {
    this.config = {
      apiBaseUrl: config.apiBaseUrl || "/api",
      storagePrefix: config.storagePrefix || "licenseseat_",
      autoValidateInterval: config.autoValidateInterval || 3600000, // 1 hour default
      networkRecheckInterval: config.networkRecheckInterval || 30000, // 30s while offline
      maxRetries: config.maxRetries || 3,
      retryDelay: config.retryDelay || 1000,
      apiKey: config.apiKey || null, // Store apiKey
      debug: config.debug || false,
      offlineLicenseRefreshInterval:
        config.offlineLicenseRefreshInterval || 1000 * 60 * 60 * 72, // 72h
      offlineFallbackEnabled: config.offlineFallbackEnabled !== false, // default true
      maxOfflineDays: config.maxOfflineDays || 0, // 0 = disabled
      maxClockSkewMs: config.maxClockSkewMs || 5 * 60 * 1000, // 5 minutes
      ...config,
    };

    this.eventListeners = {};
    this.validationTimer = null;
    this.cache = new LicenseCache(this.config.storagePrefix);
    this.online = true; // assume online until proven otherwise
    this.currentAutoLicenseKey = null;
    this.connectivityTimer = null; // polls heartbeat while offline
    this.offlineRefreshTimer = null;

    // Track the most recent offline validation result to avoid duplicate emits
    this.lastOfflineValidation = null;

    // Enable synchronous SHA512 for noble-ed25519
    if (ed && ed.etc && sha512) {
      ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));
    } else {
      console.error(
        "[LicenseSeat SDK] Noble-ed25519 or Noble-hashes not loaded correctly. Sync crypto methods may fail."
      );
    }

    // Initialize on construction
    this.initialize();
  }

  initialize() {
    this.log("LicenseSeat SDK initialized", this.config);

    // Check for cached license on init
    const cachedLicense = this.cache.getLicense();
    if (cachedLicense) {
      this.emit("license:loaded", cachedLicense);

      // 1. Try an immediate **local** offline verification (no network) for instant UX
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

              // Remember to suppress duplicate emissions later
              this.lastOfflineValidation = offlineResult;
            }
          })
          .catch(() => {}); // silently ignore
      }

      // Only start auto-validation automatically if we have an API key to reach the server.
      if (this.config.apiKey) {
        this.startAutoValidation(cachedLicense.license_key);
      }

      // Validate cached license in background (don't block UI) if we have API key
      if (this.config.apiKey) {
        this.validateLicense(cachedLicense.license_key).catch((err) => {
          this.log("Background validation failed:", err);

          // If validation fails due to auth issues, we can still use cached data
          // The license remains in "pending validation" state but is usable
          if (
            err instanceof APIError &&
            (err.status === 401 || err.status === 501)
          ) {
            this.log(
              "Authentication issue during validation, using cached license data"
            );
            // Emit an event so UI can show appropriate message
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
   * @param {Object} options - Activation options
   * @param {string} [options.deviceIdentifier] - Optional custom device ID.
   * @param {string} [options.softwareReleaseDate] - Optional ISO8601 date string for version-aware activation.
   * @param {Object} [options.metadata] - Optional metadata.
   * @returns {Promise<Object>} Activation result
   */
  async activate(licenseKey, options = {}) {
    const deviceId = options.deviceIdentifier || this.generateDeviceId();
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

      // Cache the activated license
      const licenseData = {
        license_key: licenseKey,
        device_identifier: deviceId,
        activation: response,
        activated_at: new Date().toISOString(),
        last_validated: new Date().toISOString(),
      };

      this.cache.setLicense(licenseData);

      // Optimistic validation record so UI shows Active immediately.
      this.cache.updateValidation({ valid: true, optimistic: true });

      // Start auto-validation
      this.startAutoValidation(licenseKey);

      // Fetch offline assets in background
      this.syncOfflineAssets();

      // Schedule periodic refresh
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
   * @returns {Promise<Object>} Deactivation result
   */
  async deactivate() {
    const cachedLicense = this.cache.getLicense();
    if (!cachedLicense) {
      throw new Error("No active license found");
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

      // Clear cache and stop validation
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
   * @param {Object} options - Validation options
   * @returns {Promise<Object>} Validation result
   */
  async validateLicense(licenseKey, options = {}) {
    try {
      this.emit("validation:start", { licenseKey });

      const response = await this.apiCall("/licenses/validate", {
        method: "POST",
        body: {
          license_key: licenseKey,
          device_identifier:
            options.deviceIdentifier || this.cache.getDeviceId(),
          product_slug: options.productSlug,
        },
      });

      // Always update cache with latest validation, regardless of validity
      const cachedLicense = this.cache.getLicense();
      if (cachedLicense && cachedLicense.license_key === licenseKey) {
        this.cache.updateValidation(response);
      }

      if (response.valid) {
        this.emit("validation:success", response);
        // Record trustworthy server time baseline to detect clock tampering
        this.cache.setLastSeenTimestamp(Date.now());
      } else {
        this.emit("validation:failed", response);
        // Invalidate client – stop further auto checks until user intervenes.
        this.stopAutoValidation();
        this.currentAutoLicenseKey = null;
      }

      // Determine if we can fall back to offline check
      const isNetworkFailure =
        (response instanceof TypeError && response.message.includes("fetch")) ||
        (response instanceof APIError &&
          [0, 408].includes(response.status)); /* 0 = network fail */

      if (this.config.offlineFallbackEnabled && isNetworkFailure) {
        const offlineResult = await this.verifyCachedOffline();

        // Suppress duplicate success emission if we already emitted the same state on init
        const duplicateSuccess =
          offlineResult.valid && this.lastOfflineValidation?.valid === true;

        // Update cache regardless
        const cachedLicense = this.cache.getLicense();
        if (cachedLicense && cachedLicense.license_key === licenseKey) {
          this.cache.updateValidation(offlineResult);
        }

        if (offlineResult.valid) {
          if (!duplicateSuccess) {
            this.emit("validation:offline-success", offlineResult);
          }
          this.lastOfflineValidation = offlineResult;
          return offlineResult;
        } else {
          this.emit("validation:offline-failed", offlineResult);
          // offline result invalid → stop auto validation as well
          this.stopAutoValidation();
          this.currentAutoLicenseKey = null;
        }
      }

      // Persist invalid status so UI reflects latest server response when API responded with JSON error
      if (response instanceof APIError && response.data) {
        const cachedLicense = this.cache.getLicense();
        if (cachedLicense && cachedLicense.license_key === licenseKey) {
          const invalidValidation = {
            valid: false,
            ...response.data,
          };
          this.cache.updateValidation(invalidValidation);
        }
      }

      // When we regain connectivity also update lastSeenTimestamp
      this.cache.setLastSeenTimestamp(Date.now());

      return response;
    } catch (error) {
      this.emit("validation:error", { licenseKey, error });

      // Determine if we can fall back to offline check
      const isNetworkFailure =
        (error instanceof TypeError && error.message.includes("fetch")) ||
        (error instanceof APIError &&
          [0, 408].includes(error.status)); /* 0 = network fail */

      if (this.config.offlineFallbackEnabled && isNetworkFailure) {
        const offlineResult = await this.verifyCachedOffline();

        // Update cache regardless
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

      // Persist invalid status so UI reflects latest server response when API responded with JSON error
      if (error instanceof APIError && error.data) {
        const cachedLicense = this.cache.getLicense();
        if (cachedLicense && cachedLicense.license_key === licenseKey) {
          const invalidValidation = {
            valid: false,
            ...error.data,
          };
          this.cache.updateValidation(invalidValidation);
        }
        // If it's a client-side auth/license error (not transient) stop auto-validation.
        if (![0, 408, 429].includes(error.status)) {
          this.stopAutoValidation();
          this.currentAutoLicenseKey = null;
        }
      }

      throw error;
    }
  }

  /**
   * Check if a specific entitlement is active
   * @param {string} entitlementKey - The entitlement to check
   * @returns {Object} Entitlement status
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
   * Get offline license data for backup.
   * This fetches the *signed* offline license data from the server.
   * @returns {Promise<Object>} Signed offline license data (JSON structure with payload and signature).
   */
  async getOfflineLicense() {
    const license = this.cache.getLicense();
    if (!license || !license.license_key) {
      const errorMsg =
        "No active license key found in cache to fetch offline license.";
      this.emit("sdk:error", { message: errorMsg });
      throw new Error(errorMsg);
    }

    try {
      this.emit("offlineLicense:fetching", { licenseKey: license.license_key });
      const path = `/licenses/${license.license_key}/offline_license`;

      const response = await this.apiCall(path, {
        method: "POST",
      });

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
   * Fetches a public key for a given key ID (kid) from the server.
   * Assumes an endpoint like /api/public_key/:keyId which returns { key_id: "...", public_key_b64: "..." }
   * @param {string} keyId - The Key ID (kid) for which to fetch the public key.
   * @returns {Promise<string>} Base64 encoded public key.
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
   * Verifies a signed offline license object client-side.
   * IMPORTANT: This method requires a JavaScript Ed25519 library (e.g., tweetnacl, noble-ed25519).
   * The actual crypto verification logic needs to be implemented using such a library.
   *
   * @param {Object} signedLicenseData - The signed license data object, typically { payload: Object, signature_b64u: string, kid: string }.
   * @param {string} publicKeyB64 - The Base64 encoded public Ed25519 key to verify the signature.
   * @returns {Promise<boolean>} True if verification is successful, false otherwise.
   * @throws {Error} if crypto library is not available or inputs are invalid.
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

    // --- Ed25519 Library Integration Point (using noble-ed25519) ---
    if (!ed || !ed.verify || !ed.etc.sha512Sync) {
      console.error(
        "Noble-ed25519 not properly initialized or sha512Sync not set. Please check imports and setup."
      );
      this.emit("sdk:error", {
        message:
          "Client-side verification crypto library (noble-ed25519) not available or configured.",
      });
      throw new Error(
        "noble-ed25519 crypto library not available/configured for offline verification."
      );
    }

    try {
      const payloadString = this.canonicalJsonStringify(
        signedLicenseData.payload
      );
      const messageBytes = new TextEncoder().encode(payloadString);

      // Decode public key from Base64
      const publicKeyBytes = this.base64UrlDecode(publicKeyB64); // Assuming public key is standard base64, or adjust if base64url

      // Decode signature from Base64URL
      const signatureBytes = this.base64UrlDecode(
        signedLicenseData.signature_b64u
      );

      // Verify (using noble-ed25519 synchronous verify)
      const isValid = ed.verify(
        signatureBytes, // signature first for noble-ed25519
        messageBytes,
        publicKeyBytes
      );

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
   * Generates a canonical JSON string from an object (keys sorted).
   * This is crucial for consistent signature verification.
   * @param {Object} obj - The object to stringify.
   * @returns {string} Canonical JSON string.
   */
  canonicalJsonStringify(obj) {
    // Using canonical-json pinned via importmap
    if (!CJSON || typeof CJSON.stringify !== "function") {
      console.warn(
        "[LicenseSeat SDK] canonical-json library not loaded correctly. Falling back to basic JSON.stringify. Signature verification might be unreliable if server uses different canonicalization."
      );
      // Basic fallback (keys might not be sorted in nested objects, less reliable for crypto)
      // For truly robust canonicalization without a library, a more complex recursive sort is needed.
      try {
        // Attempt to sort keys at the top level as a minimal measure
        const sortedObj = {};
        Object.keys(obj)
          .sort()
          .forEach((key) => {
            sortedObj[key] = obj[key];
          });
        return JSON.stringify(sortedObj);
      } catch (e) {
        return JSON.stringify(obj); // Absolute fallback
      }
    }
    return CJSON.stringify(obj);
  }

  /**
   * Decodes a Base64URL string to a Uint8Array.
   * @param {string} base64UrlString - The Base64URL encoded string.
   * @returns {Uint8Array}
   */
  base64UrlDecode(base64UrlString) {
    let base64 = base64UrlString.replace(/-/g, "+").replace(/_/g, "/");
    // Pad with '=' characters if necessary
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
   * Start automatic license validation
   * @private
   */
  startAutoValidation(licenseKey) {
    this.stopAutoValidation();

    this.currentAutoLicenseKey = licenseKey; // Remember for resume after offline
    const validationInterval = this.config.autoValidateInterval;

    const performAndReschedule = () => {
      this.validateLicense(licenseKey).catch((err) => {
        this.log("Auto-validation failed:", err);
        this.emit("validation:auto-failed", { licenseKey, error: err });
      });
      // Announce the next scheduled run
      this.emit("autovalidation:cycle", {
        nextRunAt: new Date(Date.now() + validationInterval),
      });
    };

    this.validationTimer = setInterval(
      performAndReschedule,
      validationInterval
    );

    // Announce the first upcoming run
    this.emit("autovalidation:cycle", {
      nextRunAt: new Date(Date.now() + validationInterval),
    });
  }

  /**
   * Stop automatic validation
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
   * Generate a unique device identifier
   * @private
   */
  generateDeviceId() {
    // In production, use more sophisticated fingerprinting
    const nav = window.navigator;
    const screen = window.screen;
    const data = [
      nav.userAgent,
      nav.language,
      screen.colorDepth,
      screen.width + "x" + screen.height,
      new Date().getTimezoneOffset(),
      nav.hardwareConcurrency,
      this.getCanvasFingerprint(),
    ].join("|");

    return `web-${this.hashCode(data)}-${Date.now().toString(36)}`;
  }

  /**
   * Get canvas fingerprint for device ID
   * @private
   */
  getCanvasFingerprint() {
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
   * Simple hash function
   * @private
   */
  hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Make API call with retry logic
   * @private
   */
  async apiCall(endpoint, options = {}) {
    const url = `${this.config.apiBaseUrl}${endpoint}`;
    let lastError;

    // Prepare headers
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...options.headers,
    };

    if (this.config.apiKey) {
      headers["Authorization"] = `Bearer ${this.config.apiKey}`;
    } else {
      // Warn the developer when no API key is set. Certain endpoints will fail.
      this.log(
        "[Warning] No API key configured for LicenseSeat SDK. Authenticated endpoints will fail."
      );
    }

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const response = await fetch(url, {
          method: options.method || "GET",
          headers: headers, // Use prepared headers
          body: options.body ? JSON.stringify(options.body) : undefined,
          credentials: "omit", // Do NOT send cookies (session-agnostic)
        });

        const data = await response.json();

        if (!response.ok) {
          throw new APIError(
            data.error || "Request failed",
            response.status,
            data
          );
        }

        // If we reach here, the request succeeded. If we previously marked
        // ourselves offline, flip back to online and notify listeners.
        if (!this.online) {
          this.online = true;
          this.emit("network:online");
        }

        // Restart auto-validation timer if it was stopped while offline
        this.stopConnectivityPolling();

        if (!this.validationTimer && this.currentAutoLicenseKey) {
          this.startAutoValidation(this.currentAutoLicenseKey);
        }

        return data;
      } catch (error) {
        // Detect network failure (TypeError from fetch) or response status 0
        const networkFailure =
          (error instanceof TypeError && error.message.includes("fetch")) ||
          (error instanceof APIError && error.status === 0);

        if (networkFailure && this.online) {
          this.online = false;
          this.emit("network:offline", { error });

          // Pause automatic validation to avoid hammering network
          this.stopAutoValidation();

          // Start connectivity polling
          this.startConnectivityPolling();
        }

        lastError = error;

        // Determine if we should retry
        const shouldRetry =
          attempt < this.config.maxRetries && this.shouldRetryError(error);

        if (shouldRetry) {
          const delay = this.config.retryDelay * Math.pow(2, attempt);
          this.log(
            `Retry attempt ${attempt + 1} after ${delay}ms for error:`,
            error.message
          );
          await this.sleep(delay);
        } else {
          // Don't retry - throw the error immediately
          throw error;
        }
      }
    }

    throw lastError;
  }

  /**
   * Determine if an error should be retried
   * @private
   */
  shouldRetryError(error) {
    // Network errors (fetch failed)
    if (error instanceof TypeError && error.message.includes("fetch")) {
      return true;
    }

    // API errors
    if (error instanceof APIError) {
      const status = error.status;

      // Retry only on true server errors (5xx)
      // Specifically exclude 501 Not Implemented
      if (status >= 502 && status < 600) {
        return true;
      }

      // Retry on specific network-related errors
      if (status === 0 || status === 408 || status === 429) {
        // 0 = network failure
        // 408 = Request Timeout
        // 429 = Too Many Requests (rate limiting)
        return true;
      }

      // Don't retry on:
      // - Client errors (4xx)
      // - 500 Internal Server Error
      // - 501 Not Implemented
      return false;
    }

    // Unknown errors - don't retry by default
    return false;
  }

  /**
   * Event handling
   */
  on(event, callback) {
    if (!this.eventListeners[event]) {
      this.eventListeners[event] = [];
    }
    this.eventListeners[event].push(callback);
    return () => this.off(event, callback);
  }

  off(event, callback) {
    if (this.eventListeners[event]) {
      this.eventListeners[event] = this.eventListeners[event].filter(
        (cb) => cb !== callback
      );
    }
  }

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

  /**
   * Utilities
   */
  getCsrfToken() {
    const token = document.querySelector('meta[name="csrf-token"]');
    return token ? token.content : "";
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  log(...args) {
    if (this.config.debug) {
      console.log("[LicenseSeat SDK]", ...args);
    }
  }

  /**
   * Test server authentication by calling a simple endpoint that requires auth.
   * Useful for verifying API key/session is valid.
   * @returns {Promise<Object>} Result from the server
   */
  async testAuth() {
    if (!this.config.apiKey) {
      const err = new Error("API key is required for auth test");
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
   * Get current license status
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
   * Clear all data and reset
   */
  reset() {
    this.stopAutoValidation();
    this.cache.clear();
    this.lastOfflineValidation = null;
    this.emit("sdk:reset");
  }

  startConnectivityPolling() {
    if (this.connectivityTimer) return;

    const heartbeat = async () => {
      try {
        await fetch(`${this.config.apiBaseUrl}/heartbeat`, {
          method: "GET",
          credentials: "omit",
        });
        // Success! assume back online
        if (!this.online) {
          this.online = true;
          this.emit("network:online");
          if (this.currentAutoLicenseKey && !this.validationTimer) {
            this.startAutoValidation(this.currentAutoLicenseKey);
          }
          // When we regain connectivity we resync offline assets in case they changed
          this.syncOfflineAssets();
        }
        this.stopConnectivityPolling();
      } catch (err) {
        // still offline – wait for next tick
      }
    };

    this.connectivityTimer = setInterval(
      heartbeat,
      this.config.networkRecheckInterval
    );
  }

  stopConnectivityPolling() {
    if (this.connectivityTimer) {
      clearInterval(this.connectivityTimer);
      this.connectivityTimer = null;
    }
  }

  /**
   * Fetch & cache offline license + public key so we can verify while offline.
   * Runs in background; errors are logged but not thrown.
   * @private
   */
  async syncOfflineAssets() {
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
    } catch (err) {
      this.log("Failed to sync offline assets:", err);
    }
  }

  /**
   * Verify cached offline license & return synthetic validation object.
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
        return {
          valid: false,
          offline: true,
          reason_code: "signature_invalid",
        };
      }

      // --- Payload sanity checks ---
      const payload = signed.payload || {};
      const cached = this.cache.getLicense();

      // 1. License key match
      if (
        !cached ||
        !LicenseSeatSDK.constantTimeEqual(
          payload.lic_k || "",
          cached.license_key || ""
        )
      ) {
        return { valid: false, offline: true, reason_code: "license_mismatch" };
      }

      // 2. Expiry or grace-period
      const now = Date.now();
      const expAt = payload.exp_at ? Date.parse(payload.exp_at) : null;
      if (expAt && expAt < now) {
        return { valid: false, offline: true, reason_code: "expired" };
      }

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

      // --- Clock tamper detection ---
      const lastSeen = this.cache.getLastSeenTimestamp();
      if (lastSeen && now + this.config.maxClockSkewMs < lastSeen) {
        return { valid: false, offline: true, reason_code: "clock_tamper" };
      }

      // If offline-valid, but clock was ahead (now > lastSeen), update lastSeen baseline so we don't oscillate.
      this.cache.setLastSeenTimestamp(now);

      return { valid: true, offline: true };
    } catch (e) {
      return { valid: false, offline: true, reason_code: "verification_error" };
    }
  }

  scheduleOfflineRefresh() {
    if (this.offlineRefreshTimer) clearInterval(this.offlineRefreshTimer);
    this.offlineRefreshTimer = setInterval(
      () => this.syncOfflineAssets(),
      this.config.offlineLicenseRefreshInterval
    );
  }

  // --- Utility: constant-time string comparison to mitigate timing attacks ---
  static constantTimeEqual(a = "", b = "") {
    if (a.length !== b.length) return false;
    let res = 0;
    for (let i = 0; i < a.length; i++) {
      res |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return res === 0;
  }

  /**
   * Attempt to verify cached offline license using only local data (no network).
   * Returns validation-like object or null if not possible.
   * @private
   */
  async quickVerifyCachedOfflineLocal() {
    const signed = this.cache.getOfflineLicense();
    if (!signed) return null;
    const kid = signed.kid || signed.payload?.kid;
    const pub = kid ? this.cache.getPublicKey(kid) : null;
    if (!pub) return null; // Can't verify locally without public key

    try {
      const ok = await this.verifyOfflineLicense(signed, pub);
      return ok
        ? { valid: true, offline: true }
        : { valid: false, offline: true, reason_code: "signature_invalid" };
    } catch (_) {
      return { valid: false, offline: true, reason_code: "verification_error" };
    }
  }
}

/**
 * License Cache Manager
 */
class LicenseCache {
  constructor(prefix = "licenseseat_") {
    this.prefix = prefix;
    this.publicKeyCacheKey = this.prefix + "public_keys";
  }

  getLicense() {
    try {
      const data = localStorage.getItem(this.prefix + "license");
      return data ? JSON.parse(data) : null;
    } catch (e) {
      console.error("Failed to read license cache:", e);
      return null;
    }
  }

  setLicense(data) {
    try {
      localStorage.setItem(this.prefix + "license", JSON.stringify(data));
    } catch (e) {
      console.error("Failed to cache license:", e);
    }
  }

  updateValidation(validationData) {
    const license = this.getLicense();
    if (license) {
      license.validation = validationData;
      license.last_validated = new Date().toISOString();
      this.setLicense(license);
    }
  }

  getDeviceId() {
    const license = this.getLicense();
    return license ? license.device_identifier : null;
  }

  clearLicense() {
    localStorage.removeItem(this.prefix + "license");
  }

  // --- Offline license helpers ---
  getOfflineLicense() {
    try {
      const data = localStorage.getItem(this.prefix + "offline_license");
      return data ? JSON.parse(data) : null;
    } catch (e) {
      console.error("Failed to read offline license cache:", e);
      return null;
    }
  }

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

  clearOfflineLicense() {
    localStorage.removeItem(this.prefix + "offline_license");
  }

  // Methods for caching public keys
  getPublicKey(keyId) {
    try {
      const cache = JSON.parse(
        localStorage.getItem(this.publicKeyCacheKey) || "{}"
      );
      return cache[keyId] || null; // Returns Base64 encoded key
    } catch (e) {
      console.error("Failed to read public key cache:", e);
      return null;
    }
  }

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

  // Clears *all* LicenseSeat SDK data for this prefix.
  clear() {
    Object.keys(localStorage).forEach((key) => {
      if (key.startsWith(this.prefix)) {
        localStorage.removeItem(key);
      }
    });
    this.clearOfflineLicense();
    localStorage.removeItem(this.prefix + "last_seen_ts");
  }

  // --- Time baseline helpers ---
  getLastSeenTimestamp() {
    const v = localStorage.getItem(this.prefix + "last_seen_ts");
    return v ? parseInt(v, 10) : null;
  }

  setLastSeenTimestamp(ts) {
    try {
      localStorage.setItem(this.prefix + "last_seen_ts", String(ts));
    } catch (e) {}
  }
}

/**
 * Custom API Error
 */
class APIError extends Error {
  constructor(message, status, data) {
    super(message);
    this.name = "APIError";
    this.status = status;
    this.data = data;
  }
}

// Export for use
export default LicenseSeatSDK;
