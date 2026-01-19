/**
 * MSW (Mock Service Worker) request handlers for testing
 * These handlers mock the LicenseSeat API endpoints.
 */

import { http, HttpResponse } from "msw";

const API_BASE = "https://api.licenseseat.com";

/**
 * Mock data for testing
 */
export const mockData = {
  validLicenseKey: "LS-TEST-VALID-LICENSE-KEY",
  invalidLicenseKey: "LS-TEST-INVALID-KEY",
  expiredLicenseKey: "LS-TEST-EXPIRED-KEY",
  deviceId: "web-test-device-123",
  apiKey: "test-api-key-12345",
  keyId: "test-key-id-001",
  // Mock Ed25519 public key (base64)
  publicKey: "MCowBQYDK2VwAyEAQHPaREiwn31mN8k/q9jtV7yMt0vOKNmAOCKvpBCp8YQ=",
};

/**
 * Mock activation response
 */
const mockActivationResponse = {
  id: "act_123456",
  license_key: mockData.validLicenseKey,
  device_identifier: mockData.deviceId,
  activated_at: new Date().toISOString(),
  metadata: {},
};

/**
 * Mock validation response (valid license)
 */
const mockValidValidationResponse = {
  valid: true,
  license_key: mockData.validLicenseKey,
  active_entitlements: [
    {
      key: "pro",
      name: "Pro Features",
      description: "Access to pro features",
      expires_at: null,
      metadata: null,
    },
    {
      key: "beta",
      name: "Beta Access",
      description: "Access to beta features",
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days
      metadata: null,
    },
  ],
};

/**
 * Mock validation response (invalid license)
 */
const mockInvalidValidationResponse = {
  valid: false,
  reason: "License key not found",
  error: "license_not_found",
};

/**
 * Mock offline license response
 */
const mockOfflineLicenseResponse = {
  payload: {
    lic_k: mockData.validLicenseKey,
    exp_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), // 1 year
    kid: mockData.keyId,
    active_ents: [
      {
        key: "pro",
        name: "Pro Features",
        description: "Access to pro features",
        expires_at: null,
        metadata: null,
      },
    ],
  },
  signature_b64u: "mockSignatureBase64Url",
  kid: mockData.keyId,
};

/**
 * API request handlers
 */
export const handlers = [
  // Heartbeat endpoint
  http.get(`${API_BASE}/heartbeat`, () => {
    return HttpResponse.json({ status: "ok", timestamp: Date.now() });
  }),

  // Auth test endpoint
  http.get(`${API_BASE}/auth_test`, ({ request }) => {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return HttpResponse.json(
        { error: "Unauthorized", code: "unauthorized" },
        { status: 401 }
      );
    }
    return HttpResponse.json({
      authenticated: true,
      message: "API key is valid",
    });
  }),

  // Activation endpoint
  http.post(`${API_BASE}/activations/activate`, async ({ request }) => {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return HttpResponse.json(
        { error: "Unauthorized", code: "unauthorized" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { license_key, device_identifier } = body;

    if (license_key === mockData.invalidLicenseKey) {
      return HttpResponse.json(
        { error: "Invalid license key", code: "invalid_license" },
        { status: 404 }
      );
    }

    if (license_key === mockData.expiredLicenseKey) {
      return HttpResponse.json(
        { error: "License has expired", code: "license_expired" },
        { status: 422 }
      );
    }

    return HttpResponse.json({
      ...mockActivationResponse,
      license_key,
      device_identifier: device_identifier || mockData.deviceId,
    });
  }),

  // Deactivation endpoint
  http.post(`${API_BASE}/activations/deactivate`, async ({ request }) => {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return HttpResponse.json(
        { error: "Unauthorized", code: "unauthorized" },
        { status: 401 }
      );
    }

    return HttpResponse.json({
      success: true,
      message: "Activation removed",
    });
  }),

  // Validation endpoint
  http.post(`${API_BASE}/licenses/validate`, async ({ request }) => {
    const body = await request.json();
    const { license_key } = body;

    if (license_key === mockData.invalidLicenseKey) {
      return HttpResponse.json(mockInvalidValidationResponse, { status: 422 });
    }

    if (license_key === mockData.expiredLicenseKey) {
      return HttpResponse.json(
        {
          valid: false,
          reason: "License has expired",
          error: "license_expired",
        },
        { status: 422 }
      );
    }

    return HttpResponse.json({
      ...mockValidValidationResponse,
      license_key,
    });
  }),

  // Offline license endpoint
  http.post(`${API_BASE}/licenses/:licenseKey/offline_license`, ({ params }) => {
    const { licenseKey } = params;

    if (licenseKey === mockData.invalidLicenseKey) {
      return HttpResponse.json(
        { error: "License not found", code: "not_found" },
        { status: 404 }
      );
    }

    return HttpResponse.json({
      ...mockOfflineLicenseResponse,
      payload: {
        ...mockOfflineLicenseResponse.payload,
        lic_k: licenseKey,
      },
    });
  }),

  // Public key endpoint
  http.get(`${API_BASE}/public_keys/:keyId`, ({ params }) => {
    const { keyId } = params;

    if (keyId !== mockData.keyId) {
      return HttpResponse.json(
        { error: "Key not found", code: "not_found" },
        { status: 404 }
      );
    }

    return HttpResponse.json({
      key_id: keyId,
      public_key_b64: mockData.publicKey,
    });
  }),
];
