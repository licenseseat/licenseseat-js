/**
 * LicenseSeat SDK Type Definitions
 * These JSDoc types enable TypeScript support via declaration file generation.
 * @module types
 */

/**
 * SDK Configuration options
 * @typedef {Object} LicenseSeatConfig
 * @property {string} [apiBaseUrl="https://api.licenseseat.com"] - Base URL for the LicenseSeat API
 * @property {string} [apiKey] - API key for authentication (required for most operations)
 * @property {string} [storagePrefix="licenseseat_"] - Prefix for localStorage keys
 * @property {number} [autoValidateInterval=3600000] - Interval in ms for automatic license validation (default: 1 hour)
 * @property {number} [networkRecheckInterval=30000] - Interval in ms to check network connectivity when offline (default: 30s)
 * @property {number} [maxRetries=3] - Maximum number of retry attempts for failed API calls
 * @property {number} [retryDelay=1000] - Initial delay in ms between retries (exponential backoff applied)
 * @property {boolean} [debug=false] - Enable debug logging to console
 * @property {number} [offlineLicenseRefreshInterval=259200000] - Interval in ms to refresh offline license (default: 72 hours)
 * @property {boolean} [offlineFallbackEnabled=false] - Enable offline validation fallback on network errors
 * @property {number} [maxOfflineDays=0] - Maximum days a license can be used offline (0 = disabled)
 * @property {number} [maxClockSkewMs=300000] - Maximum allowed clock skew in ms for offline validation (default: 5 minutes)
 * @property {boolean} [autoInitialize=true] - Automatically initialize and validate cached license on construction
 */

/**
 * License activation options
 * @typedef {Object} ActivationOptions
 * @property {string} [deviceIdentifier] - Custom device identifier (auto-generated if not provided)
 * @property {string} [softwareReleaseDate] - ISO8601 date string for version-aware activation
 * @property {Object} [metadata] - Additional metadata to include with the activation
 */

/**
 * License validation options
 * @typedef {Object} ValidationOptions
 * @property {string} [deviceIdentifier] - Device identifier to validate against
 * @property {string} [productSlug] - Product slug for product-specific validation
 */

/**
 * Activation response from the API
 * @typedef {Object} ActivationResponse
 * @property {string} id - Activation ID
 * @property {string} license_key - The activated license key
 * @property {string} device_identifier - Device identifier used for activation
 * @property {string} activated_at - ISO8601 timestamp of activation
 * @property {Object} [metadata] - Additional metadata
 */

/**
 * Cached license data
 * @typedef {Object} CachedLicense
 * @property {string} license_key - The license key
 * @property {string} device_identifier - Device identifier
 * @property {ActivationResponse} [activation] - Original activation response
 * @property {string} activated_at - ISO8601 timestamp of activation
 * @property {string} last_validated - ISO8601 timestamp of last validation
 * @property {ValidationResult} [validation] - Latest validation result
 */

/**
 * Entitlement object
 * @typedef {Object} Entitlement
 * @property {string} key - Unique entitlement key
 * @property {string|null} name - Human-readable name
 * @property {string|null} description - Description of the entitlement
 * @property {string|null} expires_at - ISO8601 expiration timestamp
 * @property {Object|null} metadata - Additional metadata
 */

/**
 * Validation result from API or offline verification
 * @typedef {Object} ValidationResult
 * @property {boolean} valid - Whether the license is valid
 * @property {boolean} [offline] - Whether this was an offline validation
 * @property {string} [reason] - Reason for invalid status (online)
 * @property {string} [reason_code] - Machine-readable reason code (offline)
 * @property {Entitlement[]} [active_entitlements] - List of active entitlements
 * @property {boolean} [optimistic] - Whether this is an optimistic validation (pending server confirmation)
 */

/**
 * Entitlement check result
 * @typedef {Object} EntitlementCheckResult
 * @property {boolean} active - Whether the entitlement is active
 * @property {string} [reason] - Reason if not active ("no_license" | "not_found" | "expired")
 * @property {string} [expires_at] - ISO8601 expiration timestamp if expired
 * @property {Entitlement} [entitlement] - Full entitlement object if active
 */

/**
 * License status object
 * @typedef {Object} LicenseStatus
 * @property {string} status - Status string ("inactive" | "pending" | "invalid" | "offline-invalid" | "offline-valid" | "active")
 * @property {string} [message] - Human-readable status message
 * @property {string} [license] - License key (if active)
 * @property {string} [device] - Device identifier (if active)
 * @property {string} [activated_at] - ISO8601 activation timestamp
 * @property {string} [last_validated] - ISO8601 last validation timestamp
 * @property {Entitlement[]} [entitlements] - List of active entitlements
 */

/**
 * Offline license payload
 * @typedef {Object} OfflineLicensePayload
 * @property {string} [lic_k] - License key
 * @property {string} [exp_at] - ISO8601 expiration timestamp
 * @property {string} [kid] - Key ID for signature verification
 * @property {Array<Object>} [active_ents] - Active entitlements
 * @property {Array<Object>} [active_entitlements] - Active entitlements (alternative key)
 * @property {Object} [metadata] - Additional metadata
 */

/**
 * Signed offline license data
 * @typedef {Object} SignedOfflineLicense
 * @property {OfflineLicensePayload} payload - The license payload
 * @property {string} signature_b64u - Base64URL-encoded Ed25519 signature
 * @property {string} [kid] - Key ID for public key lookup
 */

/**
 * Event callback function
 * @callback EventCallback
 * @param {*} data - Event data
 * @returns {void}
 */

/**
 * Event unsubscribe function
 * @callback EventUnsubscribe
 * @returns {void}
 */

/**
 * API Error data
 * @typedef {Object} APIErrorData
 * @property {string} [error] - Error message
 * @property {string} [code] - Error code
 * @property {Object} [details] - Additional error details
 */

// Export empty object to make this a module
export {};
