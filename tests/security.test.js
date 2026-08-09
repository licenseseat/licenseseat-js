import { describe, expect, it } from "vitest";

import {
  MAX_RESPONSE_BYTES,
  cloneBoundedJson,
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
} from "../src/security.js";

const NOW = Date.now();
const NOW_ISO = new Date(NOW).toISOString();
const LICENSE_KEY = "LS-SECURITY-TEST-KEY";
const PRODUCT_SLUG = "security-product";
const FINGERPRINT = "security-device-123";
const KEY_ID = "offline-key-v1";
const PUBLIC_KEY = Buffer.alloc(32, 7).toString("base64");
const SIGNATURE = Buffer.alloc(64, 9).toString("base64");

const BASE_CONFIG = Object.freeze({
  apiBaseUrl: "https://licenseseat.com/api/v1",
  productSlug: null,
  storagePrefix: "licenseseat_",
  autoValidateInterval: 3_600_000,
  heartbeatInterval: 300_000,
  networkRecheckInterval: 30_000,
  maxRetries: 3,
  retryDelay: 1_000,
  apiKey: null,
  debug: false,
  offlineLicenseRefreshInterval: 259_200_000,
  offlineFallbackEnabled: false,
  maxOfflineDays: 0,
  maxClockSkewMs: 300_000,
  autoInitialize: true,
  telemetryEnabled: true,
  appVersion: null,
  appBuild: null,
  requestTimeoutMs: 15_000,
  maxResponseBytes: MAX_RESPONSE_BYTES,
  allowInsecureHttp: false,
  signingPublicKeys: Object.freeze({}),
});

function licenseObject(overrides = {}) {
  return {
    object: "license",
    key: LICENSE_KEY,
    status: "active",
    starts_at: NOW_ISO,
    expires_at: null,
    mode: "hardware_locked",
    plan_key: "pro",
    seat_limit: 3,
    active_seats: 1,
    active_entitlements: [{ key: "pro", expires_at: null, metadata: { tier: 1 } }],
    metadata: { customer: "example" },
    product: { object: "product", slug: PRODUCT_SLUG, name: "Security Product" },
    ...overrides,
  };
}

function activationResponse(overrides = {}) {
  return {
    object: "activation",
    id: 42,
    fingerprint: FINGERPRINT,
    license_key: LICENSE_KEY,
    activated_at: NOW_ISO,
    deactivated_at: null,
    license: licenseObject(),
    ...overrides,
  };
}

function offlineToken(overrides = {}) {
  const now = Math.floor(NOW / 1000);
  const token = {
    schema_version: 1,
    license_key: LICENSE_KEY,
    product_slug: PRODUCT_SLUG,
    plan_key: "pro",
    mode: "hardware_locked",
    seat_limit: 3,
    fingerprint: FINGERPRINT,
    iat: now,
    nbf: now,
    exp: now + 86_400,
    license_expires_at: null,
    kid: KEY_ID,
    entitlements: [{ key: "pro", expires_at: null }],
    metadata: { tier: "pro" },
    ...overrides,
  };
  return {
    object: "offline_token",
    token,
    signature: { algorithm: "Ed25519", key_id: token.kid, value: SIGNATURE },
    canonical: JSON.stringify(token),
  };
}

const OFFLINE_CONTEXT = Object.freeze({
  licenseKey: LICENSE_KEY,
  productSlug: PRODUCT_SLUG,
  fingerprint: FINGERPRINT,
  nowMs: NOW,
  maxClockSkewMs: 300_000,
  maxOfflineDays: 7,
});

describe("bounded JSON cloning", () => {
  it("deep-clones plain JSON and null-prototype objects", () => {
    const source = Object.assign(Object.create(null), { nested: [1, true, null, "ok"] });
    const cloned = cloneBoundedJson(source);

    expect(cloned).toEqual({ nested: [1, true, null, "ok"] });
    expect(cloned).not.toBe(source);
    expect(cloned.nested).not.toBe(source.nested);
  });

  it.each([
    [Infinity, "finite"],
    [1n, "not JSON-serializable"],
    [undefined, "not JSON-serializable"],
    [new Date(), "plain prototype"],
    [Object.create({ inherited: true }), "plain prototype"],
  ])("rejects non-JSON or surprising values %#", (value, message) => {
    expect(() => cloneBoundedJson(value)).toThrow(message);
  });

  it("rejects accessors, symbols, unsafe keys, cycles, and invalid limits", () => {
    const accessor = {};
    Object.defineProperty(accessor, "value", { enumerable: true, get: () => "secret" });
    expect(() => cloneBoundedJson(accessor)).toThrow("accessors");

    const symbolObject = { ok: true };
    symbolObject[Symbol("hidden")] = true;
    expect(() => cloneBoundedJson(symbolObject)).toThrow("symbol");

    const unsafe = Object.create(null);
    unsafe.constructor = "pollute";
    expect(() => cloneBoundedJson(unsafe)).toThrow("unsafe key");

    const cyclic = {};
    cyclic.self = cyclic;
    expect(() => cloneBoundedJson(cyclic)).toThrow("deeply nested");
    expect(() => cloneBoundedJson({}, { maxDepth: 0 })).toThrow("positive safe integer");
  });

  it("rejects sparse, accessor-backed, extended, and subclassed arrays", () => {
    const sparse = new Array(2);
    sparse[1] = "x";
    expect(() => cloneBoundedJson(sparse)).toThrow("dense");

    const accessor = [1];
    Object.defineProperty(accessor, "0", { enumerable: true, get: () => 1 });
    expect(() => cloneBoundedJson(accessor)).toThrow("accessors");

    const extended = [1];
    extended.extra = true;
    expect(() => cloneBoundedJson(extended)).toThrow("extra keys");

    class CustomArray extends Array {}
    expect(() => cloneBoundedJson(new CustomArray(1))).toThrow("standard Array prototype");
  });

  it("enforces structural and serialized-size limits", () => {
    expect(() => cloneBoundedJson([1, 2], { maxArrayLength: 1 })).toThrow("array is too large");
    expect(() => cloneBoundedJson({ a: 1, b: 2 }, { maxObjectKeys: 1 })).toThrow("too many keys");
    expect(() => cloneBoundedJson({ a: 1 }, { maxKeyBytes: 1 })).not.toThrow();
    expect(() => cloneBoundedJson({ aa: 1 }, { maxKeyBytes: 1 })).toThrow("key is invalid");
    expect(() => cloneBoundedJson("abcd", { maxStringBytes: 3 })).toThrow("too large");
    expect(() => cloneBoundedJson(Array.from({ length: 5 }, () => 1), { maxNodes: 3 })).toThrow("too many values");
    expect(() => cloneBoundedJson("x".repeat(MAX_RESPONSE_BYTES + 1))).toThrow("too large");
  });
});

describe("configuration and identifiers", () => {
  it("normalizes and freezes a secure configuration", () => {
    const config = normalizeConfig(BASE_CONFIG, {
      productSlug: PRODUCT_SLUG,
      apiKey: "api-secret",
      signingPublicKeys: { [KEY_ID]: PUBLIC_KEY },
    });

    expect(config.apiBaseUrl).toBe("https://licenseseat.com/api/v1");
    expect(config.signingPublicKeys[KEY_ID]).toBe(PUBLIC_KEY);
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.signingPublicKeys)).toBe(true);
  });

  it.each([
    [{ unknown: true }, "Unknown SDK configuration"],
    [{ apiBaseUrl: "http://example.com" }, "HTTPS"],
    [{ apiBaseUrl: "http://example.com", allowInsecureHttp: true }, "loopback"],
    [{ apiBaseUrl: "javascript:alert(1)" }, "HTTPS"],
    [{ apiBaseUrl: "https://user:pass@example.com/api" }, "credentials"],
    [{ apiBaseUrl: "https://example.com/api?q=1" }, "query"],
    [{ maxRetries: 11 }, "maxRetries"],
    [{ requestTimeoutMs: 0 }, "requestTimeoutMs"],
    [{ maxResponseBytes: 100 }, "maxResponseBytes"],
    [{ debug: "true" }, "boolean"],
    [{ productSlug: "../escape" }, "productSlug"],
    [{ signingPublicKeys: { [KEY_ID]: "bad" } }, "exactly 32 bytes"],
    [{ signingPublicKeys: new Date() }, "plain object"],
  ])("rejects unsafe configuration %#", (input, message) => {
    expect(() => normalizeConfig(BASE_CONFIG, input)).toThrow(message);
  });

  it("permits explicit HTTP only when the development escape hatch is set", () => {
    const config = normalizeConfig(BASE_CONFIG, {
      apiBaseUrl: "http://127.0.0.1:3000/api/v1/",
      allowInsecureHttp: true,
    });
    expect(config.apiBaseUrl).toBe("http://127.0.0.1:3000/api/v1");
  });

  it("rejects accessor and symbol configuration properties without invoking them", () => {
    const accessor = {};
    const getter = () => {
      throw new Error("must not run");
    };
    Object.defineProperty(accessor, "debug", { enumerable: true, get: getter });
    expect(() => normalizeConfig(BASE_CONFIG, accessor)).toThrow("accessor");

    const symbols = { [Symbol("hidden")]: true };
    expect(() => normalizeConfig(BASE_CONFIG, symbols)).toThrow("symbol");
  });

  it.each([
    [() => requireLicenseKey("bad\nkey"), "licenseKey"],
    [() => requireFingerprint("short"), "fingerprint"],
    [() => requireKeyId("../key"), "key ID"],
    [() => requireProductSlug("product/escape"), "productSlug"],
    [() => requireSafeText("\ud800", "value"), "value"],
  ])("rejects unsafe identifiers %#", (operation, message) => {
    expect(operation).toThrow(message);
  });
});

describe("online response validation", () => {
  const context = { licenseKey: LICENSE_KEY, productSlug: PRODUCT_SLUG, fingerprint: FINGERPRINT };

  it("validates and normalizes activation, validation, heartbeat, and deactivation responses", () => {
    const activation = validateActivationResponse(activationResponse(), context);
    expect(activation.device_id).toBe(FINGERPRINT);
    expect(activation.license.active_entitlements[0]).toEqual({
      key: "pro",
      expires_at: null,
      metadata: { tier: 1 },
    });

    const validation = validateValidationResponse({
      object: "validation_result",
      valid: true,
      license: licenseObject(),
      activation: null,
      warnings: [{ code: "expiring", message: "Soon" }],
    }, context);
    expect(validation.valid).toBe(true);
    expect(validation.warnings).toEqual([{ code: "expiring", message: "Soon" }]);

    expect(validateHeartbeatResponse({
      object: "heartbeat",
      received_at: NOW_ISO,
      license: licenseObject(),
    }, context).license.key).toBe(LICENSE_KEY);

    expect(validateDeactivationResponse({
      object: "deactivation",
      activation_id: 42,
      deactivated_at: NOW_ISO,
    }, 42).activation_id).toBe(42);
  });

  it.each([
    [activationResponse({ license_key: "LS-WRONG" }), "license identity mismatch"],
    [activationResponse({ fingerprint: "wrong-device-123" }), "device identity mismatch"],
    [activationResponse({ deactivated_at: NOW_ISO }), "already deactivated"],
    [activationResponse({ license: licenseObject({ key: "LS-WRONG" }) }), "license identity"],
    [activationResponse({ license: licenseObject({ product: { object: "product", slug: "other", name: "Other" } }) }), "product identity"],
    [activationResponse({ license: licenseObject({ status: "revoked" }) }), "active license"],
    [activationResponse({ license: licenseObject({ starts_at: new Date(NOW + 600_000).toISOString() }) }), "not active yet"],
    [activationResponse({ license: licenseObject({ expires_at: new Date(NOW - 1_000).toISOString() }) }), "expired"],
    [activationResponse({ activated_at: "2026-02-31T00:00:00Z" }), "invalid"],
  ])("rejects confused activation response %#", (response, message) => {
    expect(() => validateActivationResponse(response, context)).toThrow(message);
  });

  it("requires invalid validation responses to carry a bounded reason and no authority", () => {
    const invalid = validateValidationResponse({
      object: "validation_result",
      valid: false,
      code: "revoked",
      message: "License revoked",
      license: null,
      activation: null,
    }, context);
    expect(invalid).toEqual({
      valid: false,
      code: "revoked",
      message: "License revoked",
      active_entitlements: [],
    });

    expect(() => validateValidationResponse({
      object: "validation_result",
      valid: false,
      license: null,
    }, context)).toThrow("missing a code");
  });

  it("rejects response identity conflicts and malformed entitlement authority", () => {
    expect(() => validateValidationResponse({
      object: "validation_result",
      valid: true,
      license: licenseObject(),
      activation: {
        object: "activation",
        id: 42,
        license_key: LICENSE_KEY,
        activated_at: NOW_ISO,
        deactivated_at: null,
        fingerprint: FINGERPRINT,
        device_id: "different-device-123",
      },
    }, context)).toThrow("conflicting device fingerprints");

    expect(() => validateActivationResponse(activationResponse({
      license: licenseObject({
        active_entitlements: [
          { key: "pro", expires_at: null },
          { key: "pro", expires_at: null },
        ],
      }),
    }), context)).toThrow("Duplicate entitlement");
  });

  it("validates immutable signing-key identities", () => {
    const response = {
      object: "signing_key",
      key_id: KEY_ID,
      algorithm: "Ed25519",
      public_key: PUBLIC_KEY,
      status: "active",
    };
    expect(validateSigningKeyResponse(response, KEY_ID)).toBe(response);
    expect(() => validateSigningKeyResponse({ ...response, key_id: "other-key" }, KEY_ID)).toThrow();
    expect(() => validateSigningKeyResponse({ ...response, status: "revoked" }, KEY_ID)).toThrow();
  });
});

describe("offline-token trust boundary", () => {
  it("binds the signed canonical bytes to visible claims and validates local policy", () => {
    const envelope = validateOfflineEnvelope(offlineToken());
    const result = validateOfflineClaims(envelope, OFFLINE_CONTEXT);

    expect(result.valid).toBe(true);
    expect(result.offline).toBe(true);
    expect(result.active_entitlements.map((entry) => entry.key)).toEqual(["pro"]);
  });

  it.each([
    [(value) => { value.token.license_key = "LS-STOLEN"; }, "does not match token"],
    [(value) => { value.signature.key_id = "other-key"; }, "key ID does not match"],
    [(value) => { value.signature.algorithm = "none"; }, "Unsupported signature"],
    [(value) => { value.signature.value = "AA=="; }, "exactly 64 bytes"],
    [(value) => { value.extra = true; }, "unsupported fields"],
    [(value) => { value.canonical = '{"a":1,"a":2}'; }, "Duplicate JSON"],
  ])("rejects offline envelope substitution %#", (mutate, message) => {
    const value = offlineToken();
    mutate(value);
    expect(() => validateOfflineEnvelope(value)).toThrow(message);
  });

  it("rejects accessor-backed envelopes without executing the accessor", () => {
    const value = offlineToken();
    const getter = () => {
      throw new Error("executed");
    };
    Object.defineProperty(value, "token", { enumerable: true, get: getter });
    expect(() => validateOfflineEnvelope(value)).toThrow("accessors");
  });

  it.each([
    [{ license_key: "LS-OTHER" }, {}, "license identity"],
    [{ product_slug: "other-product" }, {}, "product identity"],
    [{ fingerprint: "different-device-123" }, {}, "device identity"],
    [{ schema_version: 2 }, {}, "schema version"],
    [{ mode: "unlimited" }, {}, "mode"],
    [{ iat: Math.floor(NOW / 1000) + 600, nbf: Math.floor(NOW / 1000) + 600 }, {}, "not yet valid"],
    [{ exp: Math.floor(NOW / 1000) - 1 }, {}, "time claims are inconsistent"],
    [{ entitlements: [{ key: "pro", expires_at: null }, { key: "pro", expires_at: null }] }, {}, "duplicate"],
    [{ unexpected: true }, {}, "unsupported fields"],
    [{}, { maxOfflineDays: 0 }, "disabled by local policy"],
    [{ iat: Math.floor(NOW / 1000) - 10 * 86_400 }, {}, "grace period"],
  ])("rejects invalid or mismatched offline claims %#", (claims, context, message) => {
    const envelope = validateOfflineEnvelope(offlineToken(claims));
    expect(() => validateOfflineClaims(envelope, { ...OFFLINE_CONTEXT, ...context })).toThrow(message);
  });
});

describe("bounded API parsing and redaction", () => {
  it("reads ordinary streaming responses and enforces declared and actual sizes", async () => {
    await expect(readBoundedResponseText(new Response('{"ok":true}'), 64)).resolves.toBe('{"ok":true}');
    await expect(readBoundedResponseText(new Response("x", {
      headers: { "content-length": "100" },
    }), 10)).rejects.toThrow("size limit");
    await expect(readBoundedResponseText(new Response("x".repeat(20)), 10)).rejects.toThrow("size limit");
  });

  it("strictly parses API JSON", () => {
    expect(parseApiJson('{"ok":true}')).toEqual({ ok: true });
    expect(() => parseApiJson('{"ok":true,"ok":false}')).toThrow("Duplicate JSON");
  });

  it("redacts secret fields, embedded secret values, errors, cycles, and excessive depth", () => {
    const cyclic = { safe: "prefix-api-secret-suffix", api_key: "api-secret" };
    cyclic.self = cyclic;
    const error = Object.assign(new Error("failed for api-secret"), { status: 401, code: "bad_key" });
    const redacted = redactForLog({ cyclic, error, signature: SIGNATURE }, ["api-secret"]);

    expect(redacted.cyclic.safe).toBe("prefix-[REDACTED]-suffix");
    expect(redacted.cyclic.api_key).toBe("[REDACTED]");
    expect(redacted.cyclic.self).toBe("[CIRCULAR]");
    expect(redacted.signature).toBe("[REDACTED]");
    expect(redacted.error).toMatchObject({ message: "failed for [REDACTED]", status: 401, code: "bad_key" });
  });
});
