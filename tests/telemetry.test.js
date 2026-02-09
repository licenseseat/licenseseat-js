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
});
