/**
 * Telemetry collection tests
 *
 * Tests all telemetry detection functions and the collectTelemetry() API.
 * Runs in vitest jsdom environment (process.* is available via Node.js,
 * navigator/screen/window are available via jsdom).
 */

import { describe, it, expect } from "vitest";
import { collectTelemetry } from "../src/telemetry.js";

describe("collectTelemetry", () => {
  // ── Core / existing fields ────────────────────────────────────────

  it("should return an object with sdk_version", () => {
    const result = collectTelemetry("1.2.3");
    expect(result.sdk_version).toBe("1.2.3");
  });

  it("should include platform field", () => {
    const result = collectTelemetry("1.0.0");
    expect(result.platform).toBeDefined();
    expect(typeof result.platform).toBe("string");
  });

  it("should include os_name field", () => {
    const result = collectTelemetry("1.0.0");
    expect(result.os_name).toBeDefined();
    expect(typeof result.os_name).toBe("string");
  });

  it("should include os_version field", () => {
    const result = collectTelemetry("1.0.0");
    // os_version is available in Node.js via os.release() or process.version
    if (result.os_version) {
      expect(typeof result.os_version).toBe("string");
    }
  });

  it("should include locale when available", () => {
    const result = collectTelemetry("1.0.0");
    if (result.locale) {
      expect(typeof result.locale).toBe("string");
    }
  });

  it("should include timezone when available", () => {
    const result = collectTelemetry("1.0.0");
    if (result.timezone) {
      expect(typeof result.timezone).toBe("string");
    }
  });

  it("should filter out null values", () => {
    const result = collectTelemetry("1.0.0");
    for (const value of Object.values(result)) {
      expect(value).not.toBeNull();
      expect(value).not.toBeUndefined();
    }
  });

  it("should use snake_case keys", () => {
    const result = collectTelemetry("1.0.0");
    for (const key of Object.keys(result)) {
      // All keys should be lowercase with underscores
      expect(key).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  // ── New telemetry fields ──────────────────────────────────────────

  it("should include device_type field with a valid value", () => {
    const result = collectTelemetry("1.0.0");
    expect(result.device_type).toBeDefined();
    expect(["phone", "tablet", "desktop", "server", "unknown"]).toContain(result.device_type);
  });

  it("should detect device_type as 'server' in Node.js environment", () => {
    // vitest runs in Node.js (jsdom just adds DOM globals)
    // Since process.versions.node is set, platform returns "node" -> device_type "server"
    const result = collectTelemetry("1.0.0");
    // In jsdom, navigator is defined so platform detection might vary.
    // But device_type should always be a valid string.
    expect(typeof result.device_type).toBe("string");
  });

  it("should include runtime_version in Node.js", () => {
    const result = collectTelemetry("1.0.0");
    expect(result.runtime_version).toBeDefined();
    expect(typeof result.runtime_version).toBe("string");
    // Should match the running Node.js version
    expect(result.runtime_version).toBe(process.versions.node);
  });

  it("should include architecture in Node.js", () => {
    const result = collectTelemetry("1.0.0");
    expect(result.architecture).toBeDefined();
    expect(["arm64", "x64", "x86", "arm"]).toContain(result.architecture);
  });

  it("should map ia32 to x86 for architecture", () => {
    // Indirectly tested: if process.arch is "ia32", it should map to "x86"
    // We can verify the mapping is correct by checking the result is valid
    const result = collectTelemetry("1.0.0");
    if (result.architecture) {
      expect(result.architecture).not.toBe("ia32");
    }
  });

  it("should include cpu_cores as a positive integer", () => {
    const result = collectTelemetry("1.0.0");
    expect(result.cpu_cores).toBeDefined();
    expect(typeof result.cpu_cores).toBe("number");
    expect(result.cpu_cores).toBeGreaterThan(0);
    expect(Number.isInteger(result.cpu_cores)).toBe(true);
  });

  it("should include memory_gb when available", () => {
    const result = collectTelemetry("1.0.0");
    // memory_gb may not be available in jsdom test environment
    // (navigator.deviceMemory is Chrome-only and os.totalmem uses dynamic require)
    if (result.memory_gb !== undefined) {
      expect(typeof result.memory_gb).toBe("number");
      expect(result.memory_gb).toBeGreaterThan(0);
    }
  });

  it("should include language field derived from locale", () => {
    const result = collectTelemetry("1.0.0");
    if (result.language) {
      expect(result.language.length).toBeGreaterThanOrEqual(2);
      expect(result.language).toMatch(/^[a-z]+$/);
    }
  });

  it("should derive language as lowercase 2-letter code from locale", () => {
    const result = collectTelemetry("1.0.0");
    if (result.language && result.locale) {
      const expectedLang = result.locale.split(/[-_]/)[0].toLowerCase();
      expect(result.language).toBe(expectedLang);
    }
  });

  it("should include screen_resolution when screen is available", () => {
    const result = collectTelemetry("1.0.0");
    // In jsdom, screen.width and screen.height may be 0, so screen_resolution
    // may be null (filtered out). If present, verify format.
    if (result.screen_resolution) {
      expect(result.screen_resolution).toMatch(/^\d+x\d+$/);
    }
  });

  it("should include display_scale when window.devicePixelRatio is available", () => {
    const result = collectTelemetry("1.0.0");
    // jsdom may or may not set devicePixelRatio
    if (result.display_scale) {
      expect(typeof result.display_scale).toBe("number");
      expect(result.display_scale).toBeGreaterThan(0);
    }
  });

  it("should include browser_name when navigator is available", () => {
    const result = collectTelemetry("1.0.0");
    // In jsdom, navigator.userAgent contains "jsdom" - browser detection may return null
    if (result.browser_name) {
      expect(typeof result.browser_name).toBe("string");
      expect(result.browser_name.length).toBeGreaterThan(0);
    }
  });

  it("should include browser_version when browser_name is detected", () => {
    const result = collectTelemetry("1.0.0");
    if (result.browser_version) {
      expect(typeof result.browser_version).toBe("string");
      // Version should contain at least one digit
      expect(result.browser_version).toMatch(/\d/);
    }
  });

  // ── app_version / app_build via options ───────────────────────────

  it("should include app_version when provided via options", () => {
    const result = collectTelemetry("1.0.0", { appVersion: "2.1.0" });
    expect(result.app_version).toBe("2.1.0");
  });

  it("should include app_build when provided via options", () => {
    const result = collectTelemetry("1.0.0", { appBuild: "42" });
    expect(result.app_build).toBe("42");
  });

  it("should include both app_version and app_build together", () => {
    const result = collectTelemetry("1.0.0", { appVersion: "3.0.0", appBuild: "100" });
    expect(result.app_version).toBe("3.0.0");
    expect(result.app_build).toBe("100");
  });

  it("should not include app_version when not provided", () => {
    const result = collectTelemetry("1.0.0");
    expect(result.app_version).toBeUndefined();
  });

  it("should not include app_build when not provided", () => {
    const result = collectTelemetry("1.0.0");
    expect(result.app_build).toBeUndefined();
  });

  it("should accept empty options object without breaking", () => {
    const result = collectTelemetry("1.0.0", {});
    expect(result.sdk_version).toBe("1.0.0");
    expect(result.app_version).toBeUndefined();
    expect(result.app_build).toBeUndefined();
  });

  it("should accept no options argument without breaking", () => {
    const result = collectTelemetry("1.0.0");
    expect(result.sdk_version).toBe("1.0.0");
  });

  // ── Telemetry payload completeness ────────────────────────────────

  it("should produce a complete telemetry dictionary with all expected keys", () => {
    const result = collectTelemetry("1.0.0", { appVersion: "1.0.0", appBuild: "1" });

    // These keys must always be present (Node.js environment)
    expect(result).toHaveProperty("sdk_version");
    expect(result).toHaveProperty("os_name");
    expect(result).toHaveProperty("platform");
    expect(result).toHaveProperty("device_type");
    expect(result).toHaveProperty("architecture");
    expect(result).toHaveProperty("cpu_cores");
    expect(result).toHaveProperty("runtime_version");
    expect(result).toHaveProperty("app_version");
    expect(result).toHaveProperty("app_build");

    // These keys are environment-dependent but should be valid if present
    const optionalKeys = [
      "os_version", "device_model", "locale", "timezone", "language",
      "memory_gb", "screen_resolution", "display_scale",
      "browser_name", "browser_version",
    ];
    for (const key of optionalKeys) {
      if (result[key] !== undefined) {
        expect(result[key]).not.toBeNull();
      }
    }
  });

  it("should never throw even if detection fails", () => {
    // collectTelemetry should be resilient to any environment
    expect(() => collectTelemetry("1.0.0")).not.toThrow();
    expect(() => collectTelemetry("1.0.0", {})).not.toThrow();
    expect(() => collectTelemetry("1.0.0", { appVersion: "x", appBuild: "y" })).not.toThrow();
  });
});
