/**
 * LicenseSeat SDK Tests
 *
 * These tests use Vitest and MSW to mock HTTP requests.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { LicenseSeatSDK } from "../src/LicenseSeat.js";
import { mockData } from "./mocks/handlers.js";

describe("LicenseSeatSDK", () => {
  let sdk;

  beforeEach(() => {
    // Create SDK instance with auto-initialize disabled for controlled testing
    sdk = new LicenseSeatSDK({
      apiKey: mockData.apiKey,
      autoInitialize: false,
      debug: false,
    });
  });

  describe("Configuration", () => {
    it("should use default configuration values", () => {
      const defaultSdk = new LicenseSeatSDK({ autoInitialize: false });

      expect(defaultSdk.config.apiBaseUrl).toBe("https://api.licenseseat.com");
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
      expect(result.device_identifier).toBeDefined();
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

    it("should use custom device identifier if provided", async () => {
      const customDeviceId = "custom-device-12345";

      const result = await sdk.activate(mockData.validLicenseKey, {
        deviceIdentifier: customDeviceId,
      });

      expect(result.device_identifier).toBe(customDeviceId);
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
      expect(result.success).toBe(true);
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
        device_identifier: "test-device",
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

    it("should throw when API key is not configured", async () => {
      const noAuthSdk = new LicenseSeatSDK({ autoInitialize: false });

      await expect(noAuthSdk.testAuth()).rejects.toThrow(
        "API key is required for auth test"
      );
    });
  });
});
