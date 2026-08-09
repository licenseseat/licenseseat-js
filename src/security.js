import { base64UrlDecode, constantTimeEqual } from "./utils.js";
import { equalJsonValues, parseStrictJson } from "./strict-json.js";

export const MAX_RESPONSE_BYTES = 1024 * 1024;
export const MAX_TOKEN_LIFETIME_SECONDS = 100 * 366 * 24 * 60 * 60;

const SAFE_KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const SAFE_PRODUCT_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SENSITIVE_FIELD = /^(?:authorization|api[_-]?key|license[_-]?key|device[_-]?(?:id|fingerprint)|fingerprint|canonical|signature|public[_-]?key|private[_-]?key|token|certificate|metadata|ip[_-]?address)$/i;

export function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function byteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

function hasUnpairedSurrogate(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

/**
 * @param {*} value
 * @param {string} name
 * @param {{min?: number, max?: number, pattern?: RegExp}} [limits]
 */
export function requireSafeText(value, name, { min = 1, max = 255, pattern } = {}) {
  if (
    typeof value !== "string" ||
    hasUnpairedSurrogate(value) ||
    /[\u0000-\u001f\u007f]/.test(value) ||
    byteLength(value) < min ||
    byteLength(value) > max ||
    (pattern && !pattern.test(value))
  ) {
    throw new TypeError(`${name} is invalid`);
  }
  return value;
}

export function requireLicenseKey(value) {
  return requireSafeText(value, "licenseKey", { min: 1, max: 512 });
}

export function requireFingerprint(value) {
  return requireSafeText(value, "device fingerprint", { min: 8, max: 255 });
}

export function requireKeyId(value) {
  return requireSafeText(value, "signing key ID", {
    min: 1,
    max: 255,
    pattern: SAFE_KEY_ID,
  });
}

export function requireProductSlug(value) {
  return requireSafeText(value, "productSlug", {
    min: 1,
    max: 100,
    pattern: SAFE_PRODUCT_SLUG,
  });
}

function requireBoolean(value, name) {
  if (typeof value !== "boolean") throw new TypeError(`${name} must be a boolean`);
}

function requireInteger(value, name, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
}

/**
 * Clone user-controlled JSON data while enforcing resource and type limits.
 * Accessor properties and objects with surprising prototypes are rejected.
 */
export function cloneBoundedJson(value, options = {}) {
  const limits = {
    maxDepth: 16,
    maxNodes: 10_000,
    maxObjectKeys: 1_000,
    maxArrayLength: 5_000,
    maxStringBytes: 256 * 1024,
    maxKeyBytes: 255,
    ...options,
  };
  for (const [name, limit] of Object.entries(limits)) {
    if (!Number.isSafeInteger(limit) || limit <= 0) {
      throw new TypeError(`${name} must be a positive safe integer`);
    }
  }
  let nodes = 0;

  const clone = (current, depth) => {
    nodes += 1;
    if (nodes > limits.maxNodes) throw new TypeError("JSON data has too many values");
    if (depth > limits.maxDepth) throw new TypeError("JSON data is too deeply nested");
    if (current === null || typeof current === "boolean") return current;
    if (typeof current === "number") {
      if (!Number.isFinite(current)) throw new TypeError("JSON numbers must be finite");
      return current;
    }
    if (typeof current === "string") {
      if (hasUnpairedSurrogate(current) || byteLength(current) > limits.maxStringBytes) {
        throw new TypeError("JSON string is invalid or too large");
      }
      return current;
    }
    if (Array.isArray(current)) {
      if (current.length > limits.maxArrayLength) throw new TypeError("JSON array is too large");
      if (Object.getPrototypeOf(current) !== Array.prototype) {
        throw new TypeError("JSON arrays must have the standard Array prototype");
      }
      if (Object.getOwnPropertySymbols(current).length > 0) {
        throw new TypeError("JSON arrays cannot contain symbol keys");
      }
      const descriptors = Object.getOwnPropertyDescriptors(current);
      const expectedKeys = new Set(Array.from({ length: current.length }, (_, index) => String(index)));
      for (const [key, descriptor] of Object.entries(descriptors)) {
        if (key === "length") continue;
        if (!expectedKeys.has(key) || !descriptor.enumerable || !("value" in descriptor)) {
          throw new TypeError("JSON arrays must be dense and cannot contain accessors or extra keys");
        }
      }
      if (Object.keys(descriptors).length !== current.length + 1) {
        throw new TypeError("JSON arrays must be dense");
      }
      return Array.from({ length: current.length }, (_, index) =>
        clone(descriptors[String(index)].value, depth + 1)
      );
    }
    if (!isRecord(current)) throw new TypeError("Value is not JSON-serializable");
    const prototype = Object.getPrototypeOf(current);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("JSON objects must have a plain prototype");
    }
    if (Object.getOwnPropertySymbols(current).length > 0) {
      throw new TypeError("JSON objects cannot contain symbol keys");
    }
    const descriptors = Object.getOwnPropertyDescriptors(current);
    const keys = Object.keys(descriptors).filter((key) => descriptors[key].enumerable);
    if (keys.length > limits.maxObjectKeys) throw new TypeError("JSON object has too many keys");
    const result = {};
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!("value" in descriptor)) throw new TypeError("JSON objects cannot contain accessors");
      requireSafeText(key, "JSON object key", { min: 1, max: limits.maxKeyBytes });
      if (["__proto__", "prototype", "constructor"].includes(key)) {
        throw new TypeError("JSON object contains an unsafe key");
      }
      Object.defineProperty(result, key, {
        value: clone(descriptor.value, depth + 1),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return result;
  };

  const result = clone(value, 0);
  const serialized = JSON.stringify(result);
  if (byteLength(serialized) > MAX_RESPONSE_BYTES) throw new TypeError("JSON data is too large");
  return result;
}

function normalizeApiBaseUrl(value, allowInsecureHttp) {
  requireSafeText(value, "apiBaseUrl", { min: 1, max: 2048 });
  let url;
  try {
    url = new URL(value);
  } catch (_) {
    throw new TypeError("apiBaseUrl must be an absolute URL");
  }
  const hostname = url.hostname.toLowerCase();
  const loopback = hostname === "localhost" || hostname === "[::1]" || /^127(?:\.\d{1,3}){3}$/.test(hostname);
  if (
    url.protocol !== "https:" &&
    !(allowInsecureHttp && url.protocol === "http:" && loopback)
  ) {
    throw new TypeError("apiBaseUrl must use HTTPS (HTTP is allowed only for explicit loopback development)");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new TypeError("apiBaseUrl cannot contain credentials, a query, or a fragment");
  }
  if (!url.hostname) throw new TypeError("apiBaseUrl must include a host");
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

/**
 * Validate, normalize, and freeze SDK configuration.
 */
export function normalizeConfig(defaults, input) {
  if (!isRecord(input)) throw new TypeError("SDK configuration must be a plain object");
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("SDK configuration must be a plain object");
  }
  if (Object.getOwnPropertySymbols(input).length > 0) {
    throw new TypeError("SDK configuration cannot contain symbol keys");
  }
  const descriptors = Object.getOwnPropertyDescriptors(input);
  for (const descriptor of Object.values(descriptors)) {
    if (descriptor.enumerable && !("value" in descriptor)) {
      throw new TypeError("SDK configuration cannot contain accessor properties");
    }
  }
  const unknown = Object.keys(input).filter(
    (key) => !Object.prototype.hasOwnProperty.call(defaults, key)
  );
  if (unknown.length) throw new TypeError(`Unknown SDK configuration option: ${unknown[0]}`);
  const config = { ...defaults, ...input };

  requireBoolean(config.allowInsecureHttp, "allowInsecureHttp");
  config.apiBaseUrl = normalizeApiBaseUrl(config.apiBaseUrl, config.allowInsecureHttp);
  if (config.productSlug !== null && config.productSlug !== undefined) {
    requireProductSlug(config.productSlug);
  }
  if (config.apiKey !== null && config.apiKey !== undefined) {
    requireSafeText(config.apiKey, "apiKey", { min: 1, max: 2048 });
  }
  requireSafeText(config.storagePrefix, "storagePrefix", {
    min: 3,
    max: 128,
    pattern: /^[A-Za-z0-9._:-]+$/,
  });
  for (const name of [
    "autoInitialize",
    "debug",
    "offlineFallbackEnabled",
    "telemetryEnabled",
  ]) {
    requireBoolean(config[name], name);
  }
  for (const name of [
    "autoValidateInterval",
    "heartbeatInterval",
    "networkRecheckInterval",
    "offlineLicenseRefreshInterval",
  ]) {
    requireInteger(config[name], name, 0, 2_147_483_647);
  }
  requireInteger(config.maxRetries, "maxRetries", 0, 10);
  requireInteger(config.retryDelay, "retryDelay", 0, 60_000);
  requireInteger(config.requestTimeoutMs, "requestTimeoutMs", 1, 120_000);
  requireInteger(config.maxResponseBytes, "maxResponseBytes", 1024, 10 * 1024 * 1024);
  requireInteger(config.maxOfflineDays, "maxOfflineDays", 0, 36_600);
  requireInteger(config.maxClockSkewMs, "maxClockSkewMs", 0, 60 * 60 * 1000);
  for (const name of ["appVersion", "appBuild"]) {
    if (config[name] !== null && config[name] !== undefined) {
      requireSafeText(config[name], name, { min: 1, max: 255 });
    }
  }

  if (!isRecord(config.signingPublicKeys)) {
    throw new TypeError("signingPublicKeys must be an object keyed by signing key ID");
  }
  const signingKeyPrototype = Object.getPrototypeOf(config.signingPublicKeys);
  if (signingKeyPrototype !== Object.prototype && signingKeyPrototype !== null) {
    throw new TypeError("signingPublicKeys must be a plain object");
  }
  const signingPublicKeys = Object.create(null);
  if (
    Object.getOwnPropertySymbols(config.signingPublicKeys).length > 0 ||
    Object.values(Object.getOwnPropertyDescriptors(config.signingPublicKeys)).some(
      (descriptor) => descriptor.enumerable && !("value" in descriptor)
    )
  ) {
    throw new TypeError("signingPublicKeys cannot contain accessors or symbol keys");
  }
  const entries = Object.entries(config.signingPublicKeys);
  if (entries.length > 32) throw new TypeError("Too many configured signing public keys");
  for (const [keyId, publicKey] of entries) {
    requireKeyId(keyId);
    base64UrlDecode(publicKey, { expectedBytes: 32, maxBytes: 32 });
    signingPublicKeys[keyId] = publicKey;
  }
  config.signingPublicKeys = Object.freeze(signingPublicKeys);
  return Object.freeze(config);
}

function requireRfc3339(value, name, nullable = false) {
  if (nullable && value == null) return null;
  requireSafeText(value, name, { min: 20, max: 40 });
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match) {
    throw new TypeError(`${name} must be an RFC 3339 timestamp`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[8] === "Z" ? 0 : Number(match[10]);
  const offsetMinute = match[8] === "Z" ? 0 : Number(match[11]);
  const daysInMonth = month >= 1 && month <= 12
    ? new Date(Date.UTC(year, month, 0)).getUTCDate()
    : 0;
  if (
    year < 1000 || month < 1 || month > 12 || day < 1 || day > daysInMonth ||
    hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59
  ) {
    throw new TypeError(`${name} is invalid`);
  }
  const fractionMs = Number((match[7] || "").padEnd(3, "0").slice(0, 3));
  const localTimestamp = Date.UTC(year, month - 1, day, hour, minute, second, fractionMs);
  const offsetMs = (offsetHour * 60 + offsetMinute) * 60_000;
  const timestamp = match[9] === "+"
    ? localTimestamp - offsetMs
    : match[9] === "-"
      ? localTimestamp + offsetMs
      : localTimestamp;
  if (!Number.isFinite(timestamp)) throw new TypeError(`${name} is invalid`);
  return timestamp;
}

function requireIdentifier(value, name) {
  if (typeof value === "string") return requireSafeText(value, name, { min: 1, max: 255 });
  if (Number.isSafeInteger(value) && value >= 0) return value;
  throw new TypeError(`${name} is invalid`);
}

function validateOnlineEntitlements(value) {
  if (!Array.isArray(value) || value.length > 500) {
    throw new TypeError("active_entitlements must be an array of at most 500 entries");
  }
  const seen = new Set();
  return value.map((entry) => {
    if (!isRecord(entry)) throw new TypeError("Entitlement must be an object");
    const key = requireSafeText(entry.key, "entitlement key", { min: 1, max: 100 });
    if (seen.has(key)) throw new TypeError("Duplicate entitlement key");
    seen.add(key);
    if (entry.expires_at != null) requireRfc3339(entry.expires_at, "entitlement expiry");
    const metadata = entry.metadata == null ? null : cloneBoundedJson(entry.metadata);
    return { key, expires_at: entry.expires_at ?? null, metadata };
  });
}

function validateLicenseObject(value, expectedLicenseKey, productSlug, requireActive) {
  if (!isRecord(value) || value.object !== "license") {
    throw new TypeError("API response is missing a license object");
  }
  requireLicenseKey(value.key);
  if (!constantTimeEqual(value.key, expectedLicenseKey)) {
    throw new TypeError("API response license identity does not match the request");
  }
  if (!isRecord(value.product) || value.product.object !== "product") {
    throw new TypeError("API response is missing product identity");
  }
  requireProductSlug(value.product.slug);
  if (!constantTimeEqual(value.product.slug, productSlug)) {
    throw new TypeError("API response product identity does not match the request");
  }
  requireSafeText(value.status, "license status", { min: 1, max: 64 });
  requireSafeText(value.mode, "license mode", { min: 1, max: 64 });
  if (!["hardware_locked", "floating", "named_user"].includes(value.mode)) {
    throw new TypeError("API response license mode is invalid");
  }
  requireSafeText(value.plan_key, "license plan key", { min: 1, max: 255 });
  if (requireActive && value.status !== "active") {
    throw new TypeError("API response does not describe an active license");
  }
  const now = Date.now();
  if (value.starts_at != null && requireRfc3339(value.starts_at, "license start") > now + 300_000) {
    throw new TypeError("License is not active yet");
  }
  if (value.expires_at != null && requireRfc3339(value.expires_at, "license expiry") <= now) {
    if (requireActive) throw new TypeError("License has expired");
  }
  if (value.seat_limit != null && (!Number.isSafeInteger(value.seat_limit) || value.seat_limit <= 0)) {
    throw new TypeError("License seat_limit is invalid");
  }
  if (!Number.isSafeInteger(value.active_seats) || value.active_seats < 0) {
    throw new TypeError("License active_seats is invalid");
  }
  const activeEntitlements = validateOnlineEntitlements(value.active_entitlements ?? []);
  const metadata = value.metadata == null ? {} : cloneBoundedJson(value.metadata);
  return { ...value, active_entitlements: activeEntitlements, metadata };
}

function responseFingerprint(value) {
  if (!isRecord(value)) return null;
  const candidates = [value.fingerprint, value.device_id, value.device_fingerprint].filter(
    (candidate) => candidate !== undefined && candidate !== null
  );
  if (candidates.length === 0) return null;
  const first = requireFingerprint(candidates[0]);
  if (candidates.some((candidate) => !constantTimeEqual(first, requireFingerprint(candidate)))) {
    throw new TypeError("API response contains conflicting device fingerprints");
  }
  return first;
}

export function validateActivationResponse(value, context) {
  if (!isRecord(value) || value.object !== "activation") {
    throw new TypeError("Invalid activation response object");
  }
  requireIdentifier(value.id, "activation ID");
  requireLicenseKey(value.license_key);
  if (!constantTimeEqual(value.license_key, context.licenseKey)) {
    throw new TypeError("Activation response license identity mismatch");
  }
  const fingerprint = responseFingerprint(value);
  if (!fingerprint || !constantTimeEqual(fingerprint, context.fingerprint)) {
    throw new TypeError("Activation response device identity mismatch");
  }
  requireRfc3339(value.activated_at, "activation timestamp");
  if (value.deactivated_at != null) {
    requireRfc3339(value.deactivated_at, "deactivation timestamp");
    throw new TypeError("Activation response is already deactivated");
  }
  const metadata = value.metadata == null ? {} : cloneBoundedJson(value.metadata);
  const license = validateLicenseObject(
    value.license,
    context.licenseKey,
    context.productSlug,
    true
  );
  return { ...value, fingerprint, device_id: fingerprint, metadata, license };
}

export function validateValidationResponse(value, context) {
  if (!isRecord(value) || value.object !== "validation_result" || typeof value.valid !== "boolean") {
    throw new TypeError("Invalid validation response object");
  }
  const license = value.license == null
    ? null
    : validateLicenseObject(value.license, context.licenseKey, context.productSlug, value.valid);
  if (value.valid && !license) throw new TypeError("Valid response is missing license data");
  let code;
  if (value.code != null) {
    code = requireSafeText(value.code, "validation code", { min: 1, max: 100 });
  }
  let message;
  if (value.message != null) {
    message = requireSafeText(value.message, "validation message", {
      min: 1,
      max: 2048,
    });
  }
  let activation = value.activation ?? null;
  if (activation != null) {
    if (!isRecord(activation) || activation.object !== "activation") {
      throw new TypeError("Validation activation is invalid");
    }
    requireIdentifier(activation.id, "validation activation ID");
    requireLicenseKey(activation.license_key);
    if (!constantTimeEqual(activation.license_key, context.licenseKey)) {
      throw new TypeError("Validation activation license identity mismatch");
    }
    requireRfc3339(activation.activated_at, "validation activation timestamp");
    if (activation.deactivated_at != null) {
      throw new TypeError("Validation activation is deactivated");
    }
    const fingerprint = responseFingerprint(activation);
    if (!fingerprint || !constantTimeEqual(fingerprint, context.fingerprint)) {
      throw new TypeError("Validation response device identity mismatch");
    }
    const metadata = activation.metadata == null ? {} : cloneBoundedJson(activation.metadata);
    activation = { ...activation, fingerprint, device_id: fingerprint, metadata };
  }
  const warnings = value.warnings == null
    ? undefined
    : (() => {
        if (!Array.isArray(value.warnings) || value.warnings.length > 100) {
          throw new TypeError("Validation warnings are invalid");
        }
        return value.warnings.map((warning) => {
          if (!isRecord(warning)) throw new TypeError("Validation warning is invalid");
          return {
            code: requireSafeText(warning.code, "warning code", { min: 1, max: 100 }),
            message: requireSafeText(warning.message, "warning message", { min: 1, max: 1024 }),
          };
        });
      })();
  if (!value.valid) {
    if (!code) throw new TypeError("Invalid validation response is missing a code");
  }
  return {
    valid: value.valid,
    ...(code ? { code } : {}),
    ...(message ? { message } : {}),
    ...(warnings ? { warnings } : {}),
    ...(license ? { license } : {}),
    ...(activation ? { activation } : {}),
    active_entitlements: value.valid ? license.active_entitlements : [],
  };
}

export function validateHeartbeatResponse(value, context) {
  if (!isRecord(value) || value.object !== "heartbeat") {
    throw new TypeError("Invalid heartbeat response object");
  }
  requireRfc3339(value.received_at, "heartbeat timestamp");
  const license = validateLicenseObject(
    value.license,
    context.licenseKey,
    context.productSlug,
    true
  );
  return { ...value, license };
}

export function validateDeactivationResponse(value, expectedActivationId) {
  if (!isRecord(value) || value.object !== "deactivation") {
    throw new TypeError("Invalid deactivation response object");
  }
  requireIdentifier(value.activation_id, "deactivation activation ID");
  if (
    expectedActivationId != null &&
    String(value.activation_id) !== String(expectedActivationId)
  ) {
    throw new TypeError("Deactivation response activation identity mismatch");
  }
  requireRfc3339(value.deactivated_at, "deactivation timestamp");
  return value;
}

export function validateSigningKeyResponse(value, expectedKeyId) {
  if (
    !isRecord(value) ||
    value.object !== "signing_key" ||
    value.algorithm !== "Ed25519" ||
    !constantTimeEqual(requireKeyId(value.key_id), expectedKeyId) ||
    value.status !== "active"
  ) {
    throw new TypeError("Invalid or revoked signing key response");
  }
  base64UrlDecode(value.public_key, { expectedBytes: 32, maxBytes: 32 });
  if (value.created_at != null) requireRfc3339(value.created_at, "signing key creation timestamp");
  return value;
}

function requireExactKeys(value, allowed, name) {
  const allowedSet = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedSet.has(key))) {
    throw new TypeError(`${name} contains unsupported fields`);
  }
}

/**
 * Validate the signed envelope and prove that its visible token is exactly the
 * value represented by the signed canonical JSON bytes.
 */
export function validateOfflineEnvelope(value) {
  value = cloneBoundedJson(value, {
    maxDepth: 32,
    maxNodes: 20_000,
    maxObjectKeys: 1_000,
    maxArrayLength: 5_000,
    maxStringBytes: 256 * 1024,
    maxKeyBytes: 255,
  });
  if (!isRecord(value)) throw new TypeError("Offline token must be an object");
  requireExactKeys(value, ["object", "token", "signature", "canonical"], "Offline token");
  if (value.object !== "offline_token" || !isRecord(value.token) || !isRecord(value.signature)) {
    throw new TypeError("Invalid offline token envelope");
  }
  requireExactKeys(value.signature, ["algorithm", "key_id", "value"], "Signature block");
  if (value.signature.algorithm !== "Ed25519") throw new TypeError("Unsupported signature algorithm");
  const keyId = requireKeyId(value.signature.key_id);
  if (!constantTimeEqual(keyId, requireKeyId(value.token.kid))) {
    throw new TypeError("Signature key ID does not match the token");
  }
  base64UrlDecode(value.signature.value, { expectedBytes: 64, maxBytes: 64 });
  requireSafeText(value.canonical, "canonical token", {
    min: 2,
    max: MAX_RESPONSE_BYTES,
  });
  const signedValue = parseStrictJson(value.canonical, {
    maxBytes: MAX_RESPONSE_BYTES,
    maxDepth: 32,
    maxNodes: 20_000,
    maxStringLength: 256 * 1024,
  });
  if (!isRecord(signedValue) || !equalJsonValues(signedValue, value.token)) {
    throw new TypeError("Canonical signed payload does not match token data");
  }
  return { ...value, token: signedValue };
}

export function validateOfflineClaims(envelope, context) {
  const token = envelope.token;
  requireExactKeys(
    token,
    [
      "schema_version",
      "license_key",
      "product_slug",
      "plan_key",
      "mode",
      "seat_limit",
      "fingerprint",
      "device_id",
      "device_fingerprint",
      "iat",
      "exp",
      "nbf",
      "license_expires_at",
      "kid",
      "entitlements",
      "metadata",
    ],
    "Offline token payload"
  );
  if (token.schema_version !== 1) throw new TypeError("Unsupported offline token schema version");
  requireLicenseKey(token.license_key);
  requireProductSlug(token.product_slug);
  if (!constantTimeEqual(token.license_key, context.licenseKey)) {
    throw new TypeError("Offline token license identity mismatch");
  }
  if (!constantTimeEqual(token.product_slug, context.productSlug)) {
    throw new TypeError("Offline token product identity mismatch");
  }
  requireSafeText(token.plan_key, "offline plan key", { min: 1, max: 255 });
  if (!["hardware_locked", "floating", "named_user"].includes(token.mode)) {
    throw new TypeError("Offline token license mode is invalid");
  }
  if (token.seat_limit != null && (!Number.isSafeInteger(token.seat_limit) || token.seat_limit <= 0)) {
    throw new TypeError("Offline token seat limit is invalid");
  }
  const fingerprint = responseFingerprint(token);
  if (!fingerprint || !constantTimeEqual(fingerprint, context.fingerprint)) {
    throw new TypeError("Offline token device identity mismatch");
  }
  for (const name of ["iat", "nbf", "exp"]) {
    if (!Number.isSafeInteger(token[name]) || token[name] < 0) {
      throw new TypeError(`Offline token ${name} claim is invalid`);
    }
  }
  if (!(token.iat <= token.nbf && token.nbf <= token.exp)) {
    throw new TypeError("Offline token time claims are inconsistent");
  }
  if (token.exp - token.iat > MAX_TOKEN_LIFETIME_SECONDS) {
    throw new TypeError("Offline token lifetime is excessive");
  }
  const now = Math.floor(context.nowMs / 1000);
  const skew = Math.floor(context.maxClockSkewMs / 1000);
  if (token.iat > now + skew || token.nbf > now + skew) {
    throw new TypeError("Offline token is not yet valid");
  }
  if (token.exp <= now) throw new TypeError("Offline token has expired");
  if (
    token.license_expires_at != null &&
    (!Number.isSafeInteger(token.license_expires_at) ||
      token.license_expires_at <= token.iat ||
      token.license_expires_at <= now)
  ) {
    throw new TypeError("Offline token license expiry is invalid or expired");
  }
  if (!Number.isSafeInteger(context.maxOfflineDays) || context.maxOfflineDays <= 0) {
    throw new TypeError("Offline validation is disabled by local policy");
  }
  if (now > token.iat + context.maxOfflineDays * 86_400) {
    throw new TypeError("Local offline grace period has expired");
  }
  if (!Array.isArray(token.entitlements) || token.entitlements.length > 500) {
    throw new TypeError("Offline token entitlements are invalid");
  }
  const seen = new Set();
  const activeEntitlements = [];
  for (const entry of token.entitlements) {
    if (!isRecord(entry)) throw new TypeError("Offline entitlement is invalid");
    requireExactKeys(entry, ["key", "expires_at"], "Offline entitlement");
    const key = requireSafeText(entry.key, "offline entitlement key", { min: 1, max: 100 });
    if (seen.has(key)) throw new TypeError("Offline token has duplicate entitlements");
    seen.add(key);
    if (entry.expires_at != null && (!Number.isSafeInteger(entry.expires_at) || entry.expires_at <= token.iat)) {
      throw new TypeError("Offline entitlement expiry is invalid");
    }
    if (entry.expires_at == null || entry.expires_at > now) {
      activeEntitlements.push({
        key,
        expires_at: entry.expires_at == null
          ? null
          : new Date(entry.expires_at * 1000).toISOString(),
        metadata: null,
      });
    }
  }
  if (token.metadata != null) cloneBoundedJson(token.metadata);
  return {
    valid: true,
    offline: true,
    license: {
      object: "license",
      key: token.license_key,
      status: "active",
      mode: token.mode,
      plan_key: token.plan_key,
      seat_limit: token.seat_limit ?? null,
      active_seats: 1,
      active_entitlements: activeEntitlements,
      metadata: token.metadata ?? {},
      product: { object: "product", slug: token.product_slug, name: token.product_slug },
    },
    active_entitlements: activeEntitlements,
  };
}

export async function readBoundedResponseText(response, maximumBytes) {
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    if (!/^\d+$/.test(declared) || Number(declared) > maximumBytes) {
      throw new TypeError("API response exceeds the configured size limit");
    }
  }
  if (!response.body || typeof response.body.getReader !== "function") {
    const text = await response.text();
    if (byteLength(text) > maximumBytes) {
      throw new TypeError("API response exceeds the configured size limit");
    }
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let total = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new TypeError("API response exceeds the configured size limit");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    reader.releaseLock();
  }
}

export function parseApiJson(text, maximumBytes = MAX_RESPONSE_BYTES) {
  return parseStrictJson(text, {
    maxBytes: maximumBytes,
    maxDepth: 32,
    maxNodes: 20_000,
    maxStringLength: 256 * 1024,
  });
}

export function redactForLog(value, secrets = [], depth = 0, seen = new WeakSet()) {
  if (depth > 4) return "[TRUNCATED]";
  if (typeof value === "string") {
    let result = value.slice(0, 2048);
    for (const secret of secrets) {
      if (typeof secret === "string" && secret.length >= 4) result = result.split(secret).join("[REDACTED]");
    }
    return result;
  }
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Error) {
    const enrichedError = /** @type {Error & {status?: number, code?: string}} */ (value);
    return {
      name: value.name,
      message: redactForLog(value.message, secrets, depth + 1, seen),
      ...(Number.isInteger(enrichedError.status) ? { status: enrichedError.status } : {}),
      ...(typeof enrichedError.code === "string" ? { code: enrichedError.code } : {}),
    };
  }
  if (typeof value !== "object") return `[${typeof value}]`;
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((entry) => redactForLog(entry, secrets, depth + 1, seen));
  }
  const result = {};
  for (const key of Object.keys(value).slice(0, 50)) {
    result[key] = SENSITIVE_FIELD.test(key)
      ? "[REDACTED]"
      : redactForLog(value[key], secrets, depth + 1, seen);
  }
  return result;
}
