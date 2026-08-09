import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { http, HttpResponse } from "msw";

import { LicenseSeatSDK } from "../src/LicenseSeat.js";
import { APIError, CryptoError, LicenseError } from "../src/errors.js";
import {
  buildMockOfflineToken,
  mockActivationResponse,
  mockData,
  mockLicenseObject,
  mockSigningKeyResponse,
  mockValidValidationResponse,
} from "./mocks/handlers.js";
import { server } from "./mocks/server.js";

const API_BASE = "https://licenseseat.com/api/v1";
const crossLanguageFixture = JSON.parse(readFileSync(
  resolve("tests/fixtures/ruby_signed_offline_token.json"),
  "utf8"
));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function validActivation(fingerprint = mockData.deviceId) {
  return {
    ...mockActivationResponse,
    fingerprint,
    license: { ...mockLicenseObject },
  };
}

describe("SDK security hardening", () => {
  const instances = [];

  function sdk(overrides = {}) {
    const instance = new LicenseSeatSDK({
      apiKey: mockData.apiKey,
      productSlug: mockData.productSlug,
      autoInitialize: false,
      autoValidateInterval: 0,
      heartbeatInterval: 0,
      networkRecheckInterval: 0,
      maxRetries: 0,
      retryDelay: 0,
      telemetryEnabled: false,
      ...overrides,
    });
    instances.push(instance);
    return instance;
  }

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    for (const instance of instances.splice(0)) instance.destroy();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("keeps credentials out of URLs and binds every fingerprint alias in the body", async () => {
    let observed;
    server.use(http.post(`${API_BASE}/products/:slug/licenses/activate`, async ({ request }) => {
      observed = {
        url: request.url,
        authorization: request.headers.get("authorization"),
        body: await request.json(),
      };
      return HttpResponse.json(validActivation(mockData.deviceId), { status: 201 });
    }));

    await sdk().activate(mockData.validLicenseKey, { deviceId: mockData.deviceId });

    expect(observed.url).toBe(`${API_BASE}/products/${mockData.productSlug}/licenses/activate`);
    expect(observed.url).not.toContain(mockData.validLicenseKey);
    expect(observed.authorization).toBe(`Bearer ${mockData.apiKey}`);
    expect(observed.body).toMatchObject({
      license_key: mockData.validLicenseKey,
      fingerprint: mockData.deviceId,
      device_id: mockData.deviceId,
      device_fingerprint: mockData.deviceId,
    });
  });

  it("does not send bearer credentials to public health or signing-key endpoints", async () => {
    const headers = [];
    server.use(
      http.get(`${API_BASE}/health`, ({ request }) => {
        headers.push(request.headers.get("authorization"));
        return HttpResponse.json({ object: "health", status: "healthy" });
      }),
      http.get(`${API_BASE}/signing_keys/:keyId`, ({ request }) => {
        headers.push(request.headers.get("authorization"));
        return HttpResponse.json(mockSigningKeyResponse);
      })
    );
    const instance = sdk();

    await instance.apiCall("/health", { authenticated: false, retryable: false });
    await instance.getSigningKey(mockData.keyId);

    expect(headers).toEqual([null, null]);
  });

  it("uses a protected endpoint for testAuth and rejects a public-shaped response", async () => {
    let authorization;
    server.use(http.get(`${API_BASE}/auth`, ({ request }) => {
      authorization = request.headers.get("authorization");
      return HttpResponse.json({ object: "health", status: "healthy" });
    }));
    const instance = sdk();

    await expect(instance.testAuth()).rejects.toMatchObject({ status: 502 });
    expect(authorization).toBe(`Bearer ${mockData.apiKey}`);
  });

  it.each([
    [() => ({ ...validActivation(), fingerprint: "attacker-device-123" }), "device identity"],
    [() => ({ ...validActivation(), license_key: "LS-OTHER" }), "license identity"],
    [() => ({
      ...validActivation(),
      license: {
        ...mockLicenseObject,
        product: { ...mockLicenseObject.product, slug: "other-product" },
      },
    }), "product identity"],
  ])("rejects confused activation authority %#", async (responseFactory, message) => {
    server.use(http.post(`${API_BASE}/products/:slug/licenses/activate`, () =>
      HttpResponse.json(responseFactory(), { status: 201 })
    ));
    const instance = sdk();

    await expect(instance.activate(mockData.validLicenseKey, {
      deviceId: mockData.deviceId,
    })).rejects.toThrow(message);
    expect(instance.getStatus().status).toBe("inactive");
    expect(instance.hasEntitlement("pro")).toBe(false);
  });

  it("revokes in-memory entitlements on an explicit invalid validation", async () => {
    const instance = sdk();
    await instance.activate(mockData.validLicenseKey, { deviceId: mockData.deviceId });
    expect(instance.hasEntitlement("pro")).toBe(true);
    server.use(http.post(`${API_BASE}/products/:slug/licenses/validate`, () =>
      HttpResponse.json({
        object: "validation_result",
        valid: false,
        code: "license_revoked",
        message: "Revoked",
        license: null,
        activation: null,
      })
    ));

    const result = await instance.validateLicense(mockData.validLicenseKey);

    expect(result.valid).toBe(false);
    expect(instance.hasEntitlement("pro")).toBe(false);
    expect(instance.getStatus().status).toBe("invalid");
    expect(instance.validationTimer).toBeNull();
    expect(instance.heartbeatTimer).toBeNull();
  });

  it("never grants authority from attacker-writable cached validation data", () => {
    localStorage.setItem("forged_license", JSON.stringify({
      license_key: mockData.validLicenseKey,
      device_id: mockData.deviceId,
      activated_at: new Date().toISOString(),
      last_validated: new Date().toISOString(),
      validation: {
        valid: true,
        active_entitlements: [{ key: "everything", expires_at: null }],
      },
    }));
    const instance = sdk({
      apiKey: null,
      storagePrefix: "forged_",
    });

    instance.initialize();

    expect(instance.getStatus().status).toBe("pending");
    expect(instance.hasEntitlement("everything")).toBe(false);
  });

  it("never treats a persisted public key as an offline trust anchor", async () => {
    const prefix = "substitution_";
    const token = buildMockOfflineToken(mockData.validLicenseKey, mockData.deviceId);
    localStorage.setItem(`${prefix}license`, JSON.stringify({
      license_key: mockData.validLicenseKey,
      device_id: mockData.deviceId,
      activated_at: new Date().toISOString(),
      last_validated: new Date().toISOString(),
    }));
    localStorage.setItem(`${prefix}offline_token`, JSON.stringify(token));
    localStorage.setItem(`${prefix}public_keys`, JSON.stringify({
      [mockData.keyId]: mockData.publicKey,
    }));
    const instance = sdk({
      apiKey: null,
      storagePrefix: prefix,
      offlineFallbackEnabled: true,
      maxOfflineDays: 30,
    });

    const result = await instance.verifyCachedOffline();

    expect(result).toMatchObject({ valid: false, code: "untrusted_public_key" });
    expect(instance.hasEntitlement("pro")).toBe(false);
  });

  it("rejects visible offline-token substitution even when the canonical signature bytes are unchanged", async () => {
    const token = buildMockOfflineToken(mockData.validLicenseKey, mockData.deviceId);
    token.token.license_key = "LS-STOLEN-KEY";
    const instance = sdk();

    await expect(instance.verifyOfflineToken(token, mockData.publicKey)).rejects.toThrow(
      "does not match token data"
    );
  });

  it("verifies the deterministic Ruby-signed cross-language fixture", async () => {
    const token = crossLanguageFixture.offline_token;
    const instance = sdk({
      productSlug: token.token.product_slug,
      storagePrefix: "cross_language_fixture_",
      offlineFallbackEnabled: true,
      maxOfflineDays: 36_600,
      signingPublicKeys: {
        [token.signature.key_id]: crossLanguageFixture.public_key,
      },
    });
    const identity = {
      license_key: token.token.license_key,
      device_id: token.token.fingerprint,
      activated_at: new Date().toISOString(),
      last_validated: new Date().toISOString(),
    };
    instance.currentLicense = identity;
    instance.cache.setLicense(identity);
    instance.cache.setOfflineToken(token);

    await expect(instance.verifyOfflineToken(
      token,
      crossLanguageFixture.public_key
    )).resolves.toBe(true);
    await expect(instance.verifyCachedOffline()).resolves.toMatchObject({
      valid: true,
      offline: true,
      active_entitlements: [{ key: "pro", expires_at: null }],
    });
  });

  it("preparing verified offline assets does not downgrade fresh online authorization", async () => {
    const instance = sdk({
      offlineFallbackEnabled: true,
      maxOfflineDays: 30,
    });
    await instance.activate(mockData.validLicenseKey, { deviceId: mockData.deviceId });

    await vi.waitFor(() => {
      expect(instance.syncingOfflineAssets).toBe(false);
      expect(instance.cache.getOfflineToken()).not.toBeNull();
    });

    expect(instance.getStatus().status).toBe("active");
    expect(instance.trustedValidation.offline).not.toBe(true);
  });

  it("rejects key material changes for an already trusted key ID", async () => {
    const instance = sdk();
    await instance.getSigningKey(mockData.keyId);
    server.use(http.get(`${API_BASE}/signing_keys/:keyId`, () =>
      HttpResponse.json({
        ...mockSigningKeyResponse,
        public_key: Buffer.alloc(32, 55).toString("base64"),
      })
    ));

    await expect(instance.getSigningKey(mockData.keyId)).rejects.toBeInstanceOf(CryptoError);
  });

  it("rejects duplicate JSON keys, non-JSON content, oversized bodies, and redirects", async () => {
    const instance = sdk({ maxResponseBytes: 1024 });

    server.use(http.get(`${API_BASE}/health`, () => new HttpResponse(
      '{"status":"healthy","status":"compromised"}',
      { headers: { "content-type": "application/json" } }
    )));
    await expect(instance.apiCall("/health", {
      authenticated: false,
      retryable: false,
    })).rejects.toMatchObject({ status: 502, data: { error: { code: "invalid_response" } } });

    server.use(http.get(`${API_BASE}/health`, () => HttpResponse.text("not json")));
    await expect(instance.apiCall("/health", {
      authenticated: false,
      retryable: false,
    })).rejects.toMatchObject({ status: 502 });

    server.use(http.get(`${API_BASE}/health`, () => new HttpResponse("{}", {
      headers: { "content-type": "application/json", "content-length": "9999" },
    })));
    await expect(instance.apiCall("/health", {
      authenticated: false,
      retryable: false,
    })).rejects.toMatchObject({ status: 502 });

    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", {
      status: 302,
      headers: { "content-type": "application/json", location: "https://attacker.invalid" },
    })));
    await expect(instance.apiCall("/health", {
      authenticated: false,
      retryable: false,
    })).rejects.toMatchObject({ status: 302 });
  });

  it("applies the deadline to response-body streaming, not only response headers", async () => {
    const body = new ReadableStream({ start() {} });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, {
      status: 200,
      headers: { "content-type": "application/json" },
    })));
    const instance = sdk({ requestTimeoutMs: 10 });

    await expect(instance.apiCall("/health", {
      authenticated: false,
      retryable: false,
    })).rejects.toMatchObject({ status: 0, data: { error: { code: "request_timeout" } } });
  });

  it("preserves an HTTP denial when its error message has an adversarial type", async () => {
    server.use(http.post(`${API_BASE}/products/:slug/licenses/validate`, () =>
      HttpResponse.json({
        error: { code: "license_revoked", message: { coercion: "trap" } },
      }, { status: 403 })
    ));
    const instance = sdk();

    await expect(instance.validateLicense(mockData.validLicenseKey, {
      deviceId: mockData.deviceId,
    })).rejects.toMatchObject({ status: 403, message: "Request failed" });
    expect(instance.online).toBe(true);
  });

  it("retries safe probes but never retries ambiguous activation mutations", async () => {
    let probeCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      probeCalls += 1;
      return probeCalls === 1
        ? new Response('{"error":{"code":"temporary","message":"Temporary"}}', {
            status: 500,
            headers: { "content-type": "application/json" },
          })
        : new Response('{"object":"health","status":"healthy"}', {
            status: 200,
            headers: { "content-type": "application/json" },
          });
    }));
    const probeSdk = sdk({ maxRetries: 1 });
    await expect(probeSdk.apiCall("/health", { authenticated: false })).resolves.toMatchObject({
      status: "healthy",
    });
    expect(probeCalls).toBe(2);

    vi.unstubAllGlobals();
    let activationCalls = 0;
    server.use(http.post(`${API_BASE}/products/:slug/licenses/activate`, () => {
      activationCalls += 1;
      return HttpResponse.json({
        error: { code: "temporary", message: "Temporary" },
      }, { status: 500 });
    }));
    const activationSdk = sdk({ maxRetries: 3 });
    await expect(activationSdk.activate(mockData.validLicenseKey, {
      deviceId: mockData.deviceId,
    })).rejects.toMatchObject({ status: 500 });
    expect(activationCalls).toBe(1);
  });

  it("rejects activation completion after reset instead of resurrecting authorization", async () => {
    const gate = deferred();
    server.use(http.post(`${API_BASE}/products/:slug/licenses/activate`, async () => {
      await gate.promise;
      return HttpResponse.json(validActivation(mockData.deviceId), { status: 201 });
    }));
    const instance = sdk();
    const activation = instance.activate(mockData.validLicenseKey, { deviceId: mockData.deviceId });
    instance.reset();
    gate.resolve();

    await expect(activation).rejects.toMatchObject({ code: "operation_superseded" });
    expect(instance.getStatus().status).toBe("inactive");
  });

  it("rejects an older concurrent validation result", async () => {
    const instance = sdk();
    await instance.activate(mockData.validLicenseKey, { deviceId: mockData.deviceId });
    const gate = deferred();
    let calls = 0;
    server.use(http.post(`${API_BASE}/products/:slug/licenses/validate`, async () => {
      calls += 1;
      if (calls === 1) await gate.promise;
      return HttpResponse.json({
        ...mockValidValidationResponse,
        license: { ...mockLicenseObject },
      });
    }));

    const older = instance.validateLicense(mockData.validLicenseKey);
    const newer = instance.validateLicense(mockData.validLicenseKey);
    await expect(newer).resolves.toMatchObject({ valid: true });
    gate.resolve();
    await expect(older).rejects.toMatchObject({ code: "operation_superseded" });
    expect(instance.hasEntitlement("pro")).toBe(true);
  });

  it("does not let a stale failed heartbeat revoke newly established state", async () => {
    const instance = sdk();
    await instance.activate(mockData.validLicenseKey, { deviceId: mockData.deviceId });
    const gate = deferred();
    server.use(http.post(`${API_BASE}/products/:slug/licenses/heartbeat`, async () => {
      await gate.promise;
      return HttpResponse.json({
        error: { code: "temporary", message: "Temporary" },
      }, { status: 500 });
    }));

    const staleHeartbeat = instance.heartbeat();
    instance.reset();
    await instance.activate(mockData.validLicenseKey, { deviceId: mockData.deviceId });
    gate.resolve();
    await expect(staleHeartbeat).rejects.toBeInstanceOf(APIError);
    expect(instance.getStatus().status).toBe("active");
    expect(instance.hasEntitlement("pro")).toBe(true);
  });

  it("validates operation options and never invokes option accessors", async () => {
    const instance = sdk();
    const options = {};
    const getter = vi.fn(() => mockData.deviceId);
    Object.defineProperty(options, "deviceId", { enumerable: true, get: getter });

    await expect(instance.activate(mockData.validLicenseKey, options)).rejects.toThrow("accessors");
    expect(getter).not.toHaveBeenCalled();
    await expect(instance.activate(mockData.validLicenseKey, { typo: true })).rejects.toThrow(
      "Unknown activation options field"
    );
    await expect(instance.activate(mockData.validLicenseKey, { metadata: [] })).rejects.toThrow(
      "metadata must be an object"
    );
  });

  it("redacts API keys and license keys from debug logs and listener failures", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const instance = sdk({ debug: true });
    instance.on("activation:start", () => {
      throw new Error(`listener exposed ${mockData.apiKey} ${mockData.validLicenseKey}`);
    });

    await instance.activate(mockData.validLicenseKey, { deviceId: mockData.deviceId });

    const output = JSON.stringify([...log.mock.calls, ...error.mock.calls]);
    expect(output).not.toContain(mockData.apiKey);
    expect(output).not.toContain(mockData.validLicenseKey);
    expect(output).toContain("[REDACTED]");
  });

  it("fails closed on all public operations after destruction", () => {
    const instance = sdk();
    instance.destroy();

    expect(() => instance.getStatus()).toThrow(LicenseError);
    expect(() => instance.on("test:event", () => {})).toThrow("destroyed");
    expect(() => instance.reset()).toThrow("destroyed");
  });
});
