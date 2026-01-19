# LicenseSeat JavaScript SDK

Official JavaScript/TypeScript SDK for [LicenseSeat](https://licenseseat.com) – the simple, secure licensing platform for apps, games, and plugins.

[![CI](https://github.com/licenseseat/licenseseat-js/actions/workflows/ci.yml/badge.svg)](https://github.com/licenseseat/licenseseat-js/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@licenseseat/js.svg)](https://www.npmjs.com/package/@licenseseat/js)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## Features

- **License activation & deactivation** – Activate licenses with automatic device fingerprinting
- **Online & offline validation** – Validate licenses with optional offline fallback
- **Entitlement checking** – Check feature access with `hasEntitlement()` and `checkEntitlement()`
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

  const sdk = new LicenseSeat({ apiKey: 'your-api-key' });
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
  // Required for authenticated operations
  apiKey: 'your-api-key',

  // API Configuration
  apiBaseUrl: 'https://licenseseat.com/api',  // Default

  // Storage
  storagePrefix: 'licenseseat_',              // localStorage key prefix

  // Auto-Validation
  autoValidateInterval: 3600000,              // 1 hour (in ms)
  autoInitialize: true,                       // Auto-validate cached license on init

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

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | `string` | `null` | API key for authentication (required for most operations) |
| `apiBaseUrl` | `string` | `'https://licenseseat.com/api'` | API base URL |
| `storagePrefix` | `string` | `'licenseseat_'` | Prefix for localStorage keys |
| `autoValidateInterval` | `number` | `3600000` | Auto-validation interval in ms (1 hour) |
| `autoInitialize` | `boolean` | `true` | Auto-initialize and validate cached license |
| `offlineFallbackEnabled` | `boolean` | `false` | Enable offline validation on network errors |
| `maxOfflineDays` | `number` | `0` | Maximum days license works offline (0 = disabled) |
| `maxRetries` | `number` | `3` | Max retry attempts for failed API calls |
| `retryDelay` | `number` | `1000` | Initial retry delay in ms (exponential backoff) |
| `debug` | `boolean` | `false` | Enable debug logging to console |

---

## API Reference

### Core Methods

#### `sdk.activate(licenseKey, options?)`

Activates a license key on this device.

```javascript
const result = await sdk.activate('LICENSE-KEY', {
  deviceIdentifier: 'custom-device-id',  // Optional: auto-generated if not provided
  softwareReleaseDate: '2024-01-15',     // Optional: for version-aware licensing
  metadata: { version: '1.0.0' }         // Optional: custom metadata
});

console.log(result);
// {
//   license_key: 'LICENSE-KEY',
//   device_identifier: 'web-abc123-xyz',
//   activated_at: '2024-01-15T10:30:00Z',
//   activation: { ... }
// }
```

#### `sdk.deactivate()`

Deactivates the current license and clears cached data.

```javascript
await sdk.deactivate();
```

#### `sdk.validateLicense(licenseKey, options?)`

Validates a license with the server.

```javascript
const result = await sdk.validateLicense('LICENSE-KEY', {
  deviceIdentifier: 'device-id',  // Optional
  productSlug: 'my-product'       // Optional
});

console.log(result);
// {
//   valid: true,
//   active_entitlements: [
//     { key: 'pro', name: 'Pro Features', expires_at: null },
//     { key: 'beta', name: 'Beta Access', expires_at: '2024-12-31T23:59:59Z' }
//   ]
// }
```

### Entitlement Methods

#### `sdk.hasEntitlement(key)`

Check if an entitlement is active. Returns a simple boolean.

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
//   device: 'web-abc123-xyz',
//   activated_at: '2024-01-15T10:30:00Z',
//   last_validated: '2024-01-15T11:30:00Z',
//   entitlements: [...]
// }
```

#### `sdk.testAuth()`

Test API authentication (useful for verifying API key).

```javascript
try {
  const result = await sdk.testAuth();
  console.log('Authenticated:', result.authenticated);
} catch (error) {
  console.error('Auth failed:', error);
}
```

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

| Event | Description | Data |
|-------|-------------|------|
| **Lifecycle** | | |
| `license:loaded` | Cached license loaded on init | `CachedLicense` |
| `sdk:reset` | SDK was reset | – |
| `sdk:destroyed` | SDK was destroyed | – |
| `sdk:error` | General SDK error | `{ message, error? }` |
| **Activation** | | |
| `activation:start` | Activation started | `{ licenseKey, deviceId }` |
| `activation:success` | Activation succeeded | `CachedLicense` |
| `activation:error` | Activation failed | `{ licenseKey, error }` |
| **Deactivation** | | |
| `deactivation:start` | Deactivation started | `CachedLicense` |
| `deactivation:success` | Deactivation succeeded | `Object` |
| `deactivation:error` | Deactivation failed | `{ error, license }` |
| **Validation** | | |
| `validation:start` | Validation started | `{ licenseKey }` |
| `validation:success` | Online validation succeeded | `ValidationResult` |
| `validation:failed` | Validation failed (invalid license) | `ValidationResult` |
| `validation:error` | Validation error (network, etc.) | `{ licenseKey, error }` |
| `validation:offline-success` | Offline validation succeeded | `ValidationResult` |
| `validation:offline-failed` | Offline validation failed | `ValidationResult` |
| `validation:auth-failed` | Auth failed during validation | `{ licenseKey, error, cached }` |
| **Auto-Validation** | | |
| `autovalidation:cycle` | Auto-validation scheduled | `{ nextRunAt: Date }` |
| `autovalidation:stopped` | Auto-validation stopped | – |
| **Network** | | |
| `network:online` | Network connectivity restored | – |
| `network:offline` | Network connectivity lost | `{ error }` |
| **Offline License** | | |
| `offlineLicense:fetching` | Fetching offline license | `{ licenseKey }` |
| `offlineLicense:fetched` | Offline license fetched | `{ licenseKey, data }` |
| `offlineLicense:fetchError` | Offline license fetch failed | `{ licenseKey, error }` |
| `offlineLicense:ready` | Offline assets synced | `{ kid, exp_at }` |
| `offlineLicense:verified` | Offline signature verified | `{ payload }` |
| `offlineLicense:verificationFailed` | Offline signature invalid | `{ payload }` |

---

## Singleton Pattern

For applications that need a shared SDK instance:

```javascript
import { configure, getSharedInstance, resetSharedInstance } from '@licenseseat/js';

// Configure once at app startup
configure({ apiKey: 'your-key' });

// Use anywhere in your app
const sdk = getSharedInstance();
await sdk.activate('LICENSE-KEY');

// Reset if needed
resetSharedInstance();
```

---

## Offline Support

The SDK supports offline license validation using cryptographically signed offline licenses (Ed25519).

```javascript
const sdk = new LicenseSeat({
  apiKey: 'your-key',
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

1. On activation, the SDK fetches a signed offline license from the server
2. The offline license contains the license data + Ed25519 signature
3. When offline, the SDK verifies the signature locally
4. Clock tamper detection prevents users from bypassing expiration

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
    console.log('Response:', error.data);
  } else if (error instanceof LicenseError) {
    console.log('License error:', error.code);
  }
}
```

### Error Types

| Error | Description |
|-------|-------------|
| `APIError` | HTTP request failures (includes `status` and `data`) |
| `LicenseError` | License operation failures (includes `code`) |
| `ConfigurationError` | SDK misconfiguration |
| `CryptoError` | Cryptographic operation failures |

---

## Browser Support

- **Modern browsers**: Chrome 80+, Firefox 75+, Safari 14+, Edge 80+
- **Bundlers**: Vite, Webpack, Rollup, esbuild, Parcel
- **Node.js**: 18+ (requires polyfills for `localStorage`, `document`)

---

## Usage Guide

### For JavaScript Users

Simply import and use:

```javascript
import LicenseSeat from '@licenseseat/js';

const sdk = new LicenseSeat({ apiKey: 'your-key' });
```

### For TypeScript Users

The package includes TypeScript declarations (`.d.ts` files) automatically. No additional `@types/` package needed.

```typescript
import LicenseSeat from '@licenseseat/js';

// Types are automatically available
const sdk = new LicenseSeat({ apiKey: 'your-key' });

// Import specific types if needed
import type {
  LicenseSeatConfig,
  ValidationResult,
  EntitlementCheckResult,
  LicenseStatus,
  Entitlement,
  CachedLicense
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

| Command | Description |
|---------|-------------|
| `npm run build` | Build JS bundle + TypeScript declarations |
| `npm run build:js` | Build JavaScript bundle only |
| `npm run build:types` | Generate TypeScript declarations |
| `npm run build:iife` | Build global/IIFE bundle |
| `npm run dev` | Watch mode for development |
| `npm test` | Run tests |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests with coverage report |
| `npm run typecheck` | Type-check without emitting |

### Project Structure

```
licenseseat-js/
├── src/
│   ├── index.js          # Entry point, exports
│   ├── LicenseSeat.js    # Main SDK class
│   ├── cache.js          # LicenseCache (localStorage)
│   ├── errors.js         # Error classes
│   ├── types.js          # JSDoc type definitions
│   └── utils.js          # Utility functions
├── tests/
│   ├── setup.js          # Test setup
│   ├── mocks/            # MSW handlers
│   ├── LicenseSeat.test.js
│   └── utils.test.js
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

| CDN | URL |
|-----|-----|
| **esm.sh** | `https://esm.sh/@licenseseat/js` |
| **unpkg** | `https://unpkg.com/@licenseseat/js/dist/index.js` |
| **jsDelivr** | `https://cdn.jsdelivr.net/npm/@licenseseat/js/dist/index.js` |
| **Skypack** | `https://cdn.skypack.dev/@licenseseat/js` |

**Version pinning** (recommended for production):
```html
<script type="module">
  import LicenseSeat from 'https://esm.sh/@licenseseat/js@0.2.0';
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
  const sdk = new LicenseSeat({ apiKey: 'your-key' });
</script>
```

---

## Versioning

This project follows [Semantic Versioning](https://semver.org/):

- **MAJOR** (1.0.0 → 2.0.0): Breaking changes
- **MINOR** (1.0.0 → 1.1.0): New features (backward compatible)
- **PATCH** (1.0.0 → 1.0.1): Bug fixes

---

## Migration from v0.1.x

### Breaking Changes in v0.2.0

| Change | Before | After | Migration |
|--------|--------|-------|-----------|
| `apiBaseUrl` default | `/api` | `https://licenseseat.com/api` | Set `apiBaseUrl` explicitly if using a relative URL |
| `offlineFallbackEnabled` default | `true` | `false` | Set `offlineFallbackEnabled: true` if you need offline fallback |

### New Features in v0.2.0

- `hasEntitlement(key)` method for simple boolean checks
- `autoInitialize` config option for lazy initialization
- Full TypeScript support with auto-generated `.d.ts` files
- Singleton pattern with `configure()` and `getSharedInstance()`
- New error classes: `LicenseError`, `ConfigurationError`, `CryptoError`

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

---

## Support

- **Email**: support@licenseseat.com
- **GitHub Issues**: [Report a bug](https://github.com/licenseseat/licenseseat-js/issues/new)
