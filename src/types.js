/**
 * LicenseSeat SDK Type Definitions
 * These JSDoc types enable TypeScript support via declaration file generation.
 * @module types
 */

/**
 * SDK Configuration options
 * @typedef {Object} LicenseSeatConfig
 * @property {string} [apiBaseUrl="https://licenseseat.com/api/v1"] - Base URL for the LicenseSeat API
 * @property {string} [productSlug] - Product slug (required for API calls, e.g., "my-app")
 * @property {string} [apiKey] - API key for authentication (required for most operations)
 * @property {string} [storagePrefix="licenseseat_"] - Prefix for localStorage keys
 * @property {number} [autoValidateInterval=3600000] - Interval in ms for automatic license validation (default: 1 hour)
 * @property {number} [networkRecheckInterval=30000] - Interval in ms to check network connectivity when offline (default: 30s)
 * @property {number} [maxRetries=3] - Maximum number of retry attempts for failed API calls
 * @property {number} [retryDelay=1000] - Initial delay in ms between retries (exponential backoff applied)
 * @property {boolean} [debug=false] - Enable debug logging to console
 * @property {number} [offlineLicenseRefreshInterval=259200000] - Interval in ms to refresh offline token (default: 72 hours)
 * @property {boolean} [offlineFallbackEnabled=false] - Enable offline validation fallback on network errors
 * @property {number} [maxOfflineDays=0] - Maximum days a license can be used offline (0 = disabled)
 * @property {number} [maxClockSkewMs=300000] - Maximum allowed clock skew in ms for offline validation (default: 5 minutes)
 * @property {boolean} [autoInitialize=true] - Automatically initialize and validate cached license on construction
 * @property {boolean} [telemetryEnabled=true] - Enable telemetry collection on POST requests (set false for GDPR compliance)
 */

/**
 * License activation options
 * @typedef {Object} ActivationOptions
 * @property {string} [deviceId] - Custom device ID (auto-generated if not provided)
 * @property {string} [deviceName] - Human-readable device name (e.g., "John's MacBook Pro")
 * @property {Object} [metadata] - Additional metadata to include with the activation
 */

/**
 * License validation options
 * @typedef {Object} ValidationOptions
 * @property {string} [deviceId] - Device ID to validate against (required for hardware_locked mode)
 */

/**
 * Activation response from the API
 * @typedef {Object} ActivationResponse
 * @property {string} object - Object type ("activation")
 * @property {number} id - Activation ID
 * @property {string} device_id - Device ID used for activation
 * @property {string} [device_name] - Human-readable device name
 * @property {string} license_key - The activated license key
 * @property {string} activated_at - ISO8601 timestamp of activation
 * @property {string|null} [deactivated_at] - ISO8601 timestamp of deactivation (null if active)
 * @property {string} [ip_address] - IP address of activation request
 * @property {Object} [metadata] - Additional metadata
 * @property {LicenseObject} license - The license object
 */

/**
 * Deactivation response from the API
 * @typedef {Object} DeactivationResponse
 * @property {string} object - Object type ("deactivation")
 * @property {number} activation_id - The deactivated activation ID
 * @property {string} deactivated_at - ISO8601 timestamp of deactivation
 */

/**
 * License object from API responses
 * @typedef {Object} LicenseObject
 * @property {string} key - The license key
 * @property {string} status - License status ("active", "revoked", "suspended", etc.)
 * @property {string} [starts_at] - ISO8601 start timestamp
 * @property {string|null} [expires_at] - ISO8601 expiration timestamp (null for perpetual)
 * @property {string} mode - License mode ("hardware_locked", "floating", "named_user")
 * @property {string} plan_key - License plan key
 * @property {number} [seat_limit] - Maximum allowed seats
 * @property {number} active_seats - Currently active seats
 * @property {Entitlement[]} active_entitlements - List of active entitlements
 * @property {Object} [metadata] - Additional metadata
 * @property {ProductInfo} product - Product information
 */

/**
 * Product information
 * @typedef {Object} ProductInfo
 * @property {string} slug - Product slug
 * @property {string} name - Product display name
 */

/**
 * Cached license data
 * @typedef {Object} CachedLicense
 * @property {string} license_key - The license key
 * @property {string} device_id - Device ID
 * @property {ActivationResponse} [activation] - Original activation response
 * @property {string} activated_at - ISO8601 timestamp of activation
 * @property {string} last_validated - ISO8601 timestamp of last validation
 * @property {ValidationResult} [validation] - Latest validation result
 */

/**
 * Entitlement object
 * @typedef {Object} Entitlement
 * @property {string} key - Unique entitlement key
 * @property {string|null} expires_at - ISO8601 expiration timestamp (null for perpetual)
 * @property {Object|null} metadata - Additional metadata
 */

/**
 * Validation result from API or offline verification
 * @typedef {Object} ValidationResult
 * @property {boolean} valid - Whether the license is valid
 * @property {boolean} [offline] - Whether this was an offline validation
 * @property {string} [code] - Machine-readable reason code (when invalid)
 * @property {string} [message] - Human-readable message (when invalid)
 * @property {ValidationWarning[]} [warnings] - Non-fatal warnings (e.g., expiring soon)
 * @property {LicenseObject} [license] - The license object (online validation)
 * @property {ActivationResponse} [activation] - The activation object (if device_id provided)
 * @property {Entitlement[]} [active_entitlements] - List of active entitlements
 * @property {boolean} [optimistic] - Whether this is an optimistic validation (pending server confirmation)
 */

/**
 * Validation warning
 * @typedef {Object} ValidationWarning
 * @property {string} code - Warning code (e.g., "license_expiring_soon")
 * @property {string} message - Human-readable warning message
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
 * @property {string} [device] - Device ID (if active)
 * @property {string} [activated_at] - ISO8601 activation timestamp
 * @property {string} [last_validated] - ISO8601 last validation timestamp
 * @property {Entitlement[]} [entitlements] - List of active entitlements
 */

/**
 * Offline token data (new v1 format)
 * @typedef {Object} OfflineToken
 * @property {string} object - Object type ("offline_token")
 * @property {OfflineTokenPayload} token - The token payload
 * @property {OfflineTokenSignature} signature - Signature information
 * @property {string} canonical - Canonical JSON string that was signed
 */

/**
 * Offline token payload
 * @typedef {Object} OfflineTokenPayload
 * @property {number} schema_version - Token schema version (currently 1)
 * @property {string} license_key - License key
 * @property {string} product_slug - Product slug
 * @property {string} plan_key - License plan key
 * @property {string} mode - License mode ("hardware_locked", "floating", "named_user")
 * @property {number|null} [seat_limit] - Seat limit (null for unlimited)
 * @property {string|null} [device_id] - Device ID (required for hardware_locked mode)
 * @property {number} iat - Issued at (Unix timestamp in seconds)
 * @property {number} exp - Expires at (Unix timestamp in seconds)
 * @property {number} nbf - Not before (Unix timestamp in seconds)
 * @property {number|null} [license_expires_at] - License expiration (Unix timestamp in seconds, null for perpetual)
 * @property {string} kid - Key ID for signature verification
 * @property {OfflineEntitlement[]} entitlements - Active entitlements
 * @property {Object} [metadata] - Additional metadata
 */

/**
 * Offline token entitlement
 * @typedef {Object} OfflineEntitlement
 * @property {string} key - Entitlement key
 * @property {number|null} [expires_at] - Expiration (Unix timestamp in seconds)
 */

/**
 * Offline token signature
 * @typedef {Object} OfflineTokenSignature
 * @property {string} algorithm - Signature algorithm (e.g., "Ed25519")
 * @property {string} key_id - Key ID for public key lookup
 * @property {string} value - Base64URL-encoded signature value
 */

/**
 * Signing key response from API
 * @typedef {Object} SigningKey
 * @property {string} object - Object type ("signing_key")
 * @property {string} key_id - Key ID
 * @property {string} algorithm - Algorithm (e.g., "Ed25519")
 * @property {string} public_key - Base64-encoded public key
 * @property {string} [created_at] - ISO8601 creation timestamp
 * @property {string} status - Key status ("active", "revoked")
 */

/**
 * Heartbeat response from the API
 * @typedef {Object} HeartbeatResponse
 * @property {string} object - Object type ("heartbeat")
 * @property {string} received_at - ISO8601 timestamp of when the heartbeat was received
 * @property {LicenseObject} license - The license object
 */

/**
 * Health check response
 * @typedef {Object} HealthResponse
 * @property {string} object - Object type ("health")
 * @property {string} status - Health status ("healthy")
 * @property {string} api_version - API version string
 * @property {string} timestamp - ISO8601 timestamp
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
 * API Error data (new format)
 * @typedef {Object} APIErrorData
 * @property {APIErrorObject} [error] - Error object (new format)
 * @property {string} [code] - Machine-readable error code (fallback)
 * @property {string} [message] - Human-readable error message (fallback)
 */

/**
 * API Error object
 * @typedef {Object} APIErrorObject
 * @property {string} code - Machine-readable error code
 * @property {string} message - Human-readable error message
 * @property {Object} [details] - Additional error details
 */

// Export empty object to make this a module
export {};
