import { afterEach, describe, expect, it, vi } from "vitest";

import LicenseSeat, * as api from "../src/index.js";

describe("package entrypoint", () => {
  afterEach(() => {
    api.resetSharedInstance();
    vi.restoreAllMocks();
  });

  it("exports the supported public surface", () => {
    expect(LicenseSeat).toBe(api.LicenseSeatSDK);
    expect(api.SDK_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(api.APIError).toBeTypeOf("function");
    expect(api.ConfigurationError).toBeTypeOf("function");
    expect(api.LicenseError).toBeTypeOf("function");
    expect(api.CryptoError).toBeTypeOf("function");
    expect(api.LicenseCache).toBeTypeOf("function");
    expect(api.collectTelemetry).toBeTypeOf("function");
    expect(api.canonicalJsonStringify).toBeTypeOf("function");
  });

  it("creates, reuses, forcibly replaces, and resets the shared instance", () => {
    const first = api.getSharedInstance({ autoInitialize: false });
    expect(api.getSharedInstance()).toBe(first);

    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(api.configure({ autoInitialize: false })).toBe(first);
    expect(warning).toHaveBeenCalledOnce();

    const replacement = api.configure({
      autoInitialize: false,
      storagePrefix: "replacement_",
    }, true);
    expect(replacement).not.toBe(first);
    expect(first.destroyed).toBe(true);
    expect(api.getSharedInstance()).toBe(replacement);

    api.resetSharedInstance();
    const afterReset = api.getSharedInstance({ autoInitialize: false });
    expect(afterReset).not.toBe(replacement);
  });
});
