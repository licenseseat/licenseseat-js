import { afterEach, describe, expect, it, vi } from "vitest";

import { LicenseSeatSDK } from "../src/LicenseSeat.js";
import {
  collectBrowserHighEntropyTelemetry,
  collectTelemetry,
} from "../src/telemetry.js";
import { mockData } from "./mocks/handlers.js";

const HIGH_ENTROPY_HINTS = ["platformVersion", "architecture", "model"];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("high-entropy browser telemetry", () => {
  it("requests only the documented hints and returns bounded immutable values", async () => {
    const getHighEntropyValues = vi.fn().mockResolvedValue({
      architecture: "arm64",
      model: "Pixel 9",
      platformVersion: "15.7.3",
      unexpected: "not copied",
    });
    vi.stubGlobal("navigator", { userAgentData: { getHighEntropyValues } });

    const values = await collectBrowserHighEntropyTelemetry();

    expect(getHighEntropyValues).toHaveBeenCalledOnce();
    expect(getHighEntropyValues).toHaveBeenCalledWith(HIGH_ENTROPY_HINTS);
    expect(values).toEqual({
      architecture: "arm64",
      model: "Pixel 9",
      platformVersion: "15.7.3",
    });
    expect(Object.isFrozen(values)).toBe(true);
  });

  it("fails soft for unsupported, rejected, and hostile browser values", async () => {
    vi.stubGlobal("navigator", {});
    await expect(collectBrowserHighEntropyTelemetry()).resolves.toEqual({});

    vi.stubGlobal("navigator", {
      userAgentData: {
        getHighEntropyValues: vi.fn().mockRejectedValue(new Error("permission denied")),
      },
    });
    await expect(collectBrowserHighEntropyTelemetry()).resolves.toEqual({});

    vi.stubGlobal("navigator", {
      userAgentData: {
        getHighEntropyValues: vi.fn().mockResolvedValue({
          architecture: "bad\u0000arch",
          model: "x".repeat(300),
          platformVersion: "bad version",
        }),
      },
    });
    await expect(collectBrowserHighEntropyTelemetry()).resolves.toEqual({});
  });

  it("uses cached hints ahead of reduced user-agent values", () => {
    vi.stubGlobal("process", undefined);
    vi.stubGlobal("navigator", {
      language: "en-US",
      maxTouchPoints: 0,
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      userAgentData: { mobile: false, platform: "macOS" },
    });
    vi.stubGlobal("window", {});

    const telemetry = collectTelemetry("1.2.3", {
      browserHighEntropyValues: {
        architecture: "arm64",
        model: "Mac15,9",
        platformVersion: "15.7.3",
      },
    });

    expect(telemetry).toMatchObject({
      architecture: "arm64",
      device_model: "Mac15,9",
      os_version: "15.7.3",
    });
  });

  it("is disabled by default and whenever ordinary telemetry is disabled", () => {
    const getHighEntropyValues = vi.fn().mockResolvedValue({ architecture: "arm64" });
    vi.stubGlobal("navigator", { userAgentData: { getHighEntropyValues } });

    const defaultSdk = new LicenseSeatSDK({ autoInitialize: true });
    const disabledSdk = new LicenseSeatSDK({
      autoInitialize: true,
      browserHighEntropyTelemetryEnabled: true,
      telemetryEnabled: false,
    });

    expect(getHighEntropyValues).not.toHaveBeenCalled();
    expect(defaultSdk.browserHighEntropyTelemetryPromise).toBeNull();
    expect(disabledSdk.browserHighEntropyTelemetryPromise).toBeNull();
    defaultSdk.destroy();
    disabledSdk.destroy();
  });

  it("does not block initialization and enriches later POST bodies from memory", async () => {
    let resolveHints;
    const hintsPromise = new Promise((resolve) => {
      resolveHints = resolve;
    });
    const getHighEntropyValues = vi.fn(() => hintsPromise);
    vi.stubGlobal("navigator", {
      hardwareConcurrency: 8,
      language: "en-US",
      maxTouchPoints: 0,
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      userAgentData: {
        getHighEntropyValues,
        mobile: false,
        platform: "macOS",
      },
    });

    const sdk = new LicenseSeatSDK({
      apiKey: mockData.apiKey,
      productSlug: mockData.productSlug,
      autoInitialize: true,
      autoValidateInterval: 0,
      heartbeatInterval: 0,
      networkRecheckInterval: 0,
      offlineLicenseRefreshInterval: 0,
      browserHighEntropyTelemetryEnabled: true,
    });

    expect(sdk.initialized).toBe(true);
    expect(getHighEntropyValues).toHaveBeenCalledOnce();
    expect(sdk.browserHighEntropyValues).toEqual({});

    resolveHints({
      architecture: "arm64",
      model: "Mac15,9",
      platformVersion: "15.7.3",
    });
    await sdk.browserHighEntropyTelemetryPromise;

    let capturedTelemetry;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url, options) => {
      if (typeof url === "string" && url.includes("/activate")) {
        capturedTelemetry = JSON.parse(options.body).telemetry;
      }
      return originalFetch(url, options);
    });

    try {
      await sdk.activate(mockData.validLicenseKey);
      expect(capturedTelemetry).toMatchObject({
        architecture: "arm64",
        device_model: "Mac15,9",
        os_version: "15.7.3",
      });
    } finally {
      globalThis.fetch = originalFetch;
      sdk.destroy();
    }
  });

  it("validates the opt-in as a boolean configuration value", () => {
    expect(
      () => new LicenseSeatSDK({
        autoInitialize: false,
        browserHighEntropyTelemetryEnabled: "yes",
      })
    ).toThrow("browserHighEntropyTelemetryEnabled must be a boolean");
  });
});
