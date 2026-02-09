/**
 * LicenseSeat JavaScript SDK
 *
 * Official JavaScript client for LicenseSeat - the simple, secure licensing platform
 * for apps, games, and plugins.
 *
 * @module @licenseseat/js
 * @version 0.3.0
 *
 * @example
 * ```js
 * import LicenseSeat from '@licenseseat/js';
 *
 * const sdk = new LicenseSeat({
 *   apiKey: 'your-api-key',
 *   productSlug: 'your-product',  // Required: your product slug
 *   debug: true
 * });
 *
 * // Activate a license
 * await sdk.activate('LICENSE-KEY-HERE');
 *
 * // Check entitlements
 * if (sdk.hasEntitlement('pro')) {
 *   // Enable pro features
 * }
 *
 * // Get license status
 * const status = sdk.getStatus();
 * console.log(status);
 * ```
 */

// Re-export the main SDK class and version
export {
  LicenseSeatSDK,
  SDK_VERSION,
  getSharedInstance,
  configure,
  resetSharedInstance,
} from "./LicenseSeat.js";

// Re-export types (empty module, but useful for documentation)
export {} from "./types.js";

// Re-export error classes
export { APIError, ConfigurationError, LicenseError, CryptoError } from "./errors.js";

// Re-export cache (for advanced use cases)
export { LicenseCache } from "./cache.js";

// Re-export utility functions (for advanced use cases)
export {
  parseActiveEntitlements,
  constantTimeEqual,
  canonicalJsonStringify,
  base64UrlDecode,
  generateDeviceId,
  getCsrfToken,
} from "./utils.js";

// Re-export telemetry collection (for advanced use cases)
export { collectTelemetry } from "./telemetry.js";

// Default export - the main SDK class
import { LicenseSeatSDK } from "./LicenseSeat.js";
export default LicenseSeatSDK;
