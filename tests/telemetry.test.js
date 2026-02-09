/**
 * Telemetry collection tests
 */

import { describe, it, expect } from "vitest";
import { collectTelemetry } from "../src/telemetry.js";

describe("collectTelemetry", () => {
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

  it("should include device_type field", () => {
    const result = collectTelemetry("1.0.0");
    expect(result.device_type).toBeDefined();
    expect(["phone", "tablet", "desktop", "server", "unknown"]).toContain(result.device_type);
  });

  it("should include runtime_version in Node.js", () => {
    const result = collectTelemetry("1.0.0");
    expect(result.runtime_version).toBeDefined();
    expect(typeof result.runtime_version).toBe("string");
  });

  it("should include architecture in Node.js", () => {
    const result = collectTelemetry("1.0.0");
    expect(result.architecture).toBeDefined();
    expect(["arm64", "x64", "x86", "arm"]).toContain(result.architecture);
  });

  it("should include cpu_cores", () => {
    const result = collectTelemetry("1.0.0");
    expect(result.cpu_cores).toBeDefined();
    expect(typeof result.cpu_cores).toBe("number");
    expect(result.cpu_cores).toBeGreaterThan(0);
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
    // language is derived from locale, should be a 2+ letter code
    if (result.language) {
      expect(result.language.length).toBeGreaterThanOrEqual(2);
      expect(result.language).toMatch(/^[a-z]+$/);
    }
  });

  it("should include app_version when provided via options", () => {
    const result = collectTelemetry("1.0.0", { appVersion: "2.1.0" });
    expect(result.app_version).toBe("2.1.0");
  });

  it("should include app_build when provided via options", () => {
    const result = collectTelemetry("1.0.0", { appBuild: "42" });
    expect(result.app_build).toBe("42");
  });

  it("should not include app_version when not provided", () => {
    const result = collectTelemetry("1.0.0");
    expect(result.app_version).toBeUndefined();
  });

  it("should not include app_build when not provided", () => {
    const result = collectTelemetry("1.0.0");
    expect(result.app_build).toBeUndefined();
  });

  it("should accept options as second parameter without breaking", () => {
    const result = collectTelemetry("1.0.0", {});
    expect(result.sdk_version).toBe("1.0.0");
    expect(result.app_version).toBeUndefined();
    expect(result.app_build).toBeUndefined();
  });
});
