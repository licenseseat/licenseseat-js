import { afterEach, describe, expect, it, vi } from "vitest";
import { collectTelemetry } from "../src/telemetry.js";

function collectWithGlobals(overrides, sdkVersion = "1.2.3", options) {
  for (const [name, value] of Object.entries(overrides)) {
    vi.stubGlobal(name, value);
  }

  try {
    return collectTelemetry(sdkVersion, options);
  } finally {
    vi.unstubAllGlobals();
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("telemetry environment detection", () => {
  it("collects bounded Chromium userAgentData and display information", () => {
    const telemetry = collectWithGlobals({
      process: undefined,
      Deno: undefined,
      navigator: {
        language: "pt-BR",
        maxTouchPoints: 5,
        hardwareConcurrency: 8,
        deviceMemory: 8,
        userAgent: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124.0.0.0",
        userAgentData: {
          architecture: "arm64",
          brands: [{ brand: "Google Chrome", version: "124" }],
          mobile: true,
          model: "Pixel 8",
          platform: "Android",
        },
      },
      screen: { width: 412, height: 915 },
      window: { devicePixelRatio: 2.75 },
    });

    expect(telemetry).toMatchObject({
      architecture: "arm64",
      browser_name: "Google Chrome",
      browser_version: "124",
      cpu_cores: 8,
      device_model: "Pixel 8",
      device_type: "phone",
      display_scale: 2.75,
      language: "pt",
      locale: "pt-BR",
      memory_gb: 8,
      os_name: "Android",
      os_version: "14",
      platform: "browser",
      screen_resolution: "412x915",
    });
  });

  it("uses the Chromium brand fallback and detects a tablet", () => {
    const telemetry = collectWithGlobals({
      process: undefined,
      Deno: undefined,
      Intl: undefined,
      navigator: {
        language: "en-US",
        userAgent: "Mozilla/5.0 (Linux; Android 13)",
        userAgentData: {
          brands: [{ brand: "Chromium", version: "123" }],
          mobile: true,
          platform: "Android",
        },
      },
      screen: { width: 1024, height: 1366 },
      window: {},
    });

    expect(telemetry.browser_name).toBe("Chrome");
    expect(telemetry.browser_version).toBe("123");
    expect(telemetry.device_type).toBe("tablet");
  });

  it.each([
    ["Mozilla/5.0 (Windows NT 10.0) Edg/124.0", "Windows", "10.0", "Edge", "124.0"],
    ["Mozilla/5.0 (X11; Linux x86_64) OPR/109.0", "Linux", null, "Opera", "109.0"],
    ["Mozilla/5.0 (X11; Linux x86_64) Brave/1.66", "Linux", null, "Brave", null],
    ["Mozilla/5.0 (X11; Linux x86_64) Vivaldi/6.7", "Linux", null, "Vivaldi", null],
    ["Mozilla/5.0 (X11; Linux x86_64) Firefox/126.0", "Linux", null, "Firefox", "126.0"],
    ["Mozilla/5.0 (Linux; Android 14) SamsungBrowser/25.0", "Android", "14", "Samsung Internet", "25.0"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) CriOS/124.0", "iOS", "17.4", "Chrome", "124.0"],
    ["Mozilla/5.0 (X11; Linux x86_64) Chrome/124.0", "Linux", null, "Chrome", "124.0"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) Version/17.4 Safari/605.1", "macOS", "14.4", "Safari", "17.4"],
  ])("parses browser fallback %s", (userAgent, osName, osVersion, browserName, browserVersion) => {
    const telemetry = collectWithGlobals({
      process: undefined,
      Deno: undefined,
      navigator: { language: "en-US", maxTouchPoints: 0, userAgent },
      screen: { width: 1920, height: 1080 },
      window: { devicePixelRatio: 1 },
    });

    expect(telemetry.os_name).toBe(osName);
    expect(telemetry.os_version).toBe(osVersion ?? undefined);
    expect(telemetry.browser_name).toBe(browserName);
    expect(telemetry.browser_version).toBe(browserVersion ?? undefined);
    expect(telemetry.device_type).toBe("desktop");
  });

  it.each([
    [480, "phone"],
    [1024, "tablet"],
  ])("detects React Native screen width %i as %s", (width, deviceType) => {
    const telemetry = collectWithGlobals({
      process: undefined,
      Deno: undefined,
      navigator: { language: "en-US", product: "ReactNative", userAgent: "" },
      screen: { width, height: 1200 },
      window: undefined,
    });

    expect(telemetry.platform).toBe("react-native");
    expect(telemetry.device_type).toBe(deviceType);
  });

  it("detects Deno without relying on Node globals", () => {
    const telemetry = collectWithGlobals({
      process: undefined,
      Deno: { version: { deno: "1.44.0" } },
      navigator: undefined,
      screen: undefined,
      window: undefined,
    });

    expect(telemetry).toMatchObject({
      device_type: "server",
      os_name: "Unknown",
      platform: "deno",
      runtime_version: "1.44.0",
    });
  });

  it.each([
    [
      { arch: "ia32", env: {}, platform: "win32", version: "v22.0.0", versions: { electron: "30.0.0", node: "22.0.0" } },
      "electron", "desktop", "x86", "30.0.0", "Windows",
    ],
    [
      { arch: "riscv64", env: {}, platform: "linux", version: "v22.0.0", versions: { bun: "1.1.0", node: "22.0.0" } },
      "bun", "server", "riscv64", "1.1.0", "Linux",
    ],
    [
      { arch: "arm", env: {}, platform: "freebsd", version: "v22.0.0", versions: { node: "22.0.0" } },
      "node", "server", "arm", "22.0.0", "FreeBSD",
    ],
  ])("detects %s runtimes", (processValue, platform, deviceType, architecture, runtimeVersion, osName) => {
    const telemetry = collectWithGlobals({
      process: processValue,
      Deno: undefined,
      navigator: undefined,
      screen: undefined,
      window: undefined,
    });

    expect(telemetry).toMatchObject({ architecture, device_type: deviceType, os_name: osName, platform, runtime_version: runtimeVersion });
  });

  it("falls back to process locale and unknown runtime values", () => {
    const telemetry = collectWithGlobals({
      process: {
        arch: "mips64",
        env: { LANG: "pt_PT.UTF-8" },
        platform: "plan9",
        version: "v1.0.0",
        versions: {},
      },
      Deno: undefined,
      Intl: undefined,
      navigator: undefined,
      screen: undefined,
      window: undefined,
    });

    expect(telemetry).toMatchObject({
      architecture: "mips64",
      device_type: "unknown",
      language: "pt",
      locale: "pt_PT.UTF-8",
      os_name: "plan9",
      os_version: "v1.0.0",
      platform: "unknown",
    });
    expect(telemetry.timezone).toBeUndefined();
  });

  it("drops malformed and unreasonably large ambient values", () => {
    const telemetry = collectWithGlobals({
      process: undefined,
      Deno: undefined,
      Intl: undefined,
      navigator: {
        deviceMemory: Number.POSITIVE_INFINITY,
        hardwareConcurrency: 1.5,
        language: "en-US\nforged",
        maxTouchPoints: 0,
        userAgent: "",
        userAgentData: {
          architecture: "bad\u0000arch",
          brands: [{ brand: "Google Chrome", version: "x".repeat(300) }],
          mobile: false,
          model: "x".repeat(300),
          platform: "x".repeat(300),
        },
      },
      screen: { width: Number.POSITIVE_INFINITY, height: -1 },
      window: { devicePixelRatio: 1000 },
    }, String.fromCharCode(0xd800), { appVersion: "x".repeat(300), appBuild: "bad\rbuild" });

    expect(telemetry).toEqual({
      browser_name: "Google Chrome",
      device_type: "desktop",
      platform: "browser",
      sdk_name: "js",
    });
  });

  it("never lets hostile ambient getters interrupt a licensing request", () => {
    const hostile = new Proxy({}, {
      get() {
        throw new Error("hostile getter");
      },
    });
    const hostileOptions = new Proxy({}, {
      get() {
        throw new Error("hostile options getter");
      },
    });

    const telemetry = collectWithGlobals({
      process: hostile,
      Deno: hostile,
      Intl: hostile,
      navigator: hostile,
      screen: hostile,
      window: hostile,
    }, "1.2.3", hostileOptions);

    expect(telemetry).toEqual({
      device_type: "unknown",
      sdk_name: "js",
      sdk_version: "1.2.3",
    });
  });
});
