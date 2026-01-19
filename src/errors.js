/**
 * LicenseSeat SDK Error Classes
 * @module errors
 */

/**
 * Custom API Error class for HTTP request failures
 * @extends Error
 */
export class APIError extends Error {
  /**
   * Create an APIError
   * @param {string} message - Error message
   * @param {number} status - HTTP status code (0 for network failures)
   * @param {import('./types.js').APIErrorData} [data] - Additional error data from the API response
   */
  constructor(message, status, data) {
    super(message);
    /** @type {string} */
    this.name = "APIError";
    /** @type {number} */
    this.status = status;
    /** @type {import('./types.js').APIErrorData|undefined} */
    this.data = data;
  }
}

/**
 * Error thrown when SDK operations are attempted without proper configuration
 * @extends Error
 */
export class ConfigurationError extends Error {
  /**
   * Create a ConfigurationError
   * @param {string} message - Error message
   */
  constructor(message) {
    super(message);
    /** @type {string} */
    this.name = "ConfigurationError";
  }
}

/**
 * Error thrown when license operations fail
 * @extends Error
 */
export class LicenseError extends Error {
  /**
   * Create a LicenseError
   * @param {string} message - Error message
   * @param {string} [code] - Machine-readable error code
   */
  constructor(message, code) {
    super(message);
    /** @type {string} */
    this.name = "LicenseError";
    /** @type {string|undefined} */
    this.code = code;
  }
}

/**
 * Error thrown when cryptographic operations fail
 * @extends Error
 */
export class CryptoError extends Error {
  /**
   * Create a CryptoError
   * @param {string} message - Error message
   */
  constructor(message) {
    super(message);
    /** @type {string} */
    this.name = "CryptoError";
  }
}
