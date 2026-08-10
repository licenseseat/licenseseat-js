/**
 * MSW (Mock Service Worker) request handlers for testing
 * These handlers mock the LicenseSeat API v1 endpoints.
 */

import { http, HttpResponse } from "msw";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import { canonicalJsonStringify } from "../../src/utils.js";

ed.etc.sha512Sync = (...messages) => sha512(ed.etc.concatBytes(...messages));
const TEST_PRIVATE_KEY = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const TEST_PUBLIC_KEY = Buffer.from(ed.getPublicKey(TEST_PRIVATE_KEY)).toString("base64");

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
  publicKey: TEST_PUBLIC_KEY,
};

/**
 * Mock license object (new v1 format)
 */
export const mockLicenseObject = {
  object: "license",
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
    object: "product",
    slug: mockData.productSlug,
    name: "Test Product",
  },
};

/**
 * Mock activation response (new v1 format)
 */
export const mockActivationResponse = {
  object: "activation",
  id: 123,
  fingerprint: mockData.deviceId,
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
export const mockValidValidationResponse = {
  object: "validation_result",
  valid: true,
  license: mockLicenseObject,
  activation: null,
};

/**
 * Mock deactivation response (new v1 format)
 */
export const mockDeactivationResponse = {
  object: "deactivation",
  activation_id: 123,
  deactivated_at: new Date().toISOString(),
};

/**
 * Mock offline token response (new v1 format)
 */
export function buildMockOfflineToken(licenseKey, fingerprint) {
  const now = Math.floor(Date.now() / 1000);
  const token = {
    schema_version: 1,
    license_key: licenseKey,
    product_slug: mockData.productSlug,
    plan_key: "pro",
    mode: "hardware_locked",
    seat_limit: 3,
    fingerprint,
    iat: now,
    exp: now + 30 * 24 * 60 * 60,
    nbf: now,
    license_expires_at: null,
    kid: mockData.keyId,
    entitlements: [
      {
        key: "pro",
        expires_at: null,
      },
    ],
    metadata: {},
  };
  const canonical = canonicalJsonStringify(token);
  return {
    object: "offline_token",
    token,
    signature: {
      algorithm: "Ed25519",
      key_id: mockData.keyId,
      value: Buffer.from(ed.sign(new TextEncoder().encode(canonical), TEST_PRIVATE_KEY)).toString(
        "base64"
      ),
    },
    canonical,
  };
}

/**
 * Mock signing key response (new v1 format)
 */
export const mockSigningKeyResponse = {
  object: "signing_key",
  key_id: mockData.keyId,
  algorithm: "Ed25519",
  public_key: mockData.publicKey,
  created_at: "2026-01-01T00:00:00Z",
  status: "active",
};

/**
 * Mock heartbeat response (new v1 format)
 */
export const mockHeartbeatResponse = {
  object: "heartbeat",
  received_at: new Date().toISOString(),
  license: mockLicenseObject,
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

  // Protected, side-effect-free authentication probe.
  http.get(`${API_BASE}/auth`, ({ request }) => {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return HttpResponse.json(
        { error: { code: "unauthorized", message: "Unauthorized" } },
        { status: 401 }
      );
    }
    return HttpResponse.json({
      object: "authentication",
      authenticated: true,
      scope: "licenses:validate",
      api_version: "2026-01-21",
      timestamp: new Date().toISOString(),
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

  // Activation endpoint - license key is intentionally carried in the body.
  http.post(`${API_BASE}/products/:slug/licenses/activate`, async ({ request }) => {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return HttpResponse.json(
        { error: { code: "unauthorized", message: "Unauthorized" } },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { license_key: key, fingerprint } = body;

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
      fingerprint: fingerprint || mockData.deviceId,
      license: {
        ...mockLicenseObject,
        key: key,
      },
    }, { status: 201 });
  }),

  http.post(`${API_BASE}/products/:slug/licenses/deactivate`, async ({ request }) => {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return HttpResponse.json(
        { error: { code: "unauthorized", message: "Unauthorized" } },
        { status: 401 }
      );
    }

    return HttpResponse.json(mockDeactivationResponse);
  }),

  http.post(`${API_BASE}/products/:slug/licenses/validate`, async ({ request }) => {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return HttpResponse.json(
        { error: { code: "unauthorized", message: "Unauthorized" } },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { license_key: key } = body;

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

  http.post(`${API_BASE}/products/:slug/licenses/heartbeat`, async ({ request }) => {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return HttpResponse.json(
        { error: { code: "unauthorized", message: "Unauthorized" } },
        { status: 401 }
      );
    }

    return HttpResponse.json(mockHeartbeatResponse);
  }),

  http.post(`${API_BASE}/products/:slug/licenses/offline-token`, async ({ request }) => {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return HttpResponse.json(
        { error: { code: "unauthorized", message: "Unauthorized" } },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { license_key: key } = body;

    if (key === mockData.invalidLicenseKey) {
      return HttpResponse.json(
        { error: { code: "license_not_found", message: "License not found" } },
        { status: 404 }
      );
    }

    return HttpResponse.json(buildMockOfflineToken(key, body.fingerprint || mockData.deviceId));
  }),
];
