# LicenseSeat JavaScript SDK

Official JavaScript/TypeScript client for [LicenseSeat](https://licenseseat.com) – the simple, secure licensing platform for apps, games, and plugins.

This SDK helps you integrate license activation, validation, offline caching, entitlement checks, and more into your JavaScript and browser-based apps.

## Features

- **License activation & deactivation** - Activate licenses with device fingerprinting
- **Online & offline validation** - Validate licenses with automatic offline fallback
- **Entitlement checking** - Check feature access with `hasEntitlement()` and `checkEntitlement()`
- **Encrypted local caching** - Secure localStorage-based caching
- **Auto-retry with exponential backoff** - Resilient network handling
- **Event-driven architecture** - Subscribe to SDK lifecycle events
- **TypeScript support** - Full type definitions included
- **Zero dependencies in browser** - Core crypto via `@noble/ed25519`

## Installation

```bash
npm install @licenseseat/js
```

Or via yarn:

```bash
yarn add @licenseseat/js
```

## Quick Start

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

// Check entitlements (detailed info)
const result = sdk.checkEntitlement('pro');
if (result.active) {
  console.log('Entitlement:', result.entitlement);
}

// Get current status
const status = sdk.getStatus();
console.log(status); // { status: 'active', license: '...', entitlements: [...] }
```

## Configuration

```javascript
const sdk = new LicenseSeat({
  // Required for authenticated operations
  apiKey: 'your-api-key',

  // API base URL (default: https://api.licenseseat.com)
  apiBaseUrl: 'https://api.licenseseat.com',

  // Storage key prefix (default: 'licenseseat_')
  storagePrefix: 'licenseseat_',

  // Auto-validation interval in ms (default: 1 hour)
  autoValidateInterval: 3600000,

  // Enable offline validation fallback (default: false)
  // Set to true to allow cached license validation on network errors
  offlineFallbackEnabled: false,

  // Maximum days license can work offline (default: 0 = disabled)
  maxOfflineDays: 7,

  // Auto-initialize on construction (default: true)
  // Set to false for lazy initialization
  autoInitialize: true,

  // Enable debug logging (default: false)
  debug: false,

  // Network retry settings
  maxRetries: 3,
  retryDelay: 1000,
});
```

## API Reference

### Constructor

#### `new LicenseSeat(config)`

Creates a new SDK instance with the specified configuration.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | `string` | `null` | API key for authentication |
| `apiBaseUrl` | `string` | `'https://api.licenseseat.com'` | API base URL |
| `storagePrefix` | `string` | `'licenseseat_'` | localStorage key prefix |
| `autoValidateInterval` | `number` | `3600000` | Auto-validation interval (ms) |
| `offlineFallbackEnabled` | `boolean` | `false` | Enable offline validation fallback |
| `maxOfflineDays` | `number` | `0` | Max offline days (0 = disabled) |
| `autoInitialize` | `boolean` | `true` | Auto-initialize on construction |
| `debug` | `boolean` | `false` | Enable debug logging |

### Core Methods

#### `sdk.activate(licenseKey, options?)`

Activates a license key on this device.

```javascript
const result = await sdk.activate('LICENSE-KEY', {
  deviceIdentifier: 'custom-device-id', // optional
  metadata: { version: '1.0.0' }        // optional
});
```

**Returns:** `Promise<CachedLicense>` - The activated license data

#### `sdk.deactivate()`

Deactivates the current license.

```javascript
await sdk.deactivate();
```

**Returns:** `Promise<Object>` - Deactivation result

#### `sdk.validateLicense(licenseKey, options?)`

Validates a license with the server.

```javascript
const result = await sdk.validateLicense('LICENSE-KEY');
console.log(result.valid); // true or false
console.log(result.active_entitlements); // array of entitlements
```

**Returns:** `Promise<ValidationResult>` - Validation result with entitlements

### Entitlement Methods

#### `sdk.hasEntitlement(key)`

Check if an entitlement is active (simple boolean).

```javascript
if (sdk.hasEntitlement('pro')) {
  // Enable pro features
}
```

**Returns:** `boolean` - `true` if entitlement is active

#### `sdk.checkEntitlement(key)`

Check entitlement with detailed information.

```javascript
const result = sdk.checkEntitlement('pro');

if (result.active) {
  console.log('Expires:', result.entitlement.expires_at);
} else {
  console.log('Reason:', result.reason); // 'no_license', 'not_found', 'expired'
}
```

**Returns:** `EntitlementCheckResult` - Detailed entitlement status

### Status Methods

#### `sdk.getStatus()`

Get current license status.

```javascript
const status = sdk.getStatus();
// { status: 'active', license: '...', device: '...', entitlements: [...] }
// status can be: 'inactive', 'pending', 'active', 'invalid', 'offline-valid', 'offline-invalid'
```

#### `sdk.testAuth()`

Test API authentication.

```javascript
const result = await sdk.testAuth();
console.log(result.authenticated); // true
```

#### `sdk.reset()`

Clear all cached data and reset SDK state.

```javascript
sdk.reset();
```

### Event Handling

#### `sdk.on(event, callback)`

Subscribe to SDK events.

```javascript
const unsubscribe = sdk.on('activation:success', (data) => {
  console.log('License activated:', data);
});

// Later: unsubscribe
unsubscribe();
```

#### `sdk.off(event, callback)`

Unsubscribe from events.

```javascript
sdk.off('activation:success', handler);
```

### Available Events

| Event | Description | Data |
|-------|-------------|------|
| `license:loaded` | Cached license loaded on init | `CachedLicense` |
| `activation:start` | Activation started | `{ licenseKey, deviceId }` |
| `activation:success` | Activation succeeded | `CachedLicense` |
| `activation:error` | Activation failed | `{ licenseKey, error }` |
| `deactivation:start` | Deactivation started | `CachedLicense` |
| `deactivation:success` | Deactivation succeeded | `Object` |
| `deactivation:error` | Deactivation failed | `{ error, license }` |
| `validation:start` | Validation started | `{ licenseKey }` |
| `validation:success` | Online validation succeeded | `ValidationResult` |
| `validation:failed` | Validation failed (invalid license) | `ValidationResult` |
| `validation:error` | Validation error (network, etc.) | `{ licenseKey, error }` |
| `validation:offline-success` | Offline validation succeeded | `ValidationResult` |
| `validation:offline-failed` | Offline validation failed | `ValidationResult` |
| `validation:auth-failed` | Auth failed during validation | `{ licenseKey, error, cached }` |
| `autovalidation:cycle` | Auto-validation scheduled | `{ nextRunAt }` |
| `autovalidation:stopped` | Auto-validation stopped | - |
| `network:online` | Network connectivity restored | - |
| `network:offline` | Network connectivity lost | `{ error }` |
| `offlineLicense:ready` | Offline assets synced | `{ kid, exp_at }` |
| `sdk:reset` | SDK was reset | - |
| `sdk:error` | General SDK error | `{ message, error? }` |

## TypeScript Support

This SDK includes TypeScript type definitions. They are automatically generated from JSDoc annotations.

```typescript
import LicenseSeat, {
  LicenseSeatConfig,
  ValidationResult,
  EntitlementCheckResult
} from '@licenseseat/js';

const sdk = new LicenseSeat({
  apiKey: 'your-key'
});

// Full type support
const status = sdk.getStatus();
const hasFeature: boolean = sdk.hasEntitlement('pro');
```

## Browser Support

Works in:
- Modern browsers (Chrome, Firefox, Safari, Edge)
- Any bundler (Vite, Webpack, Rollup, esbuild)
- Node.js >= 18

### Browser Global (Script Tag)

```html
<script src="https://cdn.licenseseat.com/sdk/latest/index.global.js"></script>
<script>
  const sdk = new LicenseSeat({
    apiKey: 'your-api-key'
  });
  sdk.activate('YOUR-LICENSE').then(console.log);
</script>
```

## Offline Support

The SDK supports offline license validation using cryptographically signed offline licenses.

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
// result.offline will be true if validated offline
```

## Singleton Pattern

For applications that need a shared instance:

```javascript
import { configure, getSharedInstance } from '@licenseseat/js';

// Configure once at app startup
configure({ apiKey: 'your-key' });

// Use anywhere in your app
const sdk = getSharedInstance();
await sdk.activate('LICENSE-KEY');
```

## Testing

Run tests:

```bash
npm test              # Run tests
npm run test:watch    # Watch mode
npm run test:coverage # With coverage
```

## Development

```bash
git clone https://github.com/licenseseat/licenseseat-js.git
cd licenseseat-js
npm install
npm run build        # Build JS + TypeScript types
npm run dev          # Watch mode
npm run typecheck    # Type checking only
```

## Migration from v0.1.x

### Breaking Changes in v0.2.0

1. **Default `apiBaseUrl` changed** from `/api` to `https://api.licenseseat.com`
   - If you were relying on the relative URL, explicitly set `apiBaseUrl` in config

2. **Default `offlineFallbackEnabled` changed** from `true` to `false`
   - For stricter behavior matching the Swift SDK
   - Set `offlineFallbackEnabled: true` if you need offline fallback

3. **New `autoInitialize` option** (default: `true`)
   - For lazy initialization, set `autoInitialize: false`

## License

MIT License - see [LICENSE](LICENSE) for details.

## Links

- [Documentation](https://licenseseat.com/docs)
- [API Reference](https://licenseseat.com/docs/api)
- [Support](https://licenseseat.com/contact)
- [GitHub Issues](https://github.com/licenseseat/licenseseat-js/issues)
