# LicenseSeat - JavaScript SDK

[![CI](https://github.com/licenseseat/licenseseat-js/actions/workflows/ci.yml/badge.svg)](https://github.com/licenseseat/licenseseat-js/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@licenseseat/js.svg)](https://www.npmjs.com/package/@licenseseat/js)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

The official JavaScript/TypeScript SDK for [LicenseSeat](https://licenseseat.com) – the simple, secure licensing platform for apps, games, and plugins.

---

## Features

- **License activation & deactivation** – Activate licenses with automatic device fingerprinting
- **Online & offline validation** – Validate licenses with optional offline fallback
- **Entitlement checking** – Check feature access with `hasEntitlement()` and `checkEntitlement()`
- **Heartbeat** – Automatic periodic heartbeats to report device activity
- **Telemetry** – Auto-collected device and environment data sent with each API request
- **Local caching** – Secure localStorage-based caching with clock tamper detection
- **Auto-retry with exponential backoff** – Resilient network handling
- **Event-driven architecture** – Subscribe to SDK lifecycle events
- **TypeScript support** – Full type definitions included (auto-generated from JSDoc)
- **Modern ESM package** – Native ES modules, tree-shakeable

---

## Installation

### npm / yarn / pnpm

```bash
# npm
npm install @licenseseat/js

# yarn
yarn add @licenseseat/js

# pnpm
pnpm add @licenseseat/js
```

### CDN (Browser)

```html
<!-- ESM via esm.sh -->
<script type="module">
  import LicenseSeat from 'https://esm.sh/@licenseseat/js';

  const sdk = new LicenseSeat({
    apiKey: 'your-api-key',
    productSlug: 'your-product'
  });
</script>

<!-- ESM via unpkg -->
<script type="module">
  import LicenseSeat from 'https://unpkg.com/@licenseseat/js/dist/index.js';
</script>

<!-- ESM via jsDelivr -->
<script type="module">
  import LicenseSeat from 'https://cdn.jsdelivr.net/npm/@licenseseat/js/dist/index.js';
</script>
```

---

## Quick Start

### JavaScript (ESM)

```javascript
import LicenseSeat from '@licenseseat/js';

// Create SDK instance
const sdk = new LicenseSeat({
  apiKey: 'your-api-key',
  productSlug: 'your-product',  // Required: Your product slug
  debug: true
});

// Activate a license
await sdk.activate('YOUR-LICENSE-KEY');

// Check entitlements (simple boolean)
if (sdk.hasEntitlement('pro')) {
  // Enable pro features
}

// Get current status
const status = sdk.getStatus();
console.log(status);
// { status: 'active', license: '...', entitlements: [...] }
```

### TypeScript

```typescript
import LicenseSeat, {
  type LicenseSeatConfig,
  type ValidationResult,
  type EntitlementCheckResult,
  type LicenseStatus
} from '@licenseseat/js';

const config: LicenseSeatConfig = {
  apiKey: 'your-api-key',
  productSlug: 'your-product',
  debug: true
};

const sdk = new LicenseSeat(config);

// Full type inference
const result: ValidationResult = await sdk.validateLicense('LICENSE-KEY');
const status: LicenseStatus = sdk.getStatus();
const hasPro: boolean = sdk.hasEntitlement('pro');
```

TypeScript users get full type support automatically – the package includes generated `.d.ts` declaration files.

---

## Configuration

```javascript
const sdk = new LicenseSeat({
  // Required
  productSlug: 'your-product',            // Your product slug from LicenseSeat dashboard

  // Required for authenticated operations
  apiKey: 'your-api-key',

  // API Configuration
  apiBaseUrl: 'https://licenseseat.com/api/v1',  // Default

  // Storage
  storagePrefix: 'licenseseat_',              // localStorage key prefix

  // Auto-Validation
  autoValidateInterval: 3600000,              // 1 hour (in ms)
  autoInitialize: true,                       // Auto-validate cached license on init

  // Heartbeat
  heartbeatInterval: 300000,                  // 5 minutes (in ms), 0 to disable

  // Telemetry
  telemetryEnabled: true,                     // Set false to disable (e.g. GDPR)
  appVersion: '1.2.0',                        // Your app version (sent in telemetry)
  appBuild: '42',                             // Your app build number (sent in telemetry)

  // Offline Support
  offlineFallbackEnabled: false,              // Enable offline validation fallback
  maxOfflineDays: 0,                          // Max days offline (0 = disabled)
  offlineLicenseRefreshInterval: 259200000,   // 72 hours
  maxClockSkewMs: 300000,                     // 5 minutes

  // Network
  maxRetries: 3,                              // Retry attempts for failed requests
  retryDelay: 1000,                           // Initial retry delay (ms)
  networkRecheckInterval: 30000,              // Check connectivity every 30s when offline

  // Debug
  debug: false                                // Enable console logging
});
```

### Configuration Options

| Option                   | Type      | Default                            | Description                                               |
| ------------------------ | --------- | ---------------------------------- | --------------------------------------------------------- |
| `productSlug`            | `string`  | –                                  | **Required.** Your product slug from the dashboard        |
| `apiKey`                 | `string`  | `null`                             | API key for authentication (required for most operations) |
| `apiBaseUrl`             | `string`  | `'https://licenseseat.com/api/v1'` | API base URL                                              |
| `storagePrefix`          | `string`  | `'licenseseat_'`                   | Prefix for localStorage keys                              |
| `autoValidateInterval`   | `number`  | `3600000`                          | Auto-validation interval in ms (1 hour)                   |
| `autoInitialize`         | `boolean` | `true`                             | Auto-initialize and validate cached license               |
| `heartbeatInterval`      | `number`  | `300000`                           | Heartbeat interval in ms (5 minutes). Set `0` to disable  |
| `telemetryEnabled`       | `boolean` | `true`                             | Enable telemetry collection. Set `false` for GDPR compliance |
| `appVersion`             | `string`  | `null`                             | Your app version string (sent as `app_version` in telemetry) |
| `appBuild`               | `string`  | `null`                             | Your app build identifier (sent as `app_build` in telemetry) |
| `offlineFallbackEnabled` | `boolean` | `false`                            | Enable offline validation on network errors               |
| `maxOfflineDays`         | `number`  | `0`                                | Maximum days license works offline (0 = disabled)         |
| `maxRetries`             | `number`  | `3`                                | Max retry attempts for failed API calls                   |
| `retryDelay`             | `number`  | `1000`                             | Initial retry delay in ms (exponential backoff)           |
| `debug`                  | `boolean` | `false`                            | Enable debug logging to console                           |

---

## API Reference

### Core Methods

#### `sdk.activate(licenseKey, options?)`

Activates a license key on this device.

```javascript
const result = await sdk.activate('LICENSE-KEY', {
  deviceId: 'custom-device-id',       // Optional: auto-generated if not provided
  deviceName: "John's MacBook Pro",   // Optional: human-readable device name
  metadata: { version: '1.0.0' }      // Optional: custom metadata
});

console.log(result);
// {
//   license_key: 'LICENSE-KEY',
//   device_id: 'web-abc123',
//   activated_at: '2024-01-15T10:30:00Z',
//   activation: {
//     object: 'activation',
//     id: 123,
//     device_id: 'web-abc123',
//     license_key: 'LICENSE-KEY',
//     activated_at: '2024-01-15T10:30:00Z',
//     license: { ... }
//   }
// }
```

#### `sdk.deactivate()`

Deactivates the current license and clears cached data.

```javascript
const result = await sdk.deactivate();
console.log(result);
// {
//   object: 'deactivation',
//   activation_id: 123,
//   deactivated_at: '2024-01-15T12:00:00Z'
// }
```

#### `sdk.validateLicense(licenseKey, options?)`

Validates a license with the server.

```javascript
const result = await sdk.validateLicense('LICENSE-KEY', {
  deviceId: 'device-id'  // Optional: required for hardware_locked mode
});

console.log(result);
// {
//   valid: true,
//   license: {
//     key: 'LICENSE-KEY',
//     status: 'active',
//     mode: 'hardware_locked',
//     plan_key: 'pro',
//     active_seats: 1,
//     seat_limit: 3,
//     active_entitlements: [
//       { key: 'pro', expires_at: null, metadata: null },
//       { key: 'beta', expires_at: '2024-12-31T23:59:59Z', metadata: null }
//     ],
//     product: { slug: 'your-product', name: 'Your Product' }
//   },
//   active_entitlements: [...]
// }
```

### Entitlement Methods

> **Note:** Entitlements are optional. A license may have zero entitlements if the associated plan has no entitlements configured. The `active_entitlements` array may be empty or the field may be undefined/null.

#### `sdk.hasEntitlement(key)`

Check if an entitlement is active. Returns a simple boolean. Returns `false` if no entitlements exist.

```javascript
if (sdk.hasEntitlement('pro')) {
  enableProFeatures();
}

if (sdk.hasEntitlement('beta')) {
  showBetaUI();
}
```

#### `sdk.checkEntitlement(key)`

Check entitlement with detailed information.

```javascript
const result = sdk.checkEntitlement('pro');

if (result.active) {
  console.log('Entitlement:', result.entitlement);
  console.log('Expires:', result.entitlement.expires_at);
} else {
  console.log('Reason:', result.reason);
  // Possible reasons: 'no_license', 'not_found', 'expired'
}
```

### Status Methods

#### `sdk.getStatus()`

Get current license status.

```javascript
const status = sdk.getStatus();

// Possible status values:
// - 'inactive': No license activated
// - 'pending': License pending validation
// - 'active': License valid (online)
// - 'invalid': License invalid
// - 'offline-valid': License valid (offline verification)
// - 'offline-invalid': License invalid (offline verification)

console.log(status);
// {
//   status: 'active',
//   license: 'LICENSE-KEY',
//   device: 'web-abc123',
//   activated_at: '2024-01-15T10:30:00Z',
//   last_validated: '2024-01-15T11:30:00Z',
//   entitlements: [...]
// }
```

#### `sdk.testAuth()`

Test API connectivity by calling the `/health` endpoint. Returns health status and API version.

```javascript
try {
  const result = await sdk.testAuth();
  console.log('Authenticated:', result.authenticated);  // Always true if request succeeds
  console.log('Healthy:', result.healthy);              // API health status
  console.log('API Version:', result.api_version);      // e.g., '1.0.0'
} catch (error) {
  console.error('Connection failed:', error);
}
```

> **Note:** This method tests API connectivity, not API key validity. A successful response means the API is reachable. Authentication errors will surface when calling protected endpoints like `activate()` or `validateLicense()`.

#### `sdk.heartbeat()`

Send a heartbeat to report that the current device is still active. Heartbeats are sent automatically at the configured `heartbeatInterval`, but you can also send one manually.

```javascript
try {
  const result = await sdk.heartbeat();
  console.log('Heartbeat received at:', result.received_at);
} catch (error) {
  console.error('Heartbeat failed:', error);
}
```

Returns `undefined` if no active license is cached. When auto-heartbeat is enabled (the default), the SDK sends heartbeats every 5 minutes while a license is active. Auto-heartbeat starts automatically after `activate()` or when the SDK initializes with a cached license.

To disable auto-heartbeat, set `heartbeatInterval: 0` in the configuration.

#### `sdk.reset()`

Clear all cached data and reset SDK state.

```javascript
sdk.reset();
```

#### `sdk.destroy()`

Destroy the SDK instance and release all resources. Call this when you no longer need the SDK to prevent memory leaks. After calling `destroy()`, the SDK instance should not be used.

```javascript
// When unmounting a component or closing an app
sdk.destroy();
```

#### `sdk.initialize()`

Manually initialize the SDK (only needed if `autoInitialize: false`).

```javascript
const sdk = new LicenseSeat({
  apiKey: 'key',
  productSlug: 'your-product',
  autoInitialize: false  // Don't auto-initialize
});

// Later, when ready:
sdk.initialize();
```

---

## Events

Subscribe to SDK lifecycle events for reactive UIs.

```javascript
// Subscribe
const unsubscribe = sdk.on('activation:success', (data) => {
  console.log('License activated:', data);
});

// Unsubscribe
unsubscribe();
// or
sdk.off('activation:success', handler);
```

### Available Events

| Event                               | Description                         | Data                            |
| ----------------------------------- | ----------------------------------- | ------------------------------- |
| **Lifecycle**                       |                                     |                                 |
| `license:loaded`                    | Cached license loaded on init       | `CachedLicense`                 |
| `sdk:reset`                         | SDK was reset                       | –                               |
| `sdk:destroyed`                     | SDK was destroyed                   | –                               |
| `sdk:error`                         | General SDK error                   | `{ message, error? }`           |
| **Activation**                      |                                     |                                 |
| `activation:start`                  | Activation started                  | `{ licenseKey, deviceId }`      |
| `activation:success`                | Activation succeeded                | `CachedLicense`                 |
| `activation:error`                  | Activation failed                   | `{ licenseKey, error }`         |
| **Deactivation**                    |                                     |                                 |
| `deactivation:start`                | Deactivation started                | `CachedLicense`                 |
| `deactivation:success`              | Deactivation succeeded              | `DeactivationResponse`          |
| `deactivation:error`                | Deactivation failed                 | `{ error, license }`            |
| **Validation**                      |                                     |                                 |
| `validation:start`                  | Validation started                  | `{ licenseKey }`                |
| `validation:success`                | Online validation succeeded         | `ValidationResult`              |
| `validation:failed`                 | Validation failed (invalid license) | `ValidationResult`              |
| `validation:error`                  | Validation error (network, etc.)    | `{ licenseKey, error }`         |
| `validation:offline-success`        | Offline validation succeeded        | `ValidationResult`              |
| `validation:offline-failed`         | Offline validation failed           | `ValidationResult`              |
| `validation:auth-failed`            | Auth failed during validation       | `{ licenseKey, error, cached }` |
| **Auto-Validation**                 |                                     |                                 |
| `autovalidation:cycle`              | Auto-validation scheduled           | `{ nextRunAt: Date }`           |
| `autovalidation:stopped`            | Auto-validation stopped             | –                               |
| **Heartbeat**                       |                                     |                                 |
| `heartbeat:success`                 | Heartbeat acknowledged by server    | `HeartbeatResponse`             |
| `heartbeat:cycle`                   | Auto-heartbeat tick completed       | `{ nextRunAt: Date }`           |
| **Network**                         |                                     |                                 |
| `network:online`                    | Network connectivity restored       | –                               |
| `network:offline`                   | Network connectivity lost           | `{ error }`                     |
| **Offline Token**                   |                                     |                                 |
| `offlineToken:fetching`             | Fetching offline token              | `{ licenseKey }`                |
| `offlineToken:fetched`              | Offline token fetched               | `{ licenseKey, data }`          |
| `offlineToken:fetchError`           | Offline token fetch failed          | `{ licenseKey, error }`         |
| `offlineToken:ready`                | Offline assets synced               | `{ kid, exp_at }`               |
| `offlineToken:verified`             | Offline signature verified          | `{ payload }`                   |
| `offlineToken:verificationFailed`   | Offline signature invalid           | `{ payload }`                   |

---

## Singleton Pattern

For applications that need a shared SDK instance:

```javascript
import { configure, getSharedInstance, resetSharedInstance } from '@licenseseat/js';

// Configure once at app startup
configure({
  apiKey: 'your-key',
  productSlug: 'your-product'
});

// Use anywhere in your app
const sdk = getSharedInstance();
await sdk.activate('LICENSE-KEY');

// Reset if needed
resetSharedInstance();
```

---

## Offline Support

The SDK supports offline license validation using cryptographically signed offline tokens (Ed25519).

```javascript
const sdk = new LicenseSeat({
  apiKey: 'your-key',
  productSlug: 'your-product',
  offlineFallbackEnabled: true,  // Enable offline fallback
  maxOfflineDays: 7              // Allow 7 days offline
});

// After activation, offline assets are automatically synced
await sdk.activate('LICENSE-KEY');

// Later, even offline, validation will work using cached data
const result = await sdk.validateLicense('LICENSE-KEY');
if (result.offline) {
  console.log('Validated offline');
}
```

### How Offline Validation Works

1. On activation, the SDK fetches a signed offline token from the server
2. The offline token contains:
   - License data (key, plan, entitlements, expiration)
   - Ed25519 signature
   - Canonical JSON for verification
3. When offline, the SDK verifies the signature locally
4. Clock tamper detection prevents users from bypassing expiration

### Offline Methods

#### `sdk.syncOfflineAssets()`

Fetches the offline token and signing key from the server. Uses the currently cached license. Call this after activation to prepare for offline usage.

```javascript
// First activate (caches the license)
await sdk.activate('LICENSE-KEY');

// Then sync offline assets (uses cached license)
const assets = await sdk.syncOfflineAssets();
console.log('Offline token key ID:', assets.kid);
console.log('Expires at:', assets.exp_at);
```

#### `sdk.getOfflineToken()`

Fetches a signed offline token for the currently cached license. Returns the token structure containing the license data and Ed25519 signature.

```javascript
// Must have an active license cached first
const token = await sdk.getOfflineToken();
console.log(token);
// {
//   object: 'offline_token',
//   token: { license_key, product_slug, plan_key, ... },
//   signature: { algorithm: 'Ed25519', key_id, value },
//   canonical: '...'
// }
```

#### `sdk.getSigningKey(keyId)`

Fetches the Ed25519 public key used for verifying offline token signatures.

```javascript
const signingKey = await sdk.getSigningKey('key-id-001');
console.log(signingKey);
// {
//   object: 'signing_key',
//   kid: 'key-id-001',
//   public_key: 'base64-encoded-public-key',
//   algorithm: 'Ed25519',
//   created_at: '2024-01-01T00:00:00Z'
// }
```

#### `sdk.verifyOfflineToken(token, publicKeyB64)`

Verifies an offline token's Ed25519 signature locally. **Both parameters are required.**

```javascript
// Fetch the token and signing key first
const token = await sdk.getOfflineToken();
const signingKey = await sdk.getSigningKey(token.signature.key_id);

// Verify the signature
const isValid = await sdk.verifyOfflineToken(token, signingKey.public_key);
console.log('Signature valid:', isValid);
```

> **Important:** The `verifyOfflineToken()` method requires you to pass both the token and the public key. Fetch the signing key using `getSigningKey()` with the `key_id` from the token's signature.

### Offline Token Structure

```javascript
{
  object: 'offline_token',
  token: {
    schema_version: 1,
    license_key: 'LICENSE-KEY',
    product_slug: 'your-product',
    plan_key: 'pro',
    mode: 'hardware_locked',
    device_id: 'web-abc123',
    iat: 1704067200,        // Issued at (Unix timestamp)
    exp: 1706659200,        // Expires at (Unix timestamp)
    nbf: 1704067200,        // Not before (Unix timestamp)
    license_expires_at: null,
    kid: 'key-id-001',
    entitlements: [
      { key: 'pro', expires_at: null }
    ],
    metadata: {}
  },
  signature: {
    algorithm: 'Ed25519',
    key_id: 'key-id-001',
    value: 'base64url-encoded-signature'
  },
  canonical: '{"entitlements":[...],"exp":...}'
}
```

---

## Telemetry

The SDK automatically collects non-PII (non-personally-identifiable) device and environment data and includes it with every POST request sent to the LicenseSeat API. This data helps you understand what platforms and environments your customers use.

Telemetry is **enabled by default** and can be disabled at any time.

### Collected Fields

| Field                | Type     | Example                | Description                                      |
| -------------------- | -------- | ---------------------- | ------------------------------------------------ |
| `sdk_name`           | `string` | `"js"`                 | Always `"js"` for this SDK                       |
| `sdk_version`        | `string` | `"0.4.0"`              | SDK version                                      |
| `os_name`            | `string` | `"macOS"`              | Operating system name                            |
| `os_version`         | `string` | `"14.2.1"`             | Operating system version                         |
| `platform`           | `string` | `"browser"`            | Runtime platform (`browser`, `node`, `electron`, `react-native`, `deno`, `bun`) |
| `device_model`       | `string` | `null`                 | Device model (Chromium userAgentData only)        |
| `device_type`        | `string` | `"desktop"`            | Device type (`desktop`, `phone`, `tablet`, `server`) |
| `locale`             | `string` | `"en-US"`              | Full locale string                               |
| `timezone`           | `string` | `"America/New_York"`   | IANA timezone                                    |
| `language`           | `string` | `"en"`                 | 2-letter language code                           |
| `architecture`       | `string` | `"arm64"`              | CPU architecture                                 |
| `cpu_cores`          | `number` | `10`                   | Number of logical CPU cores                      |
| `memory_gb`          | `number` | `16`                   | Approximate RAM in GB (Chrome/Node.js only)      |
| `screen_resolution`  | `string` | `"1920x1080"`          | Screen resolution                                |
| `display_scale`      | `number` | `2`                    | Device pixel ratio                               |
| `browser_name`       | `string` | `"Chrome"`             | Browser name (browser environments only)         |
| `browser_version`    | `string` | `"123.0"`              | Browser version (browser environments only)      |
| `runtime_version`    | `string` | `"20.11.0"`            | Runtime version (Node.js, Deno, Bun, Electron)   |
| `app_version`        | `string` | `"1.2.0"`              | Your app version (from `appVersion` config)      |
| `app_build`          | `string` | `"42"`                 | Your app build (from `appBuild` config)          |

Fields that cannot be detected in the current environment are omitted (not sent as `null`).

### Providing App Version

Pass your own app version and build number via configuration so they appear in telemetry:

```javascript
const sdk = new LicenseSeat({
  apiKey: 'your-key',
  productSlug: 'your-product',
  appVersion: '1.2.0',
  appBuild: '42'
});
```

### Disabling Telemetry

To disable telemetry collection entirely (for example, to comply with GDPR or other privacy regulations):

```javascript
const sdk = new LicenseSeat({
  apiKey: 'your-key',
  productSlug: 'your-product',
  telemetryEnabled: false
});
```

When telemetry is disabled, no device or environment data is attached to API requests.

### Privacy

Telemetry collects only non-personally-identifiable information. No IP addresses, user names, email addresses, or other PII are collected by the SDK. The data is used solely to help you understand the platforms and environments where your software is used.

Telemetry is opt-out: set `telemetryEnabled: false` to disable it completely.

---

## Heartbeat

The SDK sends periodic heartbeat signals to let the server know a device is still actively using the license. This enables usage analytics and helps detect inactive seats.

### How It Works

- After a license is activated (or when the SDK initializes with a cached license), a heartbeat timer starts automatically.
- The default interval is **5 minutes** (`300000` ms), configurable via `heartbeatInterval`.
- Each heartbeat sends the current `device_id` to the server.
- Heartbeats also run alongside auto-validation cycles.

### Manual Heartbeat

You can send a heartbeat at any time:

```javascript
await sdk.heartbeat();
```

### Configuring the Interval

```javascript
const sdk = new LicenseSeat({
  apiKey: 'your-key',
  productSlug: 'your-product',
  heartbeatInterval: 600000  // 10 minutes
});
```

Set `heartbeatInterval: 0` to disable auto-heartbeat entirely. You can still call `sdk.heartbeat()` manually.

### Heartbeat Events

| Event               | Description                        | Data                    |
| -------------------- | ---------------------------------- | ----------------------- |
| `heartbeat:success`  | Heartbeat acknowledged by server   | `HeartbeatResponse`     |
| `heartbeat:cycle`    | Auto-heartbeat tick completed      | `{ nextRunAt: Date }`   |

```javascript
sdk.on('heartbeat:success', (data) => {
  console.log('Heartbeat received at:', data.received_at);
});
```

### Heartbeat Lifecycle

- **Starts** automatically after `sdk.activate()` succeeds, or on SDK init if a cached license exists.
- **Stops** automatically when `sdk.deactivate()`, `sdk.reset()`, or `sdk.destroy()` is called.
- Heartbeat failures are logged (in debug mode) but do not throw or interrupt the SDK.

---

## Error Handling

The SDK exports custom error classes for precise error handling:

```javascript
import LicenseSeat, {
  APIError,
  LicenseError,
  ConfigurationError,
  CryptoError
} from '@licenseseat/js';

try {
  await sdk.activate('INVALID-KEY');
} catch (error) {
  if (error instanceof APIError) {
    console.log('HTTP Status:', error.status);
    console.log('Error Code:', error.data?.error?.code);
    console.log('Error Message:', error.data?.error?.message);
  } else if (error instanceof LicenseError) {
    console.log('License error:', error.code);
  } else if (error instanceof ConfigurationError) {
    console.log('Config error:', error.message);
  }
}
```

### Error Types

| Error                | Description                                          |
| -------------------- | ---------------------------------------------------- |
| `APIError`           | HTTP request failures (includes `status` and `data`) |
| `LicenseError`       | License operation failures (includes `code`)         |
| `ConfigurationError` | SDK misconfiguration (e.g., missing `productSlug`)   |
| `CryptoError`        | Cryptographic operation failures                     |

### API Error Format

API errors follow this structure:

```javascript
{
  error: {
    code: 'license_not_found',       // Machine-readable error code
    message: 'License not found.',   // Human-readable message
    details: { ... }                 // Optional additional details
  }
}
```

Common error codes:
- `unauthorized` - Invalid or missing API key
- `license_not_found` - License key doesn't exist
- `license_expired` - License has expired
- `license_suspended` - License is suspended
- `license_revoked` - License has been revoked
- `seat_limit_reached` - No more seats available
- `device_already_activated` - Device is already activated
- `activation_not_found` - Activation doesn't exist (for deactivation)

---

## Browser Support

- **Modern browsers**: Chrome 80+, Firefox 75+, Safari 14+, Edge 80+
- **Bundlers**: Vite, Webpack, Rollup, esbuild, Parcel
- **Node.js**: 18+ (requires polyfills - see below)

### Node.js Usage

The SDK is designed for browsers but works in Node.js with polyfills. Add these before importing the SDK:

```javascript
// Required polyfills for Node.js
const storage = {};
globalThis.localStorage = {
  getItem(key) { return Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null; },
  setItem(key, value) { storage[key] = String(value); },
  removeItem(key) { delete storage[key]; },
  clear() { for (const key in storage) delete storage[key]; },
};

// Override Object.keys to support localStorage iteration (used by cache.getAllKeys())
const originalKeys = Object.keys;
Object.keys = function(obj) {
  if (obj === globalThis.localStorage) return originalKeys(storage);
  return originalKeys(obj);
};

// Device fingerprinting polyfills (provides stable fallback values)
globalThis.document = { createElement: () => ({ getContext: () => null }), querySelector: () => null };
globalThis.window = { navigator: {}, screen: {} };
globalThis.navigator = { userAgent: 'Node.js', language: 'en', hardwareConcurrency: 4 };

// Now import the SDK
const { default: LicenseSeat } = await import('@licenseseat/js');
```

> **Note:** In Node.js, device fingerprinting will use fallback values since browser APIs aren't available. For consistent device identification across restarts, pass an explicit `deviceId` to `activate()`.

---

## Usage Guide

### For JavaScript Users

Simply import and use:

```javascript
import LicenseSeat from '@licenseseat/js';

const sdk = new LicenseSeat({
  apiKey: 'your-key',
  productSlug: 'your-product'
});
```

### For TypeScript Users

The package includes TypeScript declarations (`.d.ts` files) automatically. No additional `@types/` package needed.

```typescript
import LicenseSeat from '@licenseseat/js';

// Types are automatically available
const sdk = new LicenseSeat({
  apiKey: 'your-key',
  productSlug: 'your-product'
});

// Import specific types if needed
import type {
  LicenseSeatConfig,
  ValidationResult,
  EntitlementCheckResult,
  LicenseStatus,
  Entitlement,
  CachedLicense,
  ActivationResponse,
  DeactivationResponse,
  OfflineToken
} from '@licenseseat/js';
```

### For CDN/Browser Users

Use ES modules via CDN:

```html
<!DOCTYPE html>
<html>
<head>
  <title>LicenseSeat Demo</title>
</head>
<body>
  <script type="module">
    import LicenseSeat from 'https://esm.sh/@licenseseat/js';

    const sdk = new LicenseSeat({
      apiKey: 'your-api-key',
      productSlug: 'your-product',
      debug: true
    });

    // Check for existing license
    const status = sdk.getStatus();
    if (status.status === 'active') {
      console.log('Already licensed!');
    }

    // Activate (example with user input)
    document.getElementById('activate-btn').onclick = async () => {
      const key = document.getElementById('license-key').value;
      try {
        await sdk.activate(key);
        alert('License activated!');
      } catch (e) {
        alert('Activation failed: ' + e.message);
      }
    };
  </script>

  <input id="license-key" placeholder="Enter license key" />
  <button id="activate-btn">Activate</button>
</body>
</html>
```

---

## Development

### Setup

```bash
git clone https://github.com/licenseseat/licenseseat-js.git
cd licenseseat-js
npm install
```

### Scripts

| Command                 | Description                               |
| ----------------------- | ----------------------------------------- |
| `npm run build`         | Build JS bundle + TypeScript declarations |
| `npm run build:js`      | Build JavaScript bundle only              |
| `npm run build:types`   | Generate TypeScript declarations          |
| `npm run build:iife`    | Build global/IIFE bundle                  |
| `npm run dev`           | Watch mode for development                |
| `npm test`              | Run tests                                 |
| `npm run test:watch`    | Run tests in watch mode                   |
| `npm run test:coverage` | Run tests with coverage report            |
| `npm run typecheck`     | Type-check without emitting               |

### Integration Tests

The SDK includes comprehensive integration tests that run against the live LicenseSeat API. These tests verify real-world functionality including activation, validation, deactivation, and offline cryptographic operations.

#### Running Integration Tests (Node.js)

```bash
# Set environment variables
export LICENSESEAT_API_KEY="ls_your_api_key_here"
export LICENSESEAT_PRODUCT_SLUG="your-product"
export LICENSESEAT_LICENSE_KEY="YOUR-LICENSE-KEY"

# Run the tests
node test-live.mjs
```

Or with inline environment variables:

```bash
LICENSESEAT_API_KEY=ls_xxx LICENSESEAT_PRODUCT_SLUG=my-app LICENSESEAT_LICENSE_KEY=XXX-XXX node test-live.mjs
```

#### Running Integration Tests (Browser)

Open `test-live.html` in a browser. You'll be prompted to enter your credentials:

1. **API Key** - Your LicenseSeat API key (starts with `ls_`)
2. **Product Slug** - Your product identifier
3. **License Key** - A valid license key for testing

Credentials are stored in `localStorage` for convenience during development.

#### What the Integration Tests Cover

| Category | Tests |
|----------|-------|
| **Initialization** | SDK setup, configuration defaults |
| **Activation** | License activation, device ID generation |
| **Validation** | Online validation, entitlement checking |
| **Deactivation** | License deactivation, cache clearing |
| **Offline Crypto** | Ed25519 signature verification, offline token fetching, tamper detection |
| **Error Handling** | Invalid licenses, missing config |
| **Singleton** | Shared instance pattern |

### Project Structure

```
licenseseat-js/
├── src/
│   ├── index.js          # Entry point, exports
│   ├── LicenseSeat.js    # Main SDK class
│   ├── telemetry.js      # Telemetry collection (device/environment data)
│   ├── cache.js          # LicenseCache (localStorage)
│   ├── errors.js         # Error classes
│   ├── types.js          # JSDoc type definitions
│   └── utils.js          # Utility functions
├── tests/                # Unit tests (mocked API)
│   ├── setup.js          # Test setup
│   ├── mocks/            # MSW handlers
│   ├── LicenseSeat.test.js
│   └── utils.test.js
├── test-live.mjs         # Integration tests (Node.js)
├── test-live.html        # Integration tests (Browser)
├── dist/                 # Build output
│   ├── index.js          # ESM bundle
│   └── types/            # TypeScript declarations
├── package.json
├── tsconfig.json
└── vitest.config.js
```

---

## Publishing

### Publishing to npm

1. **Update version** in `package.json`:
   ```bash
   npm version patch  # or minor, major
   ```

2. **Build the package**:
   ```bash
   npm run build
   ```

3. **Verify the build**:
   ```bash
   # Check what will be published
   npm pack --dry-run

   # Verify TypeScript types
   ls dist/types/
   ```

4. **Publish**:
   ```bash
   # Login if needed
   npm login

   # Publish (public package)
   npm publish --access public
   ```

### What Gets Published

The `files` field in `package.json` controls what's included:

```json
{
  "files": ["dist/", "src/"]
}
```

Users receive:
- `dist/index.js` – ESM bundle (JavaScript)
- `dist/types/*.d.ts` – TypeScript declarations
- `src/*.js` – Source files (for debugging/reference)

### Package Exports

```json
{
  "main": "dist/index.js",
  "module": "dist/index.js",
  "types": "dist/types/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/types/index.d.ts"
    }
  }
}
```

This ensures:
- JavaScript users get `dist/index.js`
- TypeScript users get type definitions from `dist/types/index.d.ts`
- Both ESM `import` and bundlers work correctly

### CDN Distribution

Once published to npm, the package is automatically available on CDNs:

| CDN          | URL                                                          |
| ------------ | ------------------------------------------------------------ |
| **esm.sh**   | `https://esm.sh/@licenseseat/js`                             |
| **unpkg**    | `https://unpkg.com/@licenseseat/js/dist/index.js`            |
| **jsDelivr** | `https://cdn.jsdelivr.net/npm/@licenseseat/js/dist/index.js` |
| **Skypack**  | `https://cdn.skypack.dev/@licenseseat/js`                    |

**Version pinning** (recommended for production):
```html
<script type="module">
  import LicenseSeat from 'https://esm.sh/@licenseseat/js@0.4.0';
</script>
```

### Self-Hosting

To host the SDK yourself:

1. Build the package:
   ```bash
   npm run build
   ```

2. Copy `dist/index.js` to your CDN/server

3. Serve with correct MIME type (`application/javascript`) and CORS headers

### Building an IIFE Bundle (Legacy Browsers)

For a global `LicenseSeat` variable (non-module script tags):

```bash
npm run build:iife
```

This creates `dist/index.global.js`:

```html
<script src="/path/to/index.global.js"></script>
<script>
  const sdk = new LicenseSeat({
    apiKey: 'your-key',
    productSlug: 'your-product'
  });
</script>
```

---

## Versioning

This project follows [Semantic Versioning](https://semver.org/):

- **MAJOR** (1.0.0 → 2.0.0): Breaking changes
- **MINOR** (1.0.0 → 1.1.0): New features (backward compatible)
- **PATCH** (1.0.0 → 1.0.1): Bug fixes

---

## Migration from v0.2.x

### Breaking Changes in v0.3.0

This version introduces the v1 API with significant changes:

| Change                           | Before (v0.2.x)                 | After (v0.3.0)                            |
| -------------------------------- | ------------------------------- | ----------------------------------------- |
| `productSlug` config             | Not required                    | **Required** for all API operations       |
| `apiBaseUrl` default             | `https://licenseseat.com/api`   | `https://licenseseat.com/api/v1`          |
| `deviceIdentifier` option        | `deviceIdentifier`              | `deviceId`                                |
| `device_identifier` field        | `device_identifier`             | `device_id`                               |
| Deactivation response            | Returns full activation object  | Returns `{ object, activation_id, deactivated_at }` |
| `getOfflineLicense()` method     | Available                       | Renamed to `getOfflineToken()`            |
| `getPublicKey()` method          | Available                       | Renamed to `getSigningKey()`              |
| Offline license structure        | Legacy format                   | New token/signature/canonical format      |
| Error format                     | Various                         | `{ error: { code, message, details? } }`  |

### Migration Steps

1. **Add `productSlug` to configuration:**
   ```javascript
   // Before
   const sdk = new LicenseSeat({ apiKey: 'key' });

   // After
   const sdk = new LicenseSeat({
     apiKey: 'key',
     productSlug: 'your-product'  // Required!
   });
   ```

2. **Update activation options:**
   ```javascript
   // Before
   await sdk.activate('KEY', { deviceIdentifier: 'id' });

   // After
   await sdk.activate('KEY', { deviceId: 'id' });
   ```

3. **Update response field access:**
   ```javascript
   // Before
   const result = await sdk.activate('KEY');
   console.log(result.device_identifier);

   // After
   const result = await sdk.activate('KEY');
   console.log(result.device_id);
   ```

4. **Update deactivation handling:**
   ```javascript
   // Before
   const result = await sdk.deactivate();
   console.log(result.license_key);

   // After
   const result = await sdk.deactivate();
   console.log(result.activation_id);
   console.log(result.deactivated_at);
   ```

5. **Update offline method calls:**
   ```javascript
   // Before
   await sdk.getOfflineLicense(key);
   await sdk.getPublicKey(keyId);

   // After (note: getOfflineToken uses cached license, no parameter needed)
   await sdk.getOfflineToken();
   await sdk.getSigningKey(keyId);
   ```

---

## License

MIT License – see [LICENSE](LICENSE) for details.

---

## Links

- [LicenseSeat Website](https://licenseseat.com)
- [Documentation](https://licenseseat.com/docs)
- [API Reference](https://licenseseat.com/docs/api)
- [GitHub Repository](https://github.com/licenseseat/licenseseat-js)
- [npm Package](https://www.npmjs.com/package/@licenseseat/js)
- [Report Issues](https://github.com/licenseseat/licenseseat-js/issues)
