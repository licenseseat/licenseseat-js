import { afterEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";

import { LicenseSeatSDK } from "../src/LicenseSeat.js";
import { APIError, ConfigurationError } from "../src/errors.js";
import {
  buildMockOfflineToken,
  mockData,
  mockLicenseObject,
  mockValidValidationResponse,
} from "./mocks/handlers.js";
import { server } from "./mocks/server.js";

const API_BASE = "https://licenseseat.com/api/v1";

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("SDK lifecycle security", () => {
  const instances = [];

  function create(overrides = {}) {
    const instance = new LicenseSeatSDK({
      apiKey: mockData.apiKey,
      productSlug: mockData.productSlug,
      autoInitialize: false,
      autoValidateInterval: 0,
      heartbeatInterval: 0,
      networkRecheckInterval: 0,
      offlineLicenseRefreshInterval: 0,
      maxRetries: 0,
      retryDelay: 0,
      telemetryEnabled: false,
      ...overrides,
    });
    instances.push(instance);
    return instance;
  }

  async function prepareOffline(prefix = "offline_") {
    const instance = create({
      storagePrefix: prefix,
      offlineFallbackEnabled: true,
      maxOfflineDays: 30,
      signingPublicKeys: { [mockData.keyId]: mockData.publicKey },
    });
    await instance.activate(mockData.validLicenseKey, { deviceId: mockData.deviceId });
    await vi.waitFor(() => {
      expect(instance.syncingOfflineAssets).toBe(false);
      expect(instance.cache.getOfflineToken()).not.toBeNull();
    });
    return instance;
  }

  afterEach(() => {
    for (const instance of instances.splice(0)) instance.destroy();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("revalidates cached identity online before restoring authority", async () => {
    localStorage.setItem("restore_license", JSON.stringify({
      license_key: mockData.validLicenseKey,
      device_id: mockData.deviceId,
      activated_at: new Date().toISOString(),
      last_validated: new Date().toISOString(),
      validation: { valid: true, active_entitlements: [{ key: "forged" }] },
    }));
    const instance = create({
      storagePrefix: "restore_",
      autoInitialize: true,
    });

    expect(instance.hasEntitlement("forged")).toBe(false);
    await vi.waitFor(() => expect(instance.getStatus().status).toBe("active"));
    expect(instance.hasEntitlement("pro")).toBe(true);
    instance.initialize();
    expect(instance.initialized).toBe(true);
  });

  it("restores offline authority across reloads only with an explicitly pinned key", async () => {
    const first = await prepareOffline("pinned_reload_");
    first.destroy();
    const reloaded = create({
      apiKey: null,
      storagePrefix: "pinned_reload_",
      autoInitialize: true,
      offlineFallbackEnabled: true,
      maxOfflineDays: 30,
      signingPublicKeys: { [mockData.keyId]: mockData.publicKey },
    });

    await vi.waitFor(() => expect(reloaded.getStatus().status).toBe("offline-valid"));
    expect(reloaded.hasEntitlement("pro")).toBe(true);
  });

  it("uses signed offline authority only for transport failures", async () => {
    const instance = await prepareOffline("network_fallback_");
    server.use(http.post(`${API_BASE}/products/:slug/licenses/validate`, () => HttpResponse.error()));

    const result = await instance.validateLicense(mockData.validLicenseKey);

    expect(result).toMatchObject({ valid: true, offline: true });
    expect(instance.getStatus().status).toBe("offline-valid");
    expect(instance.hasEntitlement("pro")).toBe(true);
    expect(instance.online).toBe(false);
  });

  it.each([401, 403, 500, 503])(
    "does not hide an explicit HTTP %s denial behind offline fallback",
    async (status) => {
      const instance = await prepareOffline(`denial_${status}_`);
      server.use(http.post(`${API_BASE}/products/:slug/licenses/validate`, () =>
        HttpResponse.json({
          error: { code: status === 503 ? "temporary" : "unauthorized", message: "Denied" },
        }, { status })
      ));

      await expect(instance.validateLicense(mockData.validLicenseKey)).rejects.toMatchObject({ status });
      expect(instance.hasEntitlement("pro")).toBe(false);
    }
  );

  // Cross-SDK contract (licenseseat-swift #26): an authoritative denial is never
  // overridden by the offline grant, not by a later outage and not after a reload.
  describe.each([
    [200, "not_entitled"],
    [200, "version_not_entitled"],
    [200, "product_mismatch"],
    [200, "FLOATING_NOT_IMPLEMENTED"],
    [200, "named_user_not_implemented"],
    [403, "not_entitled"],
    [403, "version_not_entitled"],
    [422, "product_mismatch"],
    [501, "floating_not_implemented"],
    [501, "named_user_not_implemented"],
  ])("authoritative denial %s %s", (status, code) => {
    const denialHandler = () =>
      status === 200
        ? HttpResponse.json({
          object: "validation_result",
          valid: false,
          code,
          message: "Denied by the server",
        })
        : HttpResponse.json({ error: { code, message: "Denied by the server" } }, { status });

    it("is not overridden by the offline grant after an outage or a reload", async () => {
      const prefix = `authoritative_${status}_${code}_`;
      const instance = await prepareOffline(prefix);

      server.use(http.post(`${API_BASE}/products/:slug/licenses/validate`, denialHandler));
      if (status === 200) {
        await expect(instance.validateLicense(mockData.validLicenseKey)).resolves.toMatchObject({ valid: false });
      } else {
        await expect(instance.validateLicense(mockData.validLicenseKey)).rejects.toMatchObject({ status });
      }
      // A denial is not a revocation: the signed grant stays on disk.
      expect(instance.cache.getOfflineToken()).not.toBeNull();

      server.use(http.post(`${API_BASE}/products/:slug/licenses/validate`, () => HttpResponse.error()));
      const duringOutage = await instance.validateLicense(mockData.validLicenseKey).catch((error) => error);
      expect(duringOutage?.valid).not.toBe(true);
      expect(instance.hasEntitlement("pro")).toBe(false);
      await expect(instance.verifyCachedOffline()).resolves.toMatchObject({
        valid: false,
        code: code.toLowerCase(),
      });
      instance.destroy();

      const reloaded = create({
        apiKey: null,
        storagePrefix: prefix,
        autoInitialize: true,
        offlineFallbackEnabled: true,
        maxOfflineDays: 30,
        signingPublicKeys: { [mockData.keyId]: mockData.publicKey },
      });
      await vi.waitFor(() => expect(reloaded.lastOfflineValidation).toBeTruthy());
      expect(reloaded.getStatus().status).not.toBe("offline-valid");
      expect(reloaded.hasEntitlement("pro")).toBe(false);
    });
  });

  it("clears a recorded denial after a successful online validation", async () => {
    const instance = await prepareOffline("denial_cleared_");
    server.use(http.post(`${API_BASE}/products/:slug/licenses/validate`, () =>
      HttpResponse.json({ object: "validation_result", valid: false, code: "not_entitled", message: "Denied" })
    ));
    await instance.validateLicense(mockData.validLicenseKey);
    server.resetHandlers();
    await expect(instance.validateLicense(mockData.validLicenseKey)).resolves.toMatchObject({ valid: true });
    server.use(http.post(`${API_BASE}/products/:slug/licenses/validate`, () => HttpResponse.error()));
    await expect(instance.validateLicense(mockData.validLicenseKey)).resolves.toMatchObject({
      valid: true,
      offline: true,
    });
  });

  it("retires the offline token when a denial cannot be persisted", async () => {
    const instance = await prepareOffline("denial_unpersisted_");
    vi.spyOn(instance.cache, "setLicense").mockImplementation(() => {});
    server.use(http.post(`${API_BASE}/products/:slug/licenses/validate`, () =>
      HttpResponse.json({ object: "validation_result", valid: false, code: "not_entitled", message: "Denied" })
    ));
    await instance.validateLicense(mockData.validLicenseKey);
    expect(instance.cache.getOfflineToken()).toBeNull();
  });

  it("keeps the offline fallback after an unrelated invalid result", async () => {
    const instance = await prepareOffline("non_denial_");
    server.use(http.post(`${API_BASE}/products/:slug/licenses/validate`, () =>
      HttpResponse.json({ object: "validation_result", valid: false, code: "some_other_reason", message: "No" })
    ));
    await instance.validateLicense(mockData.validLicenseKey);
    server.use(http.post(`${API_BASE}/products/:slug/licenses/validate`, () => HttpResponse.error()));
    await expect(instance.validateLicense(mockData.validLicenseKey)).resolves.toMatchObject({
      valid: true,
      offline: true,
    });
  });

  it("detects a persisted clock rollback before granting offline authority", async () => {
    const instance = await prepareOffline("clock_rollback_");
    instance.cache.setLastSeenTimestamp(Date.now() + 3_600_000);

    await expect(instance.verifyCachedOffline()).resolves.toMatchObject({
      valid: false,
      code: "clock_tamper",
    });
  });

  it("clears malformed cached identity and its associated offline token", () => {
    localStorage.setItem("malformed_license", JSON.stringify({
      license_key: "bad\nkey",
      device_id: "short",
      activated_at: "not-a-date",
      last_validated: "not-a-date",
    }));
    localStorage.setItem("malformed_offline_token", JSON.stringify({ forged: true }));
    const instance = create({ apiKey: null, storagePrefix: "malformed_" });

    expect(instance.loadCachedIdentity()).toBeNull();
    expect(instance.cache.getLicense()).toBeNull();
    expect(instance.cache.getOfflineToken()).toBeNull();
  });

  it("returns a stable cryptorandom installation ID and replaces malformed storage", () => {
    const instance = create();
    localStorage.setItem("licenseseat_device_id", "short");

    const first = instance.getOrCreateDeviceId();
    const second = instance.getOrCreateDeviceId();

    expect(first).toMatch(/^web-[0-9a-f-]{36}$/i);
    expect(second).toBe(first);
  });

  it("maps unavailable secure randomness to a configuration failure", () => {
    vi.stubGlobal("crypto", undefined);
    const instance = create();

    expect(() => instance.getOrCreateDeviceId()).toThrow(ConfigurationError);
  });

  it("accepts exact idempotent deactivation errors but not unrelated 404s", async () => {
    const gone = create({ storagePrefix: "gone_" });
    await gone.activate(mockData.validLicenseKey, { deviceId: mockData.deviceId });
    server.use(http.post(`${API_BASE}/products/:slug/licenses/deactivate`, () =>
      HttpResponse.json({
        error: { code: "already_deactivated", message: "Already gone" },
      }, { status: 404 })
    ));
    await expect(gone.deactivate()).resolves.toMatchObject({ object: "deactivation" });
    expect(gone.getStatus().status).toBe("inactive");

    const unrelated = create({ storagePrefix: "unrelated_" });
    await unrelated.activate(mockData.validLicenseKey, { deviceId: mockData.deviceId });
    server.use(http.post(`${API_BASE}/products/:slug/licenses/deactivate`, () =>
      HttpResponse.json({
        error: { code: "route_not_found", message: "Wrong route" },
      }, { status: 404 })
    ));
    await expect(unrelated.deactivate()).rejects.toMatchObject({ status: 404 });
    expect(unrelated.getStatus().status).toBe("active");
  });

  it("rejects a deactivation response for a different activation", async () => {
    const instance = create();
    await instance.activate(mockData.validLicenseKey, { deviceId: mockData.deviceId });
    server.use(http.post(`${API_BASE}/products/:slug/licenses/deactivate`, () =>
      HttpResponse.json({
        object: "deactivation",
        activation_id: 999,
        deactivated_at: new Date().toISOString(),
      })
    ));

    await expect(instance.deactivate()).rejects.toThrow("identity mismatch");
    expect(instance.getStatus().status).toBe("active");
  });

  it("rejects an explicit device switch for current validation and offline issuance", async () => {
    const instance = await prepareOffline("device_binding_");

    await expect(instance.validateLicense(mockData.validLicenseKey, {
      deviceId: "different-device-123",
    })).rejects.toMatchObject({ code: "device_mismatch" });
    await expect(instance.getOfflineToken({
      deviceId: "different-device-123",
    })).rejects.toMatchObject({ code: "device_mismatch" });
  });

  it("revokes current authority when a successful HTTP response has the wrong identity", async () => {
    const instance = create();
    await instance.activate(mockData.validLicenseKey, { deviceId: mockData.deviceId });
    server.use(http.post(`${API_BASE}/products/:slug/licenses/validate`, () =>
      HttpResponse.json({
        ...mockValidValidationResponse,
        license: { ...mockLicenseObject, key: "LS-ATTACKER-KEY" },
      })
    ));

    await expect(instance.validateLicense(mockData.validLicenseKey)).rejects.toThrow("identity");
    expect(instance.hasEntitlement("pro")).toBe(false);
    expect(instance.getStatus().status).toBe("pending");
  });

  it("enforces offline issuance policy and option bounds before network access", async () => {
    const disabled = create();
    await expect(disabled.getOfflineToken()).rejects.toThrow("Offline validation requires");

    const enabled = create({ offlineFallbackEnabled: true, maxOfflineDays: 30 });
    await expect(enabled.getOfflineToken()).rejects.toMatchObject({ code: "no_license" });
    await enabled.activate(mockData.validLicenseKey, { deviceId: mockData.deviceId });
    await expect(enabled.getOfflineToken({ ttlDays: 0 })).rejects.toThrow("ttlDays");
    await expect(enabled.getOfflineToken({ ttlDays: 36_601 })).rejects.toThrow("ttlDays");
    await expect(enabled.getOfflineToken({ typo: true })).rejects.toThrow("Unknown offline token");
  });

  it("returns false and emits no authority for a well-formed but invalid signature", async () => {
    const token = buildMockOfflineToken(mockData.validLicenseKey, mockData.deviceId);
    const bytes = Buffer.from(token.signature.value, "base64");
    bytes[32] ^= 0x01;
    token.signature.value = bytes.toString("base64");
    const instance = create();
    const failed = vi.fn();
    instance.on("offlineToken:verificationFailed", failed);

    await expect(instance.verifyOfflineToken(token, mockData.publicKey)).resolves.toBe(false);
    expect(failed).toHaveBeenCalledWith({ keyId: mockData.keyId });
  });

  it("reports expired and offline status without granting expired entitlements", () => {
    const instance = create();
    instance.currentLicense = {
      license_key: mockData.validLicenseKey,
      device_id: mockData.deviceId,
      activated_at: new Date().toISOString(),
      last_validated: new Date().toISOString(),
    };
    instance.trustedValidation = {
      valid: true,
      offline: true,
      active_entitlements: [{ key: "expired", expires_at: new Date(Date.now() - 1_000).toISOString() }],
    };

    expect(instance.getStatus().status).toBe("offline-valid");
    expect(instance.checkEntitlement("expired")).toMatchObject({ active: false, reason: "expired" });

    instance.trustedValidation = { valid: false, offline: true, code: "expired" };
    expect(instance.getStatus()).toEqual({ status: "offline-invalid", message: "expired" });
  });

  it("bounds event names, callbacks, and listener counts", () => {
    const instance = create();
    expect(() => instance.on("__proto__", () => {})).toThrow("event name");
    expect(() => instance.on("bad event", () => {})).toThrow("event name");
    expect(() => instance.on("valid:event", "not a function")).toThrow("callback");
    for (let index = 0; index < 100; index += 1) instance.on("bounded:event", () => {});
    expect(() => instance.on("bounded:event", () => {})).toThrow("Too many listeners");
    expect(() => instance.off(null, null)).not.toThrow();
  });

  it("prevents overlapping automatic validation and heartbeat cycles", async () => {
    vi.useFakeTimers();
    const instance = create({ autoValidateInterval: 10, heartbeatInterval: 10 });
    instance.currentLicense = {
      license_key: mockData.validLicenseKey,
      device_id: mockData.deviceId,
      activated_at: new Date().toISOString(),
      last_validated: new Date().toISOString(),
    };
    instance.trustedValidation = { valid: true, active_entitlements: [] };
    const validationGate = deferred();
    const validate = vi.spyOn(instance, "validateLicense").mockReturnValue(validationGate.promise);
    const heartbeat = vi.spyOn(instance, "heartbeat").mockResolvedValue({});
    instance.startAutoValidation(mockData.validLicenseKey);
    instance.startHeartbeat();

    await vi.advanceTimersByTimeAsync(35);
    expect(validate).toHaveBeenCalledOnce();
    expect(heartbeat).toHaveBeenCalledTimes(3);
    validationGate.resolve({ valid: true, offline: false });
    await Promise.resolve();
    await Promise.resolve();
    expect(heartbeat).toHaveBeenCalledTimes(4);
  });

  it("revalidates immediately when connectivity returns", async () => {
    vi.useFakeTimers();
    const instance = create({ networkRecheckInterval: 10 });
    instance.online = false;
    instance.currentLicense = {
      license_key: mockData.validLicenseKey,
      device_id: mockData.deviceId,
      activated_at: new Date().toISOString(),
      last_validated: new Date().toISOString(),
    };
    instance.trustedValidation = { valid: true, active_entitlements: [] };
    const apiCall = vi.spyOn(instance, "apiCall").mockResolvedValue({ status: "healthy" });
    const validate = vi.spyOn(instance, "validateLicense").mockResolvedValue({ valid: true });

    instance.startConnectivityPolling();
    await vi.advanceTimersByTimeAsync(10);

    expect(apiCall).toHaveBeenCalledWith("/health", expect.objectContaining({
      authenticated: false,
      manageConnectivity: false,
    }));
    expect(instance.online).toBe(true);
    expect(validate).toHaveBeenCalledWith(mockData.validLicenseKey);
    expect(instance.connectivityTimer).toBeNull();
  });

  it("schedules offline refresh only while local offline policy is enabled", async () => {
    vi.useFakeTimers();
    const instance = create({
      offlineFallbackEnabled: true,
      maxOfflineDays: 30,
      offlineLicenseRefreshInterval: 10,
    });
    const sync = vi.spyOn(instance, "syncOfflineAssets").mockResolvedValue();
    instance.scheduleOfflineRefresh();
    await vi.advanceTimersByTimeAsync(31);
    expect(sync).toHaveBeenCalledTimes(3);
  });

  it("rejects unsafe request paths, methods, authentication, bodies, and retry classes", async () => {
    const instance = create();
    expect(() => instance.buildRequestUrl("https://attacker.invalid")).toThrow("path is invalid");
    expect(() => instance.buildRequestUrl("/../escaped")).toThrow("escaped");
    expect(() => instance.buildRequestUrl("/health?secret=1")).toThrow("path is invalid");
    expect(() => instance.licenseActionPath("../escape")).toThrow("license action");
    await expect(instance.apiCall("/health", { method: "DELETE" })).rejects.toThrow("Unsupported");
    await expect(instance.apiCall("/health", { method: "GET", body: {} })).rejects.toThrow("cannot include a body");

    const noKey = create({ apiKey: null });
    await expect(noKey.apiCall("/health")).rejects.toThrow("API key is required");

    const bounded = create({ maxResponseBytes: 1024 });
    await expect(bounded.apiCall("/health", {
      method: "POST",
      body: { value: "x".repeat(2_000) },
    })).rejects.toThrow("request body exceeds");

    expect(instance.shouldRetryError(new APIError("network", 0))).toBe(true);
    expect(instance.shouldRetryError(new APIError("timeout", 408))).toBe(true);
    expect(instance.shouldRetryError(new APIError("rate", 429))).toBe(true);
    expect(instance.shouldRetryError(new APIError("server", 500))).toBe(true);
    expect(instance.shouldRetryError(new APIError("not implemented", 501))).toBe(false);
    expect(instance.shouldRetryError(new Error("ordinary"))).toBe(false);
  });

  it("sanitizes control characters in server error messages and supports legacy reason codes", async () => {
    const instance = create();
    server.use(http.get(`${API_BASE}/health`, () =>
      HttpResponse.json({
        error: "Denied\nInjected",
        reason_code: "license_revoked",
      }, { status: 422 })
    ));

    let error;
    try {
      await instance.apiCall("/health", { authenticated: false, retryable: false });
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({ status: 422, message: "Denied Injected" });
    expect(instance.isRevocationError(error)).toBe(true);
    expect(instance.isAlreadyGoneError(error)).toBe(true);
  });
});
