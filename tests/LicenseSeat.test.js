/**
 * LicenseSeat SDK Tests
 *
 * These tests use Vitest and MSW to mock HTTP requests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LicenseSeatSDK, SDK_VERSION } from "../src/LicenseSeat.js";
import { mockData } from "./mocks/handlers.js";

describe("LicenseSeatSDK", () => {
  let sdk;

  beforeEach(() => {
    // Create SDK instance with auto-initialize disabled for controlled testing
    // Disable heartbeat timer to avoid background activity in tests
    sdk = new LicenseSeatSDK({
      apiKey: mockData.apiKey,
      productSlug: mockData.productSlug,
      autoInitialize: false,
      heartbeatInterval: 0,
      debug: false,
    });
  });

  afterEach(() => {
    // Ensure all timers are stopped to avoid leaks
    if (sdk) sdk.destroy();
  });

  describe("Configuration", () => {
    it("should use default configuration values", () => {
      const defaultSdk = new LicenseSeatSDK({ autoInitialize: false });

      expect(defaultSdk.config.apiBaseUrl).toBe("https://licenseseat.com/api/v1");
      expect(defaultSdk.config.storagePrefix).toBe("licenseseat_");
      expect(defaultSdk.config.autoValidateInterval).toBe(3600000);
      expect(defaultSdk.config.offlineFallbackEnabled).toBe(false);
      expect(defaultSdk.config.maxRetries).toBe(3);
    });

    it("should allow custom configuration", () => {
      const customSdk = new LicenseSeatSDK({
        apiBaseUrl: "https://custom.api.com",
        storagePrefix: "custom_",
        autoValidateInterval: 1800000,
        offlineFallbackEnabled: true,
        autoInitialize: false,
      });

      expect(customSdk.config.apiBaseUrl).toBe("https://custom.api.com");
      expect(customSdk.config.storagePrefix).toBe("custom_");
      expect(customSdk.config.autoValidateInterval).toBe(1800000);
      expect(customSdk.config.offlineFallbackEnabled).toBe(true);
    });

    it("should default offlineFallbackEnabled to false (matching Swift SDK)", () => {
      const defaultSdk = new LicenseSeatSDK({ autoInitialize: false });
      expect(defaultSdk.config.offlineFallbackEnabled).toBe(false);
    });
  });

  describe("Activation", () => {
    it("should activate a valid license key", async () => {
      const result = await sdk.activate(mockData.validLicenseKey);

      expect(result).toBeDefined();
      expect(result.license_key).toBe(mockData.validLicenseKey);
      expect(result.device_id).toBeDefined();
      expect(result.activated_at).toBeDefined();
    });

    it("should emit activation events", async () => {
      const startHandler = vi.fn();
      const successHandler = vi.fn();

      sdk.on("activation:start", startHandler);
      sdk.on("activation:success", successHandler);

      await sdk.activate(mockData.validLicenseKey);

      expect(startHandler).toHaveBeenCalledOnce();
      expect(successHandler).toHaveBeenCalledOnce();
    });

    it("should reject invalid license keys", async () => {
      const errorHandler = vi.fn();
      sdk.on("activation:error", errorHandler);

      await expect(sdk.activate(mockData.invalidLicenseKey)).rejects.toThrow();
      expect(errorHandler).toHaveBeenCalledOnce();
    });

    it("should cache the activated license", async () => {
      await sdk.activate(mockData.validLicenseKey);

      const cached = sdk.cache.getLicense();
      expect(cached).toBeDefined();
      expect(cached.license_key).toBe(mockData.validLicenseKey);
    });

    it("should use custom device ID if provided", async () => {
      const customDeviceId = "custom-device-12345";

      const result = await sdk.activate(mockData.validLicenseKey, {
        deviceId: customDeviceId,
      });

      expect(result.device_id).toBe(customDeviceId);
    });
  });

  describe("Validation", () => {
    beforeEach(async () => {
      // Pre-activate for validation tests
      await sdk.activate(mockData.validLicenseKey);
    });

    it("should validate a valid license", async () => {
      const result = await sdk.validateLicense(mockData.validLicenseKey);

      expect(result).toBeDefined();
      expect(result.valid).toBe(true);
    });

    it("should include entitlements in validation response", async () => {
      const result = await sdk.validateLicense(mockData.validLicenseKey);

      expect(result.active_entitlements).toBeDefined();
      expect(result.active_entitlements.length).toBeGreaterThan(0);
      expect(result.active_entitlements[0].key).toBe("pro");
    });

    it("should emit validation events", async () => {
      const startHandler = vi.fn();
      const successHandler = vi.fn();

      sdk.on("validation:start", startHandler);
      sdk.on("validation:success", successHandler);

      await sdk.validateLicense(mockData.validLicenseKey);

      expect(startHandler).toHaveBeenCalledOnce();
      expect(successHandler).toHaveBeenCalledOnce();
    });

    it("should update cached validation data", async () => {
      await sdk.validateLicense(mockData.validLicenseKey);

      const cached = sdk.cache.getLicense();
      expect(cached.validation).toBeDefined();
      expect(cached.validation.valid).toBe(true);
    });
  });

  describe("Entitlements", () => {
    it("should check entitlement with hasEntitlement() returning boolean", async () => {
      // Activate and validate
      await sdk.activate(mockData.validLicenseKey);
      const validationResult = await sdk.validateLicense(mockData.validLicenseKey);

      // The validation response should have entitlements
      expect(validationResult.active_entitlements).toBeDefined();
      expect(validationResult.active_entitlements.length).toBeGreaterThan(0);

      // Cache should be updated with the validation
      const cached = sdk.cache.getLicense();
      expect(cached).not.toBeNull();
      expect(cached.validation).toBeDefined();
      expect(cached.validation.active_entitlements).toBeDefined();

      // Now check entitlements
      expect(sdk.hasEntitlement("pro")).toBe(true);
      expect(sdk.hasEntitlement("nonexistent")).toBe(false);
    });

    it("should check entitlement with checkEntitlement() returning details", async () => {
      await sdk.activate(mockData.validLicenseKey);
      await sdk.validateLicense(mockData.validLicenseKey);

      const proResult = sdk.checkEntitlement("pro");
      expect(proResult.active).toBe(true);
      expect(proResult.entitlement).toBeDefined();
      expect(proResult.entitlement.key).toBe("pro");

      const missingResult = sdk.checkEntitlement("nonexistent");
      expect(missingResult.active).toBe(false);
      expect(missingResult.reason).toBe("not_found");
    });

    it("should return no_license when no license is cached", () => {
      sdk.cache.clearLicense();
      const result = sdk.checkEntitlement("pro");

      expect(result.active).toBe(false);
      expect(result.reason).toBe("no_license");
    });
  });

  describe("Deactivation", () => {
    beforeEach(async () => {
      await sdk.activate(mockData.validLicenseKey);
    });

    it("should deactivate the current license", async () => {
      const result = await sdk.deactivate();

      expect(result).toBeDefined();
      // API returns the deactivation object with activation_id and deactivated_at
      expect(result.object).toBe("deactivation");
      expect(result.deactivated_at).toBeDefined();
      expect(result.activation_id).toBeDefined();
    });

    it("should clear cached license after deactivation", async () => {
      await sdk.deactivate();

      const cached = sdk.cache.getLicense();
      expect(cached).toBeNull();
    });

    it("should emit deactivation events", async () => {
      const startHandler = vi.fn();
      const successHandler = vi.fn();

      sdk.on("deactivation:start", startHandler);
      sdk.on("deactivation:success", successHandler);

      await sdk.deactivate();

      expect(startHandler).toHaveBeenCalledOnce();
      expect(successHandler).toHaveBeenCalledOnce();
    });

    it("should throw when no license is active", async () => {
      sdk.cache.clearLicense();

      await expect(sdk.deactivate()).rejects.toThrow("No active license found");
    });
  });

  describe("Status", () => {
    it("should return inactive status when no license", () => {
      const status = sdk.getStatus();

      expect(status.status).toBe("inactive");
      expect(status.message).toBe("No license activated");
    });

    it("should return pending status before validation", async () => {
      // Manually set license without validation
      sdk.cache.setLicense({
        license_key: mockData.validLicenseKey,
        device_id: "test-device",
        activated_at: new Date().toISOString(),
        last_validated: new Date().toISOString(),
      });

      const status = sdk.getStatus();
      expect(status.status).toBe("pending");
    });

    it("should return active status after successful validation", async () => {
      await sdk.activate(mockData.validLicenseKey);
      await sdk.validateLicense(mockData.validLicenseKey);

      const status = sdk.getStatus();

      expect(status.status).toBe("active");
      expect(status.license).toBe(mockData.validLicenseKey);
      expect(status.entitlements).toBeDefined();
    });
  });

  describe("Event System", () => {
    it("should subscribe to events with on()", () => {
      const handler = vi.fn();
      sdk.on("test:event", handler);

      sdk.emit("test:event", { foo: "bar" });

      expect(handler).toHaveBeenCalledWith({ foo: "bar" });
    });

    it("should unsubscribe with the returned function", () => {
      const handler = vi.fn();
      const unsubscribe = sdk.on("test:event", handler);

      unsubscribe();
      sdk.emit("test:event", { foo: "bar" });

      expect(handler).not.toHaveBeenCalled();
    });

    it("should unsubscribe with off()", () => {
      const handler = vi.fn();
      sdk.on("test:event", handler);
      sdk.off("test:event", handler);

      sdk.emit("test:event", { foo: "bar" });

      expect(handler).not.toHaveBeenCalled();
    });

    it("should support multiple handlers for same event", () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      sdk.on("test:event", handler1);
      sdk.on("test:event", handler2);
      sdk.emit("test:event", { data: "test" });

      expect(handler1).toHaveBeenCalledOnce();
      expect(handler2).toHaveBeenCalledOnce();
    });
  });

  describe("Reset", () => {
    it("should clear all data on reset", async () => {
      await sdk.activate(mockData.validLicenseKey);
      expect(sdk.cache.getLicense()).not.toBeNull();

      sdk.reset();

      // After reset, the license should be cleared from localStorage
      // Note: getLicense() reads from localStorage, not from SDK instance state
      const licenseAfterReset = sdk.cache.getLicense();
      expect(licenseAfterReset).toBeNull();
    });

    it("should emit sdk:reset event", () => {
      const handler = vi.fn();
      sdk.on("sdk:reset", handler);

      sdk.reset();

      expect(handler).toHaveBeenCalledOnce();
    });
  });

  describe("Auth Test", () => {
    it("should succeed with valid API key", async () => {
      const result = await sdk.testAuth();

      expect(result.authenticated).toBe(true);
    });

    it("should throw ConfigurationError when API key is not configured", async () => {
      const noAuthSdk = new LicenseSeatSDK({
        productSlug: mockData.productSlug,
        autoInitialize: false,
      });

      await expect(noAuthSdk.testAuth()).rejects.toThrow(
        "API key is required for auth test"
      );

      // Verify it's specifically a ConfigurationError
      try {
        await noAuthSdk.testAuth();
      } catch (err) {
        expect(err.name).toBe("ConfigurationError");
      }
    });
  });

  describe("Heartbeat", () => {
    beforeEach(async () => {
      await sdk.activate(mockData.validLicenseKey);
    });

    it("should send a heartbeat successfully", async () => {
      const result = await sdk.heartbeat();

      expect(result).toBeDefined();
      expect(result.object).toBe("heartbeat");
      expect(result.received_at).toBeDefined();
    });

    it("should emit heartbeat:success event", async () => {
      const handler = vi.fn();
      sdk.on("heartbeat:success", handler);

      await sdk.heartbeat();

      expect(handler).toHaveBeenCalledOnce();
    });

    it("should return undefined when no license is cached", async () => {
      sdk.cache.clearLicense();

      const result = await sdk.heartbeat();
      expect(result).toBeUndefined();
    });

    it("should throw when productSlug is not configured", async () => {
      const noSlugSdk = new LicenseSeatSDK({
        apiKey: mockData.apiKey,
        autoInitialize: false,
      });

      await expect(noSlugSdk.heartbeat()).rejects.toThrow(
        "productSlug is required for heartbeat"
      );
    });
  });

  describe("Telemetry", () => {
    it("should default telemetryEnabled to true", () => {
      const defaultSdk = new LicenseSeatSDK({ autoInitialize: false });
      expect(defaultSdk.config.telemetryEnabled).toBe(true);
      defaultSdk.destroy();
    });

    it("should allow disabling telemetry", () => {
      const noTelemetrySdk = new LicenseSeatSDK({
        telemetryEnabled: false,
        autoInitialize: false,
      });
      expect(noTelemetrySdk.config.telemetryEnabled).toBe(false);
      noTelemetrySdk.destroy();
    });
  });

  describe("App Version / App Build Config", () => {
    it("should default appVersion and appBuild to null", () => {
      const defaultSdk = new LicenseSeatSDK({ autoInitialize: false });
      expect(defaultSdk.config.appVersion).toBeNull();
      expect(defaultSdk.config.appBuild).toBeNull();
      defaultSdk.destroy();
    });

    it("should accept appVersion and appBuild in config", () => {
      const customSdk = new LicenseSeatSDK({
        appVersion: "2.1.0",
        appBuild: "42",
        autoInitialize: false,
      });
      expect(customSdk.config.appVersion).toBe("2.1.0");
      expect(customSdk.config.appBuild).toBe("42");
      customSdk.destroy();
    });
  });

  describe("Heartbeat Timer", () => {
    it("should default heartbeatInterval to 300000 (5 minutes)", () => {
      const defaultSdk = new LicenseSeatSDK({ autoInitialize: false });
      expect(defaultSdk.config.heartbeatInterval).toBe(300000);
      defaultSdk.destroy();
    });

    it("should allow custom heartbeatInterval", () => {
      const customSdk = new LicenseSeatSDK({
        heartbeatInterval: 60000,
        autoInitialize: false,
      });
      expect(customSdk.config.heartbeatInterval).toBe(60000);
      customSdk.destroy();
    });

    it("should not start heartbeat timer when heartbeatInterval is 0", async () => {
      const noHeartbeatSdk = new LicenseSeatSDK({
        apiKey: mockData.apiKey,
        productSlug: mockData.productSlug,
        heartbeatInterval: 0,
        autoInitialize: false,
      });

      await noHeartbeatSdk.activate(mockData.validLicenseKey);
      expect(noHeartbeatSdk.heartbeatTimer).toBeNull();
      noHeartbeatSdk.destroy();
    });

    it("should not start heartbeat timer when heartbeatInterval is negative", async () => {
      const negativeSdk = new LicenseSeatSDK({
        apiKey: mockData.apiKey,
        productSlug: mockData.productSlug,
        heartbeatInterval: -1000,
        autoInitialize: false,
      });

      await negativeSdk.activate(mockData.validLicenseKey);
      expect(negativeSdk.heartbeatTimer).toBeNull();
      negativeSdk.destroy();
    });

    it("should start heartbeat timer on activation when interval > 0", async () => {
      const heartbeatSdk = new LicenseSeatSDK({
        apiKey: mockData.apiKey,
        productSlug: mockData.productSlug,
        heartbeatInterval: 60000,
        autoInitialize: false,
      });

      await heartbeatSdk.activate(mockData.validLicenseKey);
      expect(heartbeatSdk.heartbeatTimer).not.toBeNull();
      heartbeatSdk.destroy();
    });

    it("should stop heartbeat timer on reset", async () => {
      const heartbeatSdk = new LicenseSeatSDK({
        apiKey: mockData.apiKey,
        productSlug: mockData.productSlug,
        heartbeatInterval: 60000,
        autoInitialize: false,
      });

      await heartbeatSdk.activate(mockData.validLicenseKey);
      expect(heartbeatSdk.heartbeatTimer).not.toBeNull();

      heartbeatSdk.reset();
      expect(heartbeatSdk.heartbeatTimer).toBeNull();
      heartbeatSdk.destroy();
    });

    it("should stop heartbeat timer on destroy", async () => {
      const heartbeatSdk = new LicenseSeatSDK({
        apiKey: mockData.apiKey,
        productSlug: mockData.productSlug,
        heartbeatInterval: 60000,
        autoInitialize: false,
      });

      await heartbeatSdk.activate(mockData.validLicenseKey);
      expect(heartbeatSdk.heartbeatTimer).not.toBeNull();

      heartbeatSdk.destroy();
      expect(heartbeatSdk.heartbeatTimer).toBeNull();
    });

    it("should stop heartbeat timer on deactivate", async () => {
      const heartbeatSdk = new LicenseSeatSDK({
        apiKey: mockData.apiKey,
        productSlug: mockData.productSlug,
        heartbeatInterval: 60000,
        autoInitialize: false,
      });

      await heartbeatSdk.activate(mockData.validLicenseKey);
      expect(heartbeatSdk.heartbeatTimer).not.toBeNull();

      await heartbeatSdk.deactivate();
      expect(heartbeatSdk.heartbeatTimer).toBeNull();
      heartbeatSdk.destroy();
    });

    it("should have heartbeatTimer null initially before activation", () => {
      const freshSdk = new LicenseSeatSDK({
        apiKey: mockData.apiKey,
        productSlug: mockData.productSlug,
        heartbeatInterval: 60000,
        autoInitialize: false,
      });
      expect(freshSdk.heartbeatTimer).toBeNull();
      freshSdk.destroy();
    });

    it("heartbeat timer should be independent from validation timer", async () => {
      const bothSdk = new LicenseSeatSDK({
        apiKey: mockData.apiKey,
        productSlug: mockData.productSlug,
        heartbeatInterval: 60000,
        autoValidateInterval: 120000,
        autoInitialize: false,
      });

      await bothSdk.activate(mockData.validLicenseKey);
      // Both timers should be running
      expect(bothSdk.heartbeatTimer).not.toBeNull();
      expect(bothSdk.validationTimer).not.toBeNull();
      // They should be different objects
      expect(bothSdk.heartbeatTimer).not.toBe(bothSdk.validationTimer);
      bothSdk.destroy();
    });
  });

  describe("Telemetry payload integration", () => {
    it("should include enriched telemetry fields in API request body", async () => {
      // Intercept the request body to verify telemetry is attached
      let capturedTelemetry = null;
      const origFetch = globalThis.fetch;
      const interceptFetch = vi.fn(async (url, options) => {
        if (typeof url === "string" && url.includes("/validate") && options?.body) {
          const body = JSON.parse(options.body);
          capturedTelemetry = body.telemetry;
        }
        return origFetch(url, options);
      });
      globalThis.fetch = interceptFetch;

      try {
        await sdk.activate(mockData.validLicenseKey);
        await sdk.validateLicense(mockData.validLicenseKey);

        expect(capturedTelemetry).not.toBeNull();
        expect(capturedTelemetry.sdk_version).toBeDefined();
        expect(capturedTelemetry.platform).toBeDefined();
        expect(capturedTelemetry.os_name).toBeDefined();
        expect(capturedTelemetry.device_type).toBeDefined();
        expect(capturedTelemetry.architecture).toBeDefined();
        expect(capturedTelemetry.cpu_cores).toBeDefined();
        expect(capturedTelemetry.runtime_version).toBeDefined();
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    it("should include app_version and app_build from config in telemetry payload", async () => {
      let capturedTelemetry = null;
      const origFetch = globalThis.fetch;
      const interceptFetch = vi.fn(async (url, options) => {
        if (typeof url === "string" && url.includes("/heartbeat") && options?.body) {
          const body = JSON.parse(options.body);
          capturedTelemetry = body.telemetry;
        }
        return origFetch(url, options);
      });
      globalThis.fetch = interceptFetch;

      const appSdk = new LicenseSeatSDK({
        apiKey: mockData.apiKey,
        productSlug: mockData.productSlug,
        appVersion: "5.0.0",
        appBuild: "999",
        autoInitialize: false,
        heartbeatInterval: 0,
      });

      try {
        await appSdk.activate(mockData.validLicenseKey);
        await appSdk.heartbeat();

        expect(capturedTelemetry).not.toBeNull();
        expect(capturedTelemetry.app_version).toBe("5.0.0");
        expect(capturedTelemetry.app_build).toBe("999");
      } finally {
        globalThis.fetch = origFetch;
        appSdk.destroy();
      }
    });

    it("should not include telemetry when telemetryEnabled is false", async () => {
      let capturedBody = null;
      const origFetch = globalThis.fetch;
      const interceptFetch = vi.fn(async (url, options) => {
        if (typeof url === "string" && url.includes("/heartbeat") && options?.body) {
          capturedBody = JSON.parse(options.body);
        }
        return origFetch(url, options);
      });
      globalThis.fetch = interceptFetch;

      const noTelSdk = new LicenseSeatSDK({
        apiKey: mockData.apiKey,
        productSlug: mockData.productSlug,
        telemetryEnabled: false,
        autoInitialize: false,
        heartbeatInterval: 0,
      });

      try {
        await noTelSdk.activate(mockData.validLicenseKey);
        await noTelSdk.heartbeat();

        expect(capturedBody).not.toBeNull();
        expect(capturedBody.telemetry).toBeUndefined();
      } finally {
        globalThis.fetch = origFetch;
        noTelSdk.destroy();
      }
    });
  });

  describe("SDK Version", () => {
    it("should export SDK_VERSION", () => {
      expect(SDK_VERSION).toBeDefined();
      expect(typeof SDK_VERSION).toBe("string");
      expect(SDK_VERSION).toBe("0.4.1");
    });
  });
});
