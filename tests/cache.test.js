import { describe, expect, it } from "vitest";

import { LicenseCache } from "../src/cache.js";

describe("LicenseCache", () => {
  it.each(["", "ab", "has space", "slash/", "x".repeat(129), null])(
    "rejects unsafe cache prefixes (%s)",
    (prefix) => {
      expect(() => new LicenseCache(prefix)).toThrow("Cache prefix");
    }
  );

  it("stores identity, validation, offline material, and an installation ID", () => {
    const cache = new LicenseCache("secure_");
    const identity = {
      license_key: "LS-CACHE-KEY",
      device_id: "cache-device-123",
      activated_at: "2026-08-09T12:00:00.000Z",
      last_validated: "2026-08-09T12:00:00.000Z",
    };

    cache.setLicense(identity);
    expect(cache.getLicense()).toEqual(identity);
    expect(cache.getDeviceId()).toBe("cache-device-123");

    cache.updateValidation({ valid: true, active_entitlements: [] });
    expect(cache.getLicense().validation.valid).toBe(true);
    expect(Number.isFinite(Date.parse(cache.getLicense().last_validated))).toBe(true);

    cache.setOfflineToken({ object: "offline_token" });
    expect(cache.getOfflineToken()).toEqual({ object: "offline_token" });
    cache.clearOfflineToken();
    expect(cache.getOfflineToken()).toBeNull();

    cache.setInstallationId("installation-device-123");
    expect(cache.getInstallationId()).toBe("installation-device-123");
  });

  it("treats persisted JSON as malformed unless it is bounded and unambiguous", () => {
    const cache = new LicenseCache("hostile_");

    localStorage.setItem("hostile_license", '{"license_key":"one","license_key":"two"}');
    expect(cache.getLicense()).toBeNull();

    localStorage.setItem("hostile_license", "[]");
    expect(cache.getLicense()).toBeNull();

    localStorage.setItem("hostile_offline_token", "null");
    expect(cache.getOfflineToken()).toBeNull();

    localStorage.setItem("hostile_license", "x".repeat(1024 * 1024 + 1));
    expect(cache.getLicense()).toBeNull();
  });

  it("reconstructs cached token claims from their signed canonical payload", () => {
    const cache = new LicenseCache("canonical_");
    cache.setOfflineToken({
      object: "offline_token",
      token: { value: -0 },
      signature: { algorithm: "Ed25519", key_id: "key-v1", value: "signature" },
      canonical: '{"value":-0.0}',
    });

    // JSON storage changes -0 to 0; the canonical signed bytes remain exact.
    expect(Object.is(JSON.parse(localStorage.getItem("canonical_offline_token")).token.value, 0)).toBe(true);
    expect(Object.is(cache.getOfflineToken().token.value, -0)).toBe(true);
  });

  it("fails storage writes closed for cycles and oversized entries", () => {
    const cache = new LicenseCache("bounded_");
    const cyclic = {};
    cyclic.self = cyclic;

    cache.setLicense(cyclic);
    expect(cache.getLicense()).toBeNull();

    cache.setLicense({ value: "x".repeat(1024 * 1024 + 1) });
    expect(cache.getLicense()).toBeNull();
  });

  it("bounds installation IDs and replaces no value implicitly", () => {
    const cache = new LicenseCache("install_");
    cache.setInstallationId("stable-installation-123");
    cache.setInstallationId("x".repeat(256));
    expect(cache.getInstallationId()).toBe("stable-installation-123");

    localStorage.setItem("install_device_id", "x".repeat(256));
    expect(cache.getInstallationId()).toBeNull();
  });

  it("stores public keys in a pollution-safe map and rejects invalid key IDs", () => {
    const cache = new LicenseCache("keys_");
    const publicKey = Buffer.alloc(32, 1).toString("base64");

    cache.setPublicKey("key-v1", publicKey);
    cache.setPublicKey("../escape", "attacker");
    cache.setPublicKey("__proto__", "attacker");
    expect(cache.getPublicKey("key-v1")).toBe(publicKey);
    expect(cache.getPublicKey("../escape")).toBeNull();
    expect(Object.prototype.attacker).toBeUndefined();

    localStorage.setItem("keys_public_keys", '{"safe":"one","safe":"two"}');
    expect(cache.getPublicKey("safe")).toBeNull();
  });

  it("clears exactly the SDK-owned keys and preserves unrelated application data", () => {
    const cache = new LicenseCache("owned_");
    for (const suffix of ["license", "offline_token", "public_keys", "last_seen_ts", "device_id"]) {
      localStorage.setItem(`owned_${suffix}`, "value");
    }
    localStorage.setItem("owned_future_key", "preserve");
    localStorage.setItem("application_data", "preserve");

    cache.clear();

    expect(localStorage.getItem("owned_license")).toBeNull();
    expect(localStorage.getItem("owned_device_id")).toBeNull();
    expect(localStorage.getItem("owned_future_key")).toBe("preserve");
    expect(localStorage.getItem("application_data")).toBe("preserve");
  });

  it("stores only nonnegative safe clock timestamps", () => {
    const cache = new LicenseCache("clock_");
    cache.setLastSeenTimestamp(1_765_000_000_000);
    expect(cache.getLastSeenTimestamp()).toBe(1_765_000_000_000);

    for (const invalid of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      cache.setLastSeenTimestamp(invalid);
      expect(cache.getLastSeenTimestamp()).toBe(1_765_000_000_000);
    }

    localStorage.setItem("clock_last_seen_ts", "1e3");
    expect(cache.getLastSeenTimestamp()).toBeNull();
    localStorage.setItem("clock_last_seen_ts", "9999999999999999");
    expect(cache.getLastSeenTimestamp()).toBeNull();
  });

  it("degrades safely when every storage operation throws", () => {
    const originalStorage = globalThis.localStorage;
    const throwingStorage = {
      getItem() { throw new Error("blocked"); },
      setItem() { throw new Error("blocked"); },
      removeItem() { throw new Error("blocked"); },
    };
    globalThis.localStorage = throwingStorage;
    try {
      const cache = new LicenseCache("blocked_");
      expect(cache.getLicense()).toBeNull();
      expect(cache.getInstallationId()).toBeNull();
      expect(cache.getLastSeenTimestamp()).toBeNull();
      expect(() => cache.setLicense({ ok: true })).not.toThrow();
      expect(() => cache.setInstallationId("blocked-device-123")).not.toThrow();
      expect(() => cache.clearLicense()).not.toThrow();
      expect(() => cache.clearOfflineToken()).not.toThrow();
      expect(() => cache.clear()).not.toThrow();
      expect(() => cache.setLastSeenTimestamp(1)).not.toThrow();
    } finally {
      globalThis.localStorage = originalStorage;
    }
  });
});
