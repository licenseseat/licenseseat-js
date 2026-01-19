/**
 * MSW (Mock Service Worker) request handlers for testing
 * These handlers mock the LicenseSeat API endpoints.
 */

import { http, HttpResponse } from "msw";

const API_BASE = "https://licenseseat.com/api";

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
 * API returns { valid: true, license: { ... } } structure
 */
const mockValidValidationResponse = {
  valid: true,
  license: {
    license_key: mockData.validLicenseKey,
    status: "active",
    starts_at: new Date().toISOString(),
    ends_at: null,
    mode: "hardware_locked",
    plan_key: "pro",
    seat_limit: 3,
    active_activations_count: 1,
    active_entitlements: [
      {
        key: "pro",
        expires_at: null,
        metadata: null,
      },
      {
        key: "beta",
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days
        metadata: null,
      },
    ],
    metadata: {},
    product: {
      slug: "test-product",
      name: "Test Product",
    },
  },
};

/**
 * Mock validation response (invalid license)
 * API returns { error: "...", reason_code: "..." } for errors
 */
const mockInvalidValidationResponse = {
  error: "License key not found.",
  reason_code: "license_not_found",
};

/**
 * Mock offline license response
 */
const mockOfflineLicenseResponse = {
  payload: {
    v: 1,
    lic_k: mockData.validLicenseKey,
    prod_s: "test-product",
    plan_k: "pro",
    exp_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), // 1 year
    kid: mockData.keyId,
    sl: 3, // seat_limit
    active_ents: [
      {
        key: "pro",
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

    const body = await request.json();

    // Return the deactivated activation object (matching actual API response)
    return HttpResponse.json({
      id: "act_123456",
      device_identifier: body.device_identifier || mockData.deviceId,
      activated_at: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
      deactivated_at: new Date().toISOString(),
      ip_address: "127.0.0.1",
      metadata: {},
      license_key: body.license_key,
    });
  }),

  // Validation endpoint
  http.post(`${API_BASE}/licenses/validate`, async ({ request }) => {
    const body = await request.json();
    const { license_key } = body;

    if (license_key === mockData.invalidLicenseKey) {
      return HttpResponse.json(mockInvalidValidationResponse, { status: 404 });
    }

    if (license_key === mockData.expiredLicenseKey) {
      return HttpResponse.json(
        {
          error: "License has expired.",
          reason_code: "expired",
        },
        { status: 422 }
      );
    }

    // Return proper nested structure: { valid: true, license: { ... } }
    return HttpResponse.json({
      valid: true,
      license: {
        ...mockValidValidationResponse.license,
        license_key,
      },
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
