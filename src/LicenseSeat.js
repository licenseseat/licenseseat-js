/**
 * LicenseSeat JavaScript SDK
 *
 * A comprehensive client-side SDK for managing software licenses
 * with the LicenseSeat licensing system.
 *
 * Features:
 * - License activation and deactivation
 * - Bounded local caching for identity and signed offline material
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
  constantTimeEqual,
  base64UrlDecode,
  generateDeviceId,
  sleep,
  getCsrfToken,
} from "./utils.js";
import {
  collectBrowserHighEntropyTelemetry,
  collectTelemetry,
} from "./telemetry.js";
import {
  cloneBoundedJson,
  isRecord,
  normalizeConfig,
  parseApiJson,
  readBoundedResponseText,
  redactForLog,
  requireFingerprint,
  requireKeyId,
  requireLicenseKey,
  requireProductSlug,
  requireSafeText,
  validateActivationResponse,
  validateDeactivationResponse,
  validateHeartbeatResponse,
  validateOfflineClaims,
  validateOfflineEnvelope,
  validateSigningKeyResponse,
  validateValidationResponse,
} from "./security.js";

/**
 * SDK version constant
 * @type {string}
 */
export const SDK_VERSION = "0.5.0";

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
  browserHighEntropyTelemetryEnabled: false, // Explicit opt-in for UA Client Hints
  appVersion: null, // User-provided app version, sent as app_version in telemetry
  appBuild: null, // User-provided app build, sent as app_build in telemetry
  requestTimeoutMs: 15000,
  maxResponseBytes: 1024 * 1024,
  allowInsecureHttp: false,
  signingPublicKeys: Object.freeze({}),
};

function fingerprintPayload(fingerprint) {
  return {
    fingerprint,
    device_id: fingerprint,
    device_fingerprint: fingerprint,
  };
}

function equalPublicKeys(left, right) {
  try {
    const a = base64UrlDecode(left, { expectedBytes: 32, maxBytes: 32 });
    const b = base64UrlDecode(right, { expectedBytes: 32, maxBytes: 32 });
    let difference = 0;
    for (let index = 0; index < a.length; index += 1) {
      difference |= a[index] ^ b[index];
    }
    return difference === 0;
  } catch (_) {
    return false;
  }
}

function apiErrorCode(data) {
  if (!isRecord(data)) return null;
  const nested = isRecord(data.error) ? data.error.code : undefined;
  const candidate = nested ?? data.code ?? data.reason_code;
  return typeof candidate === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(candidate)
    ? candidate
    : null;
}

/**
 * Server verdicts that the license does not cover this use. Not revocations (the
 * signed grant is kept), but no offline grant may override them until an online
 * validation succeeds again. Same set as licenseseat-swift's
 * APIError.isAuthoritativeDenial.
 */
const AUTHORITATIVE_DENIAL_CODES = new Set([
  "version_not_entitled",
  "not_entitled",
  "product_mismatch",
  "floating_not_implemented",
  "named_user_not_implemented",
]);

function isAuthoritativeDenialCode(code) {
  return typeof code === "string" && AUTHORITATIVE_DENIAL_CODES.has(code.toLowerCase());
}

function safeErrorMessage(value, fallback = "Request failed") {
  if (typeof value !== "string" || value.length === 0) return fallback;
  return new TextDecoder().decode(new TextEncoder().encode(value))
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .slice(0, 2048);
}

function normalizeOperationOptions(value, allowed, name) {
  let cloned;
  try {
    cloned = cloneBoundedJson(value);
  } catch (error) {
    throw new TypeError(
      error instanceof Error ? `${name} are invalid: ${error.message}` : `${name} are invalid`
    );
  }
  if (!isRecord(cloned)) throw new TypeError(`${name} must be an object`);
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(cloned).find((key) => !allowedSet.has(key));
  if (unknown) throw new TypeError(`Unknown ${name.toLowerCase()} field: ${unknown}`);
  return cloned;
}

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
   * SDK version (static property for easy access)
   * @type {string}
   */
  static VERSION = SDK_VERSION;

  /**
   * Create a new LicenseSeat SDK instance
   * @param {import('./types.js').LicenseSeatConfig} [config={}] - Configuration options
   */
  constructor(config = {}) {
    /**
     * SDK configuration
     * @type {import('./types.js').LicenseSeatConfig}
     */
    try {
      this.config = normalizeConfig(DEFAULT_CONFIG, config);
    } catch (error) {
      throw new ConfigurationError(error instanceof Error ? error.message : "Invalid SDK configuration");
    }

    /**
     * Event listeners map
     * @type {Object<string, import('./types.js').EventCallback[]>}
     * @private
     */
    this.eventListeners = Object.create(null);

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

    /** @type {boolean} */
    this.initialized = false;

    /** @type {number} */
    this.stateGeneration = 0;

    /** @type {import('./types.js').CachedLicense|null} */
    this.currentLicense = null;

    /** @type {import('./types.js').ValidationResult|null} */
    this.trustedValidation = null;

    /** @type {Map<string, string>} */
    this.trustedPublicKeys = new Map(Object.entries(this.config.signingPublicKeys));

    /** @type {Map<string, number>} */
    this.transientSecrets = new Map();

    /** @type {number} */
    this.lastTrustedTimeMs = Date.now();

    /** @type {boolean} */
    this.autoValidationInFlight = false;

    /** @type {boolean} */
    this.heartbeatInFlight = false;

    /** @type {boolean} */
    this.activationInFlight = false;

    /** @type {boolean} */
    this.deactivationInFlight = false;

    /** @type {number} */
    this.validationSequence = 0;

    /** @type {Readonly<Record<string, string>>} */
    this.browserHighEntropyValues = Object.freeze({});

    /** @type {Promise<void>|null} */
    this.browserHighEntropyTelemetryPromise = null;

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
    this.assertUsable();
    if (this.initialized) return;
    this.initialized = true;
    this.log("LicenseSeat SDK initialized", {
      apiBaseUrl: this.config.apiBaseUrl,
      productSlug: this.config.productSlug,
      offlineFallbackEnabled: this.config.offlineFallbackEnabled,
    });
    this.beginBrowserHighEntropyTelemetryCollection();

    const cachedLicense = this.loadCachedIdentity();
    if (cachedLicense) {
      this.currentLicense = cachedLicense;
      this.emit("license:loaded", cachedLicense);

      // Quick offline verification for instant UX
      if (this.config.offlineFallbackEnabled && !this.config.apiKey) {
        this.quickVerifyCachedOfflineLocal()
          .then((offlineResult) => {
            if (offlineResult) {
              if (this.destroyed || this.currentLicense !== cachedLicense) return;
              this.cache.updateValidation(offlineResult);
              this.trustedValidation = offlineResult.valid ? offlineResult : null;
              if (offlineResult.valid) {
                this.recordTrustedTime(Date.now());
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
        // Validate in background
        this.validateLicense(cachedLicense.license_key).catch((err) => {
          this.log("Background validation failed:", err);

          if (
            err instanceof APIError &&
            (err.status === 401 || err.status === 403)
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
   * Start optional UA Client Hint collection without delaying licensing work.
   * Values are never persisted and a rejected/denied browser request is an
   * ordinary empty result.
   * @returns {void}
   * @private
   */
  beginBrowserHighEntropyTelemetryCollection() {
    if (
      this.browserHighEntropyTelemetryPromise ||
      this.config.telemetryEnabled === false ||
      this.config.browserHighEntropyTelemetryEnabled !== true
    ) {
      return;
    }

    this.browserHighEntropyTelemetryPromise = collectBrowserHighEntropyTelemetry()
      .then((values) => {
        if (!this.destroyed) this.browserHighEntropyValues = values;
      })
      .catch(() => {});
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
    this.assertUsable();
    if (!this.config.productSlug) {
      throw new ConfigurationError("productSlug is required for activation");
    }
    this.requireApiKey();
    requireLicenseKey(licenseKey);
    options = normalizeOperationOptions(
      options,
      ["deviceId", "deviceName", "metadata"],
      "Activation options"
    );

    const deviceId = options.deviceId ?? this.getOrCreateDeviceId();
    requireFingerprint(deviceId);
    const metadata = options.metadata ?? {};
    if (!isRecord(metadata)) throw new TypeError("Activation metadata must be an object");
    /** @type {any} */
    const payload = {
      license_key: licenseKey,
      ...fingerprintPayload(deviceId),
      metadata,
    };

    if (options.deviceName !== undefined) {
      payload.device_name = requireSafeText(options.deviceName, "deviceName", {
        min: 1,
        max: 255,
      });
    }

    if (this.activationInFlight) {
      throw new LicenseError("An activation request is already in progress", "operation_in_progress");
    }
    this.activationInFlight = true;
    const generation = this.stateGeneration;
    const releaseSecrets = this.trackSensitiveValues(licenseKey, deviceId);

    try {
      this.emit("activation:start", { licenseKey, deviceId });

      // Keep credentials out of URLs. The server retains legacy URL-key routes,
      // but current SDKs use the body-key route exclusively.
      const response = await this.apiCall(
        this.licenseActionPath("activate"),
        {
          method: "POST",
          body: payload,
          retryable: false,
        }
      );
      const activation = validateActivationResponse(response, {
        licenseKey,
        fingerprint: deviceId,
        productSlug: this.config.productSlug,
      });
      if (this.destroyed || generation !== this.stateGeneration) {
        throw new LicenseError("Activation was superseded by a newer state change", "operation_superseded");
      }
      this.stateGeneration += 1;

      /** @type {import('./types.js').CachedLicense} */
      const licenseData = {
        license_key: licenseKey,
        device_id: deviceId,
        activation,
        activated_at: activation.activated_at,
        last_validated: new Date().toISOString(),
      };

      this.currentLicense = licenseData;
      this.trustedValidation = {
        valid: true,
        license: activation.license,
        active_entitlements: activation.license.active_entitlements,
      };
      this.cache.setLicense(licenseData);
      this.cache.updateValidation(this.trustedValidation);
      this.recordTrustedTime(Date.now());
      this.startAutoValidation(licenseKey);
      this.startHeartbeat();
      if (this.config.offlineFallbackEnabled && this.config.maxOfflineDays > 0) {
        void this.syncOfflineAssets();
        this.scheduleOfflineRefresh();
      }

      this.emit("activation:success", licenseData);
      return licenseData;
    } catch (error) {
      this.emit("activation:error", { licenseKey, error });
      throw error;
    } finally {
      releaseSecrets();
      this.activationInFlight = false;
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
    this.assertUsable();
    if (!this.config.productSlug) {
      throw new ConfigurationError("productSlug is required for deactivation");
    }
    this.requireApiKey();

    const cachedLicense = this.currentLicense || this.loadCachedIdentity();
    if (!cachedLicense) {
      throw new LicenseError("No active license found", "no_license");
    }
    if (this.deactivationInFlight) {
      throw new LicenseError("A deactivation request is already in progress", "operation_in_progress");
    }
    this.deactivationInFlight = true;
    const generation = this.stateGeneration;

    try {
      this.emit("deactivation:start", cachedLicense);

      const rawResponse = await this.apiCall(
        this.licenseActionPath("deactivate"),
        {
          method: "POST",
          body: {
            license_key: cachedLicense.license_key,
            ...fingerprintPayload(cachedLicense.device_id),
          },
          retryable: false,
        }
      );
      const response = validateDeactivationResponse(
        rawResponse,
        cachedLicense.activation?.id
      );
      if (this.destroyed || generation !== this.stateGeneration) {
        throw new LicenseError("Deactivation was superseded by a newer state change", "operation_superseded");
      }

      this.clearLicenseState();

      this.emit("deactivation:success", response);
      return response;
    } catch (error) {
      if (this.isAlreadyGoneError(error) && generation === this.stateGeneration) {
        this.clearLicenseState();
        const response = {
          object: "deactivation",
          activation_id: cachedLicense.activation?.id ?? "unknown",
          deactivated_at: new Date().toISOString(),
        };
        this.emit("deactivation:success", response);
        return response;
      }
      this.emit("deactivation:error", { error, license: cachedLicense });
      throw error;
    } finally {
      this.deactivationInFlight = false;
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
    this.assertUsable();
    if (!this.config.productSlug) {
      throw new ConfigurationError("productSlug is required for validation");
    }
    this.requireApiKey();
    requireLicenseKey(licenseKey);
    options = normalizeOperationOptions(options, ["deviceId"], "Validation options");
    const current = this.currentLicense || this.loadCachedIdentity();
    if (!this.currentLicense && current) this.currentLicense = current;
    const validatesCurrent = Boolean(
      current && constantTimeEqual(current.license_key, licenseKey)
    );
    const fingerprint = options.deviceId ??
      (validatesCurrent ? current.device_id : this.getOrCreateDeviceId());
    requireFingerprint(fingerprint);
    if (
      validatesCurrent &&
      !constantTimeEqual(fingerprint, current.device_id)
    ) {
      throw new LicenseError(
        "Validation device ID does not match the active license",
        "device_mismatch"
      );
    }
    const generation = this.stateGeneration;
    const validationSequence = ++this.validationSequence;
    const releaseSecrets = this.trackSensitiveValues(licenseKey, fingerprint);

    try {
      this.emit("validation:start", { licenseKey });

      const rawResponse = await this.apiCall(
        this.licenseActionPath("validate"),
        {
          method: "POST",
          body: {
            license_key: licenseKey,
            ...fingerprintPayload(fingerprint),
          },
          retryable: true,
        }
      );

      const response = validateValidationResponse(rawResponse, {
        licenseKey,
        fingerprint,
        productSlug: this.config.productSlug,
      });
      const stateIsCurrent =
        validatesCurrent &&
        !this.destroyed &&
        generation === this.stateGeneration &&
        validationSequence === this.validationSequence &&
        this.currentLicense &&
        constantTimeEqual(this.currentLicense.license_key, licenseKey);
      if (validatesCurrent && !stateIsCurrent) {
        throw new LicenseError(
          "Validation was superseded by a newer authorization state",
          "operation_superseded"
        );
      }

      if (stateIsCurrent) {
        this.cache.updateValidation(response);
        this.trustedValidation = response;
      }

      if (response.valid) {
        this.emit("validation:success", response);
        if (stateIsCurrent) {
          this.recordTrustedTime(Date.now());
          if (!this.validationTimer) this.startAutoValidation(licenseKey);
          this.startHeartbeat();
        }
      } else {
        this.emit("validation:failed", response);
        if (stateIsCurrent) this.revokeTrustedAuthorization(false);
      }

      return response;
    } catch (error) {
      this.emit("validation:error", { licenseKey, error });

      const isNetworkFailure = error instanceof APIError && [0, 408].includes(error.status);

      if (this.config.offlineFallbackEnabled && isNetworkFailure && validatesCurrent) {
        const offlineResult = await this.verifyCachedOffline();

        const stateIsCurrent =
          !this.destroyed &&
          generation === this.stateGeneration &&
          validationSequence === this.validationSequence &&
          this.currentLicense &&
          constantTimeEqual(this.currentLicense.license_key, licenseKey);
        if (stateIsCurrent) {
          this.cache.updateValidation(offlineResult);
          this.trustedValidation = offlineResult.valid ? offlineResult : null;
          if (offlineResult.valid) this.recordTrustedTime(Date.now());
        } else {
          throw new LicenseError(
            "Offline validation was superseded by a newer authorization state",
            "operation_superseded"
          );
        }

        if (offlineResult.valid) {
          this.emit("validation:offline-success", offlineResult);
          return offlineResult;
        } else {
          this.emit("validation:offline-failed", offlineResult);
          if (stateIsCurrent) this.revokeTrustedAuthorization(false);
        }
      }

      if (
        validatesCurrent &&
        generation === this.stateGeneration &&
        validationSequence === this.validationSequence &&
        this.currentLicense &&
        constantTimeEqual(this.currentLicense.license_key, licenseKey)
      ) {
        if (error instanceof APIError && error.data) {
          const errorCode = apiErrorCode(error.data) || "api_error";
          const nestedMessage = isRecord(error.data.error)
            ? error.data.error.message
            : undefined;
          const errorMessage = safeErrorMessage(
            nestedMessage ?? error.data.message,
            "Validation failed"
          );
          this.cache.updateValidation({
            valid: false,
            code: errorCode,
            message: errorMessage,
          });
        }
        this.revokeTrustedAuthorization(this.isRevocationError(error));
        if (this.isRevocationError(error)) {
          this.cache.clearOfflineToken();
        }
      }

      throw error;
    } finally {
      releaseSecrets();
    }
  }

  /**
   * Check if a specific entitlement is active (detailed version)
   * @param {string} entitlementKey - The entitlement key to check
   * @returns {import('./types.js').EntitlementCheckResult} Entitlement status with details
   */
  checkEntitlement(entitlementKey) {
    this.assertUsable();
    requireSafeText(entitlementKey, "entitlement key", { min: 1, max: 100 });
    const license = this.currentLicense;
    const validation = this.trustedValidation;
    if (!license || !validation || !validation.valid) {
      return { active: false, reason: "no_license" };
    }

    const entitlements = validation.active_entitlements || [];
    const entitlement = entitlements.find((e) => e.key === entitlementKey);

    if (!entitlement) {
      return { active: false, reason: "not_found" };
    }

    if (entitlement.expires_at) {
      const expiresAt = new Date(entitlement.expires_at);
      const now = new Date();

      if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= now) {
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
    this.assertUsable();
    if (!this.config.productSlug) {
      throw new ConfigurationError("productSlug is required for offline token");
    }
    this.requireApiKey();
    if (!this.config.offlineFallbackEnabled || this.config.maxOfflineDays <= 0) {
      throw new ConfigurationError(
        "Offline validation requires offlineFallbackEnabled and maxOfflineDays greater than zero"
      );
    }

    const license = this.currentLicense;
    if (!license || !license.license_key || !this.trustedValidation?.valid) {
      const errorMsg =
        "A currently validated license is required to fetch an offline token.";
      this.emit("sdk:error", { message: errorMsg });
      throw new LicenseError(errorMsg, "no_license");
    }
    options = normalizeOperationOptions(options, ["deviceId", "ttlDays"], "Offline token options");
    const generation = this.stateGeneration;

    try {
      this.emit("offlineToken:fetching", { licenseKey: license.license_key });

      const fingerprint = options.deviceId ?? license.device_id;
      requireFingerprint(fingerprint);
      if (!constantTimeEqual(fingerprint, license.device_id)) {
        throw new LicenseError(
          "Offline token device ID does not match the active license",
          "device_mismatch"
        );
      }
      /** @type {any} */
      const body = {
        license_key: license.license_key,
        ...fingerprintPayload(fingerprint),
      };
      if (options.ttlDays !== undefined) {
        if (!Number.isSafeInteger(options.ttlDays) || options.ttlDays <= 0 || options.ttlDays > 36_600) {
          throw new TypeError("ttlDays must be a positive integer no greater than 36600");
        }
        body.ttl_days = options.ttlDays;
      }

      const rawResponse = await this.apiCall(this.licenseActionPath("offline-token"), {
        method: "POST",
        body,
        retryable: true,
      });
      const response = validateOfflineEnvelope(rawResponse);
      const publicKey = await this.resolveTrustedSigningKey(response.signature.key_id, true);
      const verified = await this.verifyOfflineToken(response, publicKey);
      if (!verified) throw new CryptoError("Offline token signature is invalid");
      validateOfflineClaims(response, {
        licenseKey: license.license_key,
        productSlug: this.config.productSlug,
        fingerprint,
        nowMs: Date.now(),
        maxClockSkewMs: this.config.maxClockSkewMs,
        maxOfflineDays: this.config.maxOfflineDays,
      });
      if (
        this.destroyed ||
        generation !== this.stateGeneration ||
        !this.trustedValidation?.valid ||
        !this.currentLicense ||
        !constantTimeEqual(this.currentLicense.license_key, license.license_key)
      ) {
        throw new LicenseError(
          "Offline token request was superseded by a newer authorization state",
          "operation_superseded"
        );
      }

      this.emit("offlineToken:fetched", {
        licenseKey: license.license_key,
        keyId: response.signature.key_id,
      });
      return response;
    } catch (error) {
      this.log("Failed to get offline token:", error);
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
    this.assertUsable();
    requireKeyId(keyId);
    try {
      this.log("Fetching signing key");
      const response = await this.apiCall(`/signing_keys/${encodeURIComponent(keyId)}`, {
        method: "GET",
        retryable: true,
        authenticated: false,
      });
      const signingKey = validateSigningKeyResponse(response, keyId);
      const pinned = this.config.signingPublicKeys[keyId];
      if (pinned && !equalPublicKeys(pinned, signingKey.public_key)) {
        throw new CryptoError("Fetched signing key does not match the configured trust anchor");
      }
      const existing = this.trustedPublicKeys.get(keyId);
      if (existing && !equalPublicKeys(existing, signingKey.public_key)) {
        throw new CryptoError("Signing key material changed for an existing key ID");
      }
      this.trustedPublicKeys.set(keyId, signingKey.public_key);
      this.log("Successfully fetched signing key");
      return signingKey;
    } catch (error) {
      this.log("Failed to fetch signing key:", error);
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
    this.assertUsable();
    this.log("Attempting to verify offline token client-side.");
    const envelope = validateOfflineEnvelope(offlineTokenData);
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
      const messageBytes = new TextEncoder().encode(envelope.canonical);
      const signatureBytes = base64UrlDecode(envelope.signature.value, {
        expectedBytes: 64,
        maxBytes: 64,
      });
      const publicKeyBytes = base64UrlDecode(publicKeyB64, {
        expectedBytes: 32,
        maxBytes: 32,
      });

      const isValid = await Promise.resolve(
        ed.verify(signatureBytes, messageBytes, publicKeyBytes, { zip215: false })
      );

      if (isValid) {
        this.log("Offline token signature VERIFIED successfully client-side.");
        this.emit("offlineToken:verified", { keyId: envelope.signature.key_id });
      } else {
        this.log("Offline token signature INVALID client-side.");
        this.emit("offlineToken:verificationFailed", { keyId: envelope.signature.key_id });
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
    this.assertUsable();
    const license = this.currentLicense;
    if (!license) {
      return { status: "inactive", message: "No license activated" };
    }

    const validation = this.trustedValidation;
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
   * Test API authentication and the licenses:validate scope.
   * Uses a protected, side-effect-free endpoint and never treats the public
   * health endpoint as proof that a credential is valid.
   * @returns {Promise<{authenticated: boolean, healthy: boolean, api_version: string}>}
   * @throws {ConfigurationError} If API key is not configured
   * @throws {APIError} If authentication fails or the response is invalid
   */
  async testAuth() {
    this.assertUsable();
    if (!this.config.apiKey) {
      const err = new ConfigurationError("API key is required for auth test");
      this.emit("auth_test:error", { error: err });
      throw err;
    }

    try {
      this.emit("auth_test:start");
      const response = await this.apiCall("/auth", {
        method: "GET",
        authenticated: true,
      });
      if (
        response.object !== "authentication" ||
        response.authenticated !== true ||
        response.scope !== "licenses:validate" ||
        typeof response.api_version !== "string"
      ) {
        throw new APIError("Invalid authentication response", 502, {
          error: {
            code: "invalid_response",
            message: "Invalid authentication response",
          },
        });
      }
      const result = {
        authenticated: true,
        healthy: true,
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
    this.assertUsable();
    if (!this.config.productSlug) {
      throw new ConfigurationError("productSlug is required for heartbeat");
    }

    this.requireApiKey();
    const cached = this.currentLicense;
    if (!cached || !this.trustedValidation?.valid) {
      this.log("No active license for heartbeat");
      return;
    }

    const body = {
      license_key: cached.license_key,
      ...fingerprintPayload(cached.device_id),
    };
    const generation = this.stateGeneration;

    try {
      const rawResponse = await this.apiCall(
        this.licenseActionPath("heartbeat"),
        {
          method: "POST",
          body,
          retryable: true,
        }
      );
      const response = validateHeartbeatResponse(rawResponse, {
        licenseKey: cached.license_key,
        productSlug: this.config.productSlug,
      });
      if (
        generation !== this.stateGeneration ||
        !this.currentLicense ||
        !constantTimeEqual(this.currentLicense.license_key, cached.license_key) ||
        !constantTimeEqual(this.currentLicense.device_id, cached.device_id)
      ) {
        throw new LicenseError("Heartbeat was superseded by a newer state change", "operation_superseded");
      }
      this.emit("heartbeat:success", response);
      this.log("Heartbeat sent successfully");
      return response;
    } catch (error) {
      if (
        generation === this.stateGeneration &&
        this.currentLicense &&
        constantTimeEqual(this.currentLicense.license_key, cached.license_key) &&
        constantTimeEqual(this.currentLicense.device_id, cached.device_id)
      ) {
        this.revokeTrustedAuthorization(this.isRevocationError(error));
      }
      throw error;
    }
  }

  /**
   * Clear all data and reset SDK state
   * @returns {void}
   */
  reset() {
    this.assertUsable();
    this.stateGeneration += 1;
    this.stopAutoValidation();
    this.stopHeartbeat();
    this.stopConnectivityPolling();
    if (this.offlineRefreshTimer) {
      clearInterval(this.offlineRefreshTimer);
      this.offlineRefreshTimer = null;
    }
    this.cache.clear();
    this.currentLicense = null;
    this.trustedValidation = null;
    this.trustedPublicKeys = new Map(Object.entries(this.config.signingPublicKeys));
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
    if (this.destroyed) return;
    this.emit("sdk:destroyed");
    this.destroyed = true;
    this.stateGeneration += 1;
    this.stopAutoValidation();
    this.stopHeartbeat();
    this.stopConnectivityPolling();
    if (this.offlineRefreshTimer) {
      clearInterval(this.offlineRefreshTimer);
      this.offlineRefreshTimer = null;
    }
    this.eventListeners = Object.create(null);
    this.currentLicense = null;
    this.trustedValidation = null;
    this.lastOfflineValidation = null;
    this.currentAutoLicenseKey = null;
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
    this.assertUsable();
    requireSafeText(event, "event name", {
      min: 1,
      max: 100,
      pattern: /^[A-Za-z][A-Za-z0-9:_-]*$/,
    });
    if (typeof callback !== "function") throw new TypeError("Event callback must be a function");
    if (!this.eventListeners[event]) {
      this.eventListeners[event] = [];
    }
    if (this.eventListeners[event].length >= 100) {
      throw new RangeError("Too many listeners registered for this event");
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
    if (typeof event !== "string" || typeof callback !== "function") return;
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
      [...this.eventListeners[event]].forEach((callback) => {
        try {
          callback(data);
        } catch (error) {
          console.error(
            `[LicenseSeat SDK] Error in event listener for ${event}:`,
            redactForLog(error, this.sensitiveValues())
          );
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
    if (this.destroyed || !this.trustedValidation?.valid) return;

    this.currentAutoLicenseKey = licenseKey;
    const validationInterval = this.config.autoValidateInterval;

    // Don't start auto-validation if interval is 0 or negative
    if (!validationInterval || validationInterval <= 0) {
      this.log("Auto-validation disabled (interval:", validationInterval, ")");
      return;
    }

    const generation = this.stateGeneration;
    const performAndReschedule = () => {
      if (this.autoValidationInFlight || generation !== this.stateGeneration || this.destroyed) return;
      this.autoValidationInFlight = true;
      this.validateLicense(licenseKey)
        .then((result) => {
          if (
            result.valid &&
            !result.offline &&
            this.online &&
            generation === this.stateGeneration &&
            this.currentLicense &&
            constantTimeEqual(this.currentLicense.license_key, licenseKey)
          ) {
            return this.heartbeat().catch((err) => this.log("Heartbeat failed:", err));
          }
          return undefined;
        })
        .catch((err) => {
          this.log("Auto-validation failed:", err);
          this.emit("validation:auto-failed", { error: err });
        })
        .finally(() => {
          this.autoValidationInFlight = false;
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
    if (this.destroyed || !this.trustedValidation?.valid || !this.currentLicense) return;

    const interval = this.config.heartbeatInterval;
    if (!interval || interval <= 0) {
      this.log("Heartbeat timer disabled (interval:", interval, ")");
      return;
    }

    if (!this.config.productSlug) {
      this.log("Heartbeat timer disabled (productSlug not configured)");
      return;
    }

    const generation = this.stateGeneration;
    this.heartbeatTimer = setInterval(() => {
      if (this.heartbeatInFlight || generation !== this.stateGeneration || this.destroyed) return;
      this.heartbeatInFlight = true;
      this.heartbeat()
        .then(() => this.emit("heartbeat:cycle", { nextRunAt: new Date(Date.now() + interval) }))
        .catch((err) => this.log("Heartbeat timer failed:", err))
        .finally(() => {
          this.heartbeatInFlight = false;
        });
    }, interval);

    // Emit initial cycle event immediately (like auto-validation does)
    this.emit("heartbeat:cycle", { nextRunAt: new Date(Date.now() + interval) });

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
    if (this.connectivityTimer || this.destroyed || this.config.networkRecheckInterval <= 0) return;

    const healthCheck = async () => {
      try {
        await this.apiCall("/health", {
          method: "GET",
          authenticated: false,
          retryable: false,
          manageConnectivity: false,
        });

        if (!this.online) {
          this.online = true;
          this.emit("network:online");
          const licenseKey =
            this.currentAutoLicenseKey || this.currentLicense?.license_key;
          this.stopConnectivityPolling();
          if (licenseKey) {
            void this.validateLicense(licenseKey).catch((error) => {
              this.log("Validation after reconnect failed:", error);
            });
          }
          return;
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
    const generation = this.stateGeneration;
    const licenseKey = this.currentLicense?.license_key;
    try {
      const offline = await this.getOfflineToken();
      if (
        generation !== this.stateGeneration ||
        !licenseKey ||
        !this.currentLicense ||
        !constantTimeEqual(this.currentLicense.license_key, licenseKey) ||
        !this.trustedValidation?.valid
      ) {
        return;
      }
      this.cache.setOfflineToken(offline);

      const kid = offline.signature.key_id;

      this.emit("offlineToken:ready", {
        kid: kid,
        exp: offline.token?.exp,
      });

      // getOfflineToken() has already verified the signature and all bound
      // claims. Preparing fallback material must never replace fresh online
      // authorization with offline-derived state.
    } catch (err) {
      this.log("Failed to sync offline assets:", err);
      if (this.isRevocationError(err)) {
        this.revokeTrustedAuthorization(true);
      }
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
    if (
      this.destroyed ||
      !this.config.offlineFallbackEnabled ||
      this.config.maxOfflineDays <= 0 ||
      this.config.offlineLicenseRefreshInterval <= 0
    ) {
      this.offlineRefreshTimer = null;
      return;
    }
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
    this.assertUsable();
    const signed = this.cache.getOfflineToken();
    if (!signed) {
      return { valid: false, offline: true, code: "no_offline_token" };
    }
    return this.verifyCachedOfflineEnvelope(signed);
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
    return this.verifyCachedOfflineEnvelope(signed);
  }

  /**
   * Verify a cached envelope without using localStorage as a signing-key trust
   * anchor. A key must have been pinned in configuration or fetched over the
   * hardened transport during this SDK instance's lifetime.
   * @param {*} signed
   * @returns {Promise<import('./types.js').ValidationResult>}
   * @private
   */
  async verifyCachedOfflineEnvelope(signed) {
    const identity = this.currentLicense || this.loadCachedIdentity();
    if (!identity || !this.config.productSlug) {
      return { valid: false, offline: true, code: "no_license" };
    }
    const recorded = this.cache.getLicense()?.validation;
    if (isRecord(recorded) && recorded.valid === false && isAuthoritativeDenialCode(recorded.code)) {
      return {
        valid: false,
        offline: true,
        code: recorded.code.toLowerCase(),
        message: "The server denied this license; offline authority cannot override it until an online validation succeeds",
      };
    }
    try {
      const envelope = validateOfflineEnvelope(signed);
      const publicKey = await this.resolveTrustedSigningKey(
        envelope.signature.key_id,
        false
      );
      if (!(await this.verifyOfflineToken(envelope, publicKey))) {
        return { valid: false, offline: true, code: "signature_invalid" };
      }
      const now = Date.now();
      const lastSeen = this.cache.getLastSeenTimestamp();
      if (
        now + this.config.maxClockSkewMs < this.lastTrustedTimeMs ||
        (lastSeen !== null && now + this.config.maxClockSkewMs < lastSeen)
      ) {
        return { valid: false, offline: true, code: "clock_tamper" };
      }
      const result = validateOfflineClaims(envelope, {
        licenseKey: identity.license_key,
        productSlug: this.config.productSlug,
        fingerprint: identity.device_id,
        nowMs: now,
        maxClockSkewMs: this.config.maxClockSkewMs,
        maxOfflineDays: this.config.maxOfflineDays,
      });
      return result;
    } catch (error) {
      this.log("Offline verification failed:", error);
      return {
        valid: false,
        offline: true,
        code: this.offlineFailureCode(error),
      };
    }
  }

  /**
   * Resolve a public key from configured/current-process trust only.
   * Persisted public-key cache entries are intentionally never authoritative.
   * @param {string} keyId
   * @param {boolean} allowNetwork
   * @returns {Promise<string>}
   * @private
   */
  async resolveTrustedSigningKey(keyId, allowNetwork) {
    requireKeyId(keyId);
    const trusted = this.trustedPublicKeys.get(keyId);
    if (trusted) return trusted;
    if (!allowNetwork) {
      throw new CryptoError(
        "No trusted signing key is available. Pin signingPublicKeys for offline use across reloads."
      );
    }
    const response = await this.getSigningKey(keyId);
    return response.public_key;
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
   * @param {boolean} [options.authenticated=true] - Include API authentication
   * @param {boolean} [options.retryable=true] - Permit retries for this operation
   * @param {boolean} [options.manageConnectivity=true] - Update connectivity state
   * @returns {Promise<Object>} API response data
   * @throws {APIError} When the request fails after all retries
   * @private
   */
  async apiCall(endpoint, options = {}) {
    this.assertUsable();
    const url = this.buildRequestUrl(endpoint);
    let lastError;

    const headers = /** @type {Record<string, string>} */ ({
      Accept: "application/json",
    });

    const authenticated = options.authenticated !== false;
    if (authenticated && this.config.apiKey) {
      headers["Authorization"] = `Bearer ${this.config.apiKey}`;
    } else if (authenticated) {
      throw new ConfigurationError("API key is required for authenticated API requests");
    }

    const method = String(options.method || "GET").toUpperCase();
    if (!["GET", "POST"].includes(method)) {
      throw new ConfigurationError("Unsupported HTTP method");
    }
    let body = options.body;
    if (method === "GET" && body !== undefined) {
      throw new ConfigurationError("GET API requests cannot include a body");
    }
    if (method === "POST" && body && this.config.telemetryEnabled !== false) {
      body = {
        ...cloneBoundedJson(body),
        telemetry: cloneBoundedJson(
          collectTelemetry(SDK_VERSION, {
            appVersion: this.config.appVersion,
            appBuild: this.config.appBuild,
            browserHighEntropyValues: this.browserHighEntropyValues,
          })
        ),
      };
    }
    const serializedBody = body === undefined ? undefined : JSON.stringify(cloneBoundedJson(body));
    if (serializedBody !== undefined) headers["Content-Type"] = "application/json";
    if (serializedBody && new TextEncoder().encode(serializedBody).byteLength > this.config.maxResponseBytes) {
      throw new ConfigurationError("API request body exceeds the configured size limit");
    }

    const maxRetries = options.retryable === false ? 0 : this.config.maxRetries;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      let controller = null;
      let timeout = null;
      let deadlineTimer = null;
      let signal;
      try {
        const signalConstructor = /** @type {any} */ (
          new Request(url).signal.constructor
        );
        signal = typeof signalConstructor.timeout === "function"
          ? signalConstructor.timeout(this.config.requestTimeoutMs)
          : undefined;
      } catch (_) {
        signal = undefined;
      }
      if (!signal) {
        controller = new AbortController();
        signal = controller.signal;
        timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
        if (typeof timeout.unref === "function") timeout.unref();
      }
      try {
        /** @type {RequestInit} */
        const requestOptions = {
          method,
          headers,
          body: serializedBody,
          credentials: "omit",
          redirect: "manual",
          cache: "no-store",
          referrerPolicy: "no-referrer",
          signal,
        };
        const performFetch = async () => {
          try {
            return await fetch(url, requestOptions);
          } catch (error) {
            // Fetch and AbortSignal can come from different JavaScript realms
            // (iframes, jsdom, or instrumentation). Retry only the synchronous
            // brand-check failure without a signal; the independent deadline
            // below still fails closed for the caller.
            if (
              error instanceof TypeError &&
              /signal.*instance of abortsignal/i.test(error.message)
            ) {
              return fetch(url, { ...requestOptions, signal: undefined });
            }
            throw error;
          }
        };
        const deadline = new Promise((_, reject) => {
          deadlineTimer = setTimeout(() => {
            const error = new Error("API request timed out");
            error.name = "TimeoutError";
            reject(error);
          }, this.config.requestTimeoutMs);
          if (typeof deadlineTimer.unref === "function") deadlineTimer.unref();
        });
        const response = await Promise.race([performFetch(), deadline]);
        if (
          response.type === "opaqueredirect" ||
          (response.status >= 300 && response.status < 400)
        ) {
          throw new APIError("API redirects are refused", response.status || 310, {
            error: { code: "redirect_refused", message: "API redirects are refused" },
          });
        }
        let text;
        let data;
        try {
          text = await Promise.race([
            readBoundedResponseText(response, this.config.maxResponseBytes),
            deadline,
          ]);
          if (!text) throw new TypeError("API response body is empty");
          const contentType = response.headers.get("content-type") || "";
          if (!/^application\/(?:[A-Za-z0-9.+-]*\+)?json(?:\s*;|$)/i.test(contentType)) {
            throw new TypeError("API response Content-Type is not JSON");
          }
          data = parseApiJson(text, this.config.maxResponseBytes);
          if (!data || typeof data !== "object" || Array.isArray(data)) {
            throw new TypeError("API response JSON must be an object");
          }
        } catch (error) {
          if (
            error instanceof Error &&
            (error.name === "AbortError" || error.name === "TimeoutError")
          ) {
            throw error;
          }
          throw new APIError("Invalid API response", 502, {
            error: {
              code: "invalid_response",
              message: error instanceof Error ? error.message : "Invalid API response",
            },
          });
        }

        if (!response.ok) {
          // Handle new error format: { error: { code, message, details } }
          // Also support legacy format: { error: "message", reason_code: "code" }
          const errorObj = data.error;
          let errorMessage = "Request failed";
          if (isRecord(errorObj)) {
            errorMessage = safeErrorMessage(errorObj.message);
          } else if (typeof errorObj === "string") {
            errorMessage = safeErrorMessage(errorObj);
          } else {
            errorMessage = safeErrorMessage(data.message);
          }
          const apiError = new APIError(errorMessage, response.status, data);
          const retryAfter = response.headers.get("retry-after");
          if (retryAfter && /^\d+$/.test(retryAfter)) {
            apiError.retryAfterMs = Math.min(Number(retryAfter) * 1000, 60_000);
          }
          throw apiError;
        }

        // Back online
        if (options.manageConnectivity !== false && !this.online) {
          this.online = true;
          this.emit("network:online");
        }

        if (options.manageConnectivity !== false) this.stopConnectivityPolling();

        if (
          options.manageConnectivity !== false &&
          !this.validationTimer &&
          this.currentAutoLicenseKey &&
          this.trustedValidation?.valid
        ) {
          this.startAutoValidation(this.currentAutoLicenseKey);
        }

        return data;
      } catch (error) {
        let normalizedError = error;
        if (
          error instanceof Error &&
          (error.name === "AbortError" || error.name === "TimeoutError")
        ) {
          normalizedError = new APIError("API request timed out", 0, {
            error: { code: "request_timeout", message: "API request timed out" },
          });
        } else if (!(error instanceof APIError) && error instanceof TypeError) {
          normalizedError = new APIError("Network request failed", 0, {
            error: { code: "network_error", message: "Network request failed" },
          });
        }
        const networkFailure = normalizedError instanceof APIError && normalizedError.status === 0;

        if (options.manageConnectivity !== false && networkFailure && this.online) {
          this.online = false;
          this.emit("network:offline", { error: normalizedError });
          this.stopAutoValidation();
          this.stopHeartbeat();
          this.startConnectivityPolling();
        }

        lastError = normalizedError;

        const shouldRetry =
          attempt < maxRetries && this.shouldRetryError(normalizedError);

        if (shouldRetry) {
          const retryAfter = normalizedError instanceof APIError
            ? normalizedError.retryAfterMs
            : undefined;
          const delay = retryAfter ?? Math.min(this.config.retryDelay * Math.pow(2, attempt), 60_000);
          this.log(
            `Retry attempt ${attempt + 1} after ${delay}ms for error:`,
            normalizedError
          );
          await sleep(delay);
        } else {
          throw normalizedError;
        }
      } finally {
        if (timeout !== null) clearTimeout(timeout);
        if (deadlineTimer !== null) clearTimeout(deadlineTimer);
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
    if (error instanceof APIError) {
      const status = error.status;

      if (status >= 500 && status < 600 && status !== 501) {
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

  /** @private */
  assertUsable() {
    if (this.destroyed) {
      throw new LicenseError(
        "This LicenseSeat SDK instance has been destroyed",
        "sdk_destroyed"
      );
    }
  }

  /** @private */
  requireApiKey() {
    if (!this.config.apiKey) {
      throw new ConfigurationError("API key is required for this operation");
    }
  }

  /** @returns {string} @private */
  getOrCreateDeviceId() {
    const existing = this.cache.getInstallationId();
    if (existing) {
      try {
        return requireFingerprint(existing);
      } catch (_) {
        // Replace malformed storage with a fresh strong identifier.
      }
    }
    let generated;
    try {
      generated = generateDeviceId();
    } catch (error) {
      throw new ConfigurationError(
        error instanceof Error
          ? error.message
          : "Secure device ID generation is unavailable"
      );
    }
    requireFingerprint(generated);
    this.cache.setInstallationId(generated);
    return generated;
  }

  /**
   * @param {string} action
   * @returns {string}
   * @private
   */
  licenseActionPath(action) {
    const productSlug = requireProductSlug(this.config.productSlug);
    requireSafeText(action, "license action", {
      min: 1,
      max: 64,
      pattern: /^[a-z][a-z-]*$/,
    });
    return `/products/${encodeURIComponent(productSlug)}/licenses/${action}`;
  }

  /**
   * @param {string} endpoint
   * @returns {string}
   * @private
   */
  buildRequestUrl(endpoint) {
    if (
      typeof endpoint !== "string" ||
      !endpoint.startsWith("/") ||
      endpoint.length > 4096 ||
      /[\\?#\u0000-\u001f\u007f]/.test(endpoint)
    ) {
      throw new ConfigurationError("API request path is invalid");
    }
    const base = new URL(this.config.apiBaseUrl);
    const combined = new URL(`${this.config.apiBaseUrl}${endpoint}`);
    const basePath = base.pathname.replace(/\/+$/, "");
    if (
      combined.origin !== base.origin ||
      combined.username ||
      combined.password ||
      !(combined.pathname === basePath ||
        combined.pathname.startsWith(`${basePath}/`))
    ) {
      throw new ConfigurationError("API request escaped the configured origin");
    }
    return combined.toString();
  }

  /**
   * Load only identity fields needed for revalidation. Persisted validation
   * results are ignored because localStorage is attacker-writable.
   * @returns {import('./types.js').CachedLicense|null}
   * @private
   */
  loadCachedIdentity() {
    const cached = this.cache.getLicense();
    if (!cached) return null;
    try {
      const licenseKey = requireLicenseKey(cached.license_key);
      const deviceId = requireFingerprint(cached.device_id);
      requireSafeText(cached.activated_at, "cached activation timestamp", {
        min: 20,
        max: 40,
      });
      requireSafeText(cached.last_validated, "cached validation timestamp", {
        min: 20,
        max: 40,
      });
      if (
        !Number.isFinite(Date.parse(cached.activated_at)) ||
        !Number.isFinite(Date.parse(cached.last_validated))
      ) {
        throw new TypeError("Cached timestamps are invalid");
      }
      return {
        license_key: licenseKey,
        device_id: deviceId,
        activated_at: cached.activated_at,
        last_validated: cached.last_validated,
      };
    } catch (_) {
      this.cache.clearLicense();
      this.cache.clearOfflineToken();
      return null;
    }
  }

  /** @private */
  recordTrustedTime(timestamp) {
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) return;
    this.lastTrustedTimeMs = Math.max(this.lastTrustedTimeMs, timestamp);
    this.cache.setLastSeenTimestamp(this.lastTrustedTimeMs);
  }

  /**
   * @param {boolean} clearOffline
   * @private
   */
  revokeTrustedAuthorization(clearOffline) {
    this.stateGeneration += 1;
    if (!this.trustedValidation || this.trustedValidation.valid) {
      this.trustedValidation = null;
    }
    this.stopAutoValidation();
    this.stopHeartbeat();
    if (this.offlineRefreshTimer) {
      clearInterval(this.offlineRefreshTimer);
      this.offlineRefreshTimer = null;
    }
    this.currentAutoLicenseKey = null;
    if (clearOffline) this.cache.clearOfflineToken();
  }

  /** @private */
  clearLicenseState() {
    this.stateGeneration += 1;
    this.revokeTrustedAuthorization(true);
    this.stopConnectivityPolling();
    this.cache.clear();
    this.currentLicense = null;
    this.trustedValidation = null;
    this.trustedPublicKeys = new Map(
      Object.entries(this.config.signingPublicKeys)
    );
  }

  /**
   * @param {*} error
   * @returns {boolean}
   * @private
   */
  isRevocationError(error) {
    if (!(error instanceof APIError)) return false;
    const code = apiErrorCode(error.data);
    return [
      "revoked",
      "license_revoked",
      "suspended",
      "license_suspended",
      "expired",
      "license_expired",
      "not_active",
      "license_not_active",
    ].includes(code);
  }

  /**
   * @param {*} error
   * @returns {boolean}
   * @private
   */
  isAlreadyGoneError(error) {
    if (!(error instanceof APIError)) return false;
    const code = apiErrorCode(error.data);
    if ([404, 410].includes(error.status)) {
      return [
        "activation_not_found",
        "license_not_found",
        "already_deactivated",
        "revoked",
        "license_revoked",
      ].includes(code);
    }
    return (
      error.status === 422 &&
      [
        "revoked",
        "license_revoked",
        "already_deactivated",
        "not_active",
        "suspended",
        "license_suspended",
        "expired",
        "license_expired",
      ].includes(code)
    );
  }

  /**
   * @param {*} error
   * @returns {string}
   * @private
   */
  offlineFailureCode(error) {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (message.includes("trusted signing key")) return "untrusted_public_key";
    if (message.includes("canonical") || message.includes("does not match token")) {
      return "token_mismatch";
    }
    if (message.includes("signature")) return "signature_invalid";
    if (message.includes("product identity")) return "product_mismatch";
    if (message.includes("license identity")) return "license_mismatch";
    if (message.includes("device identity")) return "device_mismatch";
    if (message.includes("grace period")) return "grace_period_expired";
    if (message.includes("disabled by local policy")) return "offline_disabled";
    if (message.includes("expired")) return "expired";
    if (message.includes("not yet valid")) return "not_yet_valid";
    return "verification_error";
  }

  /** @returns {string[]} @private */
  sensitiveValues() {
    return [
      this.config.apiKey,
      this.currentLicense?.license_key,
      this.currentLicense?.device_id,
      ...this.transientSecrets.keys(),
    ].filter((value) => typeof value === "string");
  }

  /**
   * Keep request-bound secrets redacted until the operation and all of its
   * event/error logging have completed. Reference counts make concurrent
   * operations with the same credential safe.
   * @param {...*} values
   * @returns {() => void}
   * @private
   */
  trackSensitiveValues(...values) {
    const secrets = values.filter((value) => typeof value === "string" && value.length >= 4);
    for (const secret of secrets) {
      this.transientSecrets.set(secret, (this.transientSecrets.get(secret) || 0) + 1);
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      for (const secret of secrets) {
        const count = this.transientSecrets.get(secret) || 0;
        if (count <= 1) this.transientSecrets.delete(secret);
        else this.transientSecrets.set(secret, count - 1);
      }
    };
  }

  /**
   * Get CSRF token from meta tag
   * @returns {string} CSRF token or empty string
   */
  getCsrfToken() {
    this.assertUsable();
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
      const secrets = this.sensitiveValues();
      console.log(
        "[LicenseSeat SDK]",
        ...args.map((argument) => redactForLog(argument, secrets))
      );
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
  if (sharedInstance) sharedInstance.destroy();
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
