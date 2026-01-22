/**
 * MSW (Mock Service Worker) request handlers for testing
 * These handlers mock the LicenseSeat API v1 endpoints.
 */

import { http, HttpResponse } from "msw";

const API_BASE = "https://licenseseat.com/api/v1";

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
  productSlug: "test-product",
  // Mock Ed25519 public key (base64)
  publicKey: "MCowBQYDK2VwAyEAQHPaREiwn31mN8k/q9jtV7yMt0vOKNmAOCKvpBCp8YQ=",
};

/**
 * Mock license object (new v1 format)
 */
const mockLicenseObject = {
  key: mockData.validLicenseKey,
  status: "active",
  starts_at: new Date().toISOString(),
  expires_at: null,
  mode: "hardware_locked",
  plan_key: "pro",
  seat_limit: 3,
  active_seats: 1,
  active_entitlements: [
    {
      key: "pro",
      expires_at: null,
      metadata: null,
    },
    {
      key: "beta",
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      metadata: null,
    },
  ],
  metadata: {},
  product: {
    slug: mockData.productSlug,
    name: "Test Product",
  },
};

/**
 * Mock activation response (new v1 format)
 */
const mockActivationResponse = {
  object: "activation",
  id: 123,
  device_id: mockData.deviceId,
  device_name: null,
  license_key: mockData.validLicenseKey,
  activated_at: new Date().toISOString(),
  deactivated_at: null,
  ip_address: "127.0.0.1",
  metadata: {},
  license: mockLicenseObject,
};

/**
 * Mock validation response (new v1 format - valid)
 */
const mockValidValidationResponse = {
  object: "validation_result",
  valid: true,
  license: mockLicenseObject,
  activation: null,
};

/**
 * Mock deactivation response (new v1 format)
 */
const mockDeactivationResponse = {
  object: "deactivation",
  activation_id: 123,
  deactivated_at: new Date().toISOString(),
};

/**
 * Mock offline token response (new v1 format)
 */
const mockOfflineTokenResponse = {
  object: "offline_token",
  token: {
    schema_version: 1,
    license_key: mockData.validLicenseKey,
    product_slug: mockData.productSlug,
    plan_key: "pro",
    mode: "hardware_locked",
    seat_limit: 3,
    device_id: mockData.deviceId,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60, // 30 days
    nbf: Math.floor(Date.now() / 1000),
    license_expires_at: null,
    kid: mockData.keyId,
    entitlements: [
      {
        key: "pro",
        expires_at: null,
      },
    ],
    metadata: {},
  },
  signature: {
    algorithm: "Ed25519",
    key_id: mockData.keyId,
    value: "mockSignatureBase64Url",
  },
  canonical: '{"entitlements":[{"key":"pro"}],"exp":...,"iat":...,"kid":"test-key-id-001",...}',
};

/**
 * Mock signing key response (new v1 format)
 */
const mockSigningKeyResponse = {
  object: "signing_key",
  key_id: mockData.keyId,
  algorithm: "Ed25519",
  public_key: mockData.publicKey,
  created_at: "2026-01-01T00:00:00Z",
  status: "active",
};

/**
 * Mock health response (new v1 format)
 */
const mockHealthResponse = {
  object: "health",
  status: "healthy",
  api_version: "2026-01-21",
  timestamp: new Date().toISOString(),
};

/**
 * API request handlers
 */
export const handlers = [
  // Health endpoint
  http.get(`${API_BASE}/health`, () => {
    return HttpResponse.json(mockHealthResponse);
  }),

  // Auth test endpoint (internal use)
  http.get(`${API_BASE}/auth_test`, ({ request }) => {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return HttpResponse.json(
        { error: { code: "unauthorized", message: "Unauthorized" } },
        { status: 401 }
      );
    }
    return HttpResponse.json({
      authenticated: true,
      message: "API key is valid",
    });
  }),

  // Signing keys endpoint
  http.get(`${API_BASE}/signing_keys/:keyId`, ({ params }) => {
    const { keyId } = params;

    if (keyId !== mockData.keyId) {
      return HttpResponse.json(
        { error: { code: "signing_key_not_found", message: "Signing key not found for the provided key_id." } },
        { status: 404 }
      );
    }

    return HttpResponse.json(mockSigningKeyResponse);
  }),

  // Activation endpoint - POST /products/{slug}/licenses/{key}/activate
  http.post(`${API_BASE}/products/:slug/licenses/:key/activate`, async ({ request, params }) => {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return HttpResponse.json(
        { error: { code: "unauthorized", message: "Unauthorized" } },
        { status: 401 }
      );
    }

    const { key } = params;
    const body = await request.json();
    const { device_id } = body;

    if (key === mockData.invalidLicenseKey) {
      return HttpResponse.json(
        { error: { code: "license_not_found", message: "License not found" } },
        { status: 404 }
      );
    }

    if (key === mockData.expiredLicenseKey) {
      return HttpResponse.json(
        { error: { code: "license_expired", message: "License has expired" } },
        { status: 422 }
      );
    }

    return HttpResponse.json({
      ...mockActivationResponse,
      license_key: key,
      device_id: device_id || mockData.deviceId,
      license: {
        ...mockLicenseObject,
        key: key,
      },
    }, { status: 201 });
  }),

  // Deactivation endpoint - POST /products/{slug}/licenses/{key}/deactivate
  http.post(`${API_BASE}/products/:slug/licenses/:key/deactivate`, async ({ request }) => {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return HttpResponse.json(
        { error: { code: "unauthorized", message: "Unauthorized" } },
        { status: 401 }
      );
    }

    return HttpResponse.json(mockDeactivationResponse);
  }),

  // Validation endpoint - POST /products/{slug}/licenses/{key}/validate
  http.post(`${API_BASE}/products/:slug/licenses/:key/validate`, async ({ request, params }) => {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return HttpResponse.json(
        { error: { code: "unauthorized", message: "Unauthorized" } },
        { status: 401 }
      );
    }

    const { key } = params;

    if (key === mockData.invalidLicenseKey) {
      return HttpResponse.json(
        { error: { code: "license_not_found", message: "License key not found." } },
        { status: 404 }
      );
    }

    if (key === mockData.expiredLicenseKey) {
      return HttpResponse.json(
        { error: { code: "license_expired", message: "License has expired." } },
        { status: 422 }
      );
    }

    return HttpResponse.json({
      ...mockValidValidationResponse,
      license: {
        ...mockLicenseObject,
        key: key,
      },
    });
  }),

  // Offline token endpoint - POST /products/{slug}/licenses/{key}/offline_token
  http.post(`${API_BASE}/products/:slug/licenses/:key/offline_token`, async ({ request, params }) => {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return HttpResponse.json(
        { error: { code: "unauthorized", message: "Unauthorized" } },
        { status: 401 }
      );
    }

    const { key } = params;

    if (key === mockData.invalidLicenseKey) {
      return HttpResponse.json(
        { error: { code: "license_not_found", message: "License not found" } },
        { status: 404 }
      );
    }

    return HttpResponse.json({
      ...mockOfflineTokenResponse,
      token: {
        ...mockOfflineTokenResponse.token,
        license_key: key,
      },
    });
  }),
];
