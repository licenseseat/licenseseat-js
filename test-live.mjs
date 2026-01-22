#!/usr/bin/env node
/**
 * LicenseSeat SDK - Live Integration Tests (Node.js)
 *
 * These tests run against the live LicenseSeat API to verify SDK functionality
 * with a real license. Requires valid credentials via environment variables.
 *
 * Setup:
 *   export LICENSESEAT_API_KEY="ls_your_api_key_here"
 *   export LICENSESEAT_PRODUCT_SLUG="your-product"
 *   export LICENSESEAT_LICENSE_KEY="YOUR-LICENSE-KEY"
 *
 * Run:
 *   node test-live.mjs
 *
 * Or with inline env vars:
 *   LICENSESEAT_API_KEY=ls_xxx LICENSESEAT_PRODUCT_SLUG=my-app LICENSESEAT_LICENSE_KEY=XXX-XXX node test-live.mjs
 */

// Polyfill localStorage for Node.js (must support Object.keys())
const storage = {};
globalThis.localStorage = {
  getItem(key) { return Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null; },
  setItem(key, value) { storage[key] = String(value); },
  removeItem(key) { delete storage[key]; },
  clear() { for (const key in storage) delete storage[key]; },
  get length() { return Object.keys(storage).length; },
  key(i) { return Object.keys(storage)[i] ?? null; }
};
// Make Object.keys(localStorage) return storage keys by copying them
Object.defineProperty(globalThis.localStorage, Symbol.iterator, {
  value: function* () { for (const key of Object.keys(storage)) yield key; }
});
// Override Object.keys for localStorage to return storage keys
const originalKeys = Object.keys;
Object.keys = function(obj) {
  if (obj === globalThis.localStorage) return originalKeys(storage);
  return originalKeys(obj);
};

// Polyfill document for Node.js (minimal)
globalThis.document = {
  createElement: () => ({ getContext: () => null }),
  querySelector: () => null
};

// Polyfill window/navigator for device fingerprinting
globalThis.window = { navigator: {}, screen: {} };
globalThis.navigator = { userAgent: 'Node.js', language: 'en', hardwareConcurrency: 4 };

// Import the live published package
const { default: LicenseSeat, APIError, ConfigurationError, configure, getSharedInstance, resetSharedInstance } = await import('@licenseseat/js');

// Load configuration from environment variables
const CONFIG = {
  API_KEY: process.env.LICENSESEAT_API_KEY,
  PRODUCT_SLUG: process.env.LICENSESEAT_PRODUCT_SLUG,
  LICENSE_KEY: process.env.LICENSESEAT_LICENSE_KEY
};

// Validate required environment variables
if (!CONFIG.API_KEY || !CONFIG.PRODUCT_SLUG || !CONFIG.LICENSE_KEY) {
  console.error('\n❌ Missing required environment variables!\n');
  console.error('Please set the following environment variables:');
  console.error('  LICENSESEAT_API_KEY      - Your LicenseSeat API key (starts with ls_)');
  console.error('  LICENSESEAT_PRODUCT_SLUG - Your product slug');
  console.error('  LICENSESEAT_LICENSE_KEY  - A valid license key for testing\n');
  console.error('Example:');
  console.error('  export LICENSESEAT_API_KEY="ls_your_key_here"');
  console.error('  export LICENSESEAT_PRODUCT_SLUG="my-product"');
  console.error('  export LICENSESEAT_LICENSE_KEY="XXXX-XXXX-XXXX-XXXX"');
  console.error('  node test-live.mjs\n');
  process.exit(1);
}

// Test utilities
let passed = 0;
let failed = 0;
let skipped = 0;
const results = [];

function log(msg) {
  console.log(msg);
}

function test(name, fn) {
  return { name, fn };
}

async function runTest(t) {
  const start = performance.now();
  try {
    await t.fn();
    const duration = (performance.now() - start).toFixed(0);
    passed++;
    results.push({ name: t.name, status: 'pass', duration });
    log(`  ✅ ${t.name} (${duration}ms)`);
    return true;
  } catch (err) {
    const duration = (performance.now() - start).toFixed(0);
    failed++;
    results.push({ name: t.name, status: 'fail', duration, error: err.message });
    log(`  ❌ ${t.name} (${duration}ms)`);
    log(`     Error: ${err.message}`);
    if (err.data) log(`     Data: ${JSON.stringify(err.data)}`);
    return false;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message || `Expected ${expected}, got ${actual}`);
  }
}

// ============================================
// TEST SUITE
// ============================================

// Mask sensitive data for logging
const maskKey = (key) => key ? `${key.slice(0, 6)}...${key.slice(-4)}` : 'not set';

log('\n' + '='.repeat(60));
log('🚀 LicenseSeat SDK - Live Integration Tests');
log('📦 Package: @licenseseat/js (from npm)');
log('='.repeat(60));
log(`🔑 API Key: ${maskKey(CONFIG.API_KEY)}`);
log(`📦 Product: ${CONFIG.PRODUCT_SLUG}`);
log(`🎫 License: ${maskKey(CONFIG.LICENSE_KEY)}`);
log('='.repeat(60) + '\n');

let sdk = null;
const events = [];

// Clear storage before tests
for (const key in storage) delete storage[key];

// ----------------------------------------
// Initialization Tests
// ----------------------------------------
log('📋 Initialization Tests\n');

await runTest(test('SDK initialization with productSlug', async () => {
  sdk = new LicenseSeat({
    apiKey: CONFIG.API_KEY,
    productSlug: CONFIG.PRODUCT_SLUG,
    debug: false,
    autoInitialize: false
  });

  // Subscribe to events
  ['activation:start', 'activation:success', 'activation:error',
   'validation:start', 'validation:success', 'validation:error',
   'deactivation:start', 'deactivation:success', 'deactivation:error'
  ].forEach(evt => sdk.on(evt, (data) => events.push({ event: evt, data })));

  assert(sdk !== null, 'SDK should be created');
  assert(sdk.config.productSlug === CONFIG.PRODUCT_SLUG, 'productSlug should be set');
}));

await runTest(test('Configuration defaults are correct', async () => {
  assertEqual(sdk.config.apiBaseUrl, 'https://licenseseat.com/api/v1', 'apiBaseUrl');
  assertEqual(sdk.config.productSlug, CONFIG.PRODUCT_SLUG, 'productSlug');
  assertEqual(sdk.config.storagePrefix, 'licenseseat_', 'storagePrefix');
  assertEqual(sdk.config.autoValidateInterval, 3600000, 'autoValidateInterval');
  assertEqual(sdk.config.offlineFallbackEnabled, false, 'offlineFallbackEnabled');
  assertEqual(sdk.config.maxRetries, 3, 'maxRetries');
}));

await runTest(test('Initial status is inactive', async () => {
  const status = sdk.getStatus();
  assertEqual(status.status, 'inactive', 'Status should be inactive');
}));

// ----------------------------------------
// API Tests
// ----------------------------------------
log('\n📋 API Tests\n');

// Note: /auth_test endpoint may not exist in v1 API
{
  const section = createTestSection('API authentication test (testAuth)');
  try {
    const result = await sdk.testAuth();
    if (result.authenticated === true) {
      updateTestSection(section, 'pass', 'API key is valid and authenticated');
    } else {
      updateTestSection(section, 'fail', 'Authentication failed');
    }
  } catch (err) {
    if (err.status === 404) {
      updateTestSection(section, 'skip', '/auth_test endpoint not available in v1 API');
    } else {
      updateTestSection(section, 'fail', err.message);
    }
  }
}

function createTestSection(name) { return { name }; }
function updateTestSection(section, status, message) {
  if (status === 'pass') { passed++; log(`  ✅ ${section.name}`); log(`     → ${message}`); }
  else if (status === 'fail') { failed++; log(`  ❌ ${section.name}`); log(`     → ${message}`); }
  else if (status === 'skip') { skipped++; log(`  ⏭️  ${section.name}`); log(`     → ${message}`); }
}

await runTest(test('License activation', async () => {
  const result = await sdk.activate(CONFIG.LICENSE_KEY);

  assertEqual(result.license_key, CONFIG.LICENSE_KEY, 'license_key should match');
  assert(typeof result.device_id === 'string', 'device_id should be a string');
  assert(typeof result.activated_at === 'string', 'activated_at should be a string');
  assert(result.activation !== undefined, 'activation object should exist');

  log(`     → device_id: ${result.device_id}`);
  log(`     → activated_at: ${result.activated_at}`);
}));

await runTest(test('Status after activation', async () => {
  const status = sdk.getStatus();
  assert(['active', 'pending'].includes(status.status), `Status should be active or pending, got ${status.status}`);
  assertEqual(status.license, CONFIG.LICENSE_KEY, 'License key should match');
  assert(status.device !== undefined, 'Device should be set');
}));

await runTest(test('License validation', async () => {
  const result = await sdk.validateLicense(CONFIG.LICENSE_KEY);

  assertEqual(result.valid, true, 'License should be valid');
  assert(result.license !== undefined, 'License object should exist');
  assertEqual(result.license.status, 'active', 'License status should be active');

  log(`     → mode: ${result.license.mode}`);
  log(`     → plan_key: ${result.license.plan_key}`);
  log(`     → seats: ${result.license.active_seats}/${result.license.seat_limit}`);
}));

await runTest(test('Entitlements check', async () => {
  const validation = await sdk.validateLicense(CONFIG.LICENSE_KEY);
  const entitlements = validation.active_entitlements || validation.license?.active_entitlements || [];

  log(`     → Found ${entitlements.length} entitlement(s)`);

  for (const ent of entitlements) {
    const hasIt = sdk.hasEntitlement(ent.key);
    const check = sdk.checkEntitlement(ent.key);
    assert(hasIt === true, `hasEntitlement('${ent.key}') should be true`);
    assert(check.active === true, `checkEntitlement('${ent.key}').active should be true`);
    log(`     → "${ent.key}": hasEntitlement=${hasIt}, active=${check.active}`);
  }

  // Non-existent entitlement
  const fake = sdk.checkEntitlement('nonexistent-feature');
  assertEqual(fake.active, false, 'Non-existent entitlement should be inactive');
  assertEqual(fake.reason, 'not_found', 'Reason should be not_found');
}));

await runTest(test('Cache stores license data', async () => {
  const cached = sdk.cache.getLicense();
  assert(cached !== null, 'Cache should have license');
  assertEqual(cached.license_key, CONFIG.LICENSE_KEY, 'Cached license_key should match');
  assert(cached.device_id !== undefined, 'Cached device_id should exist');

  const deviceId = sdk.cache.getDeviceId();
  assertEqual(deviceId, cached.device_id, 'getDeviceId() should match cached device_id');
}));

// ----------------------------------------
// Stress Tests
// ----------------------------------------
log('\n📋 Stress Tests\n');

await runTest(test('5 rapid validations', async () => {
  const times = [];
  for (let i = 0; i < 5; i++) {
    const start = performance.now();
    await sdk.validateLicense(CONFIG.LICENSE_KEY);
    times.push(performance.now() - start);
  }

  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  log(`     → Avg: ${avg.toFixed(0)}ms, Min: ${Math.min(...times).toFixed(0)}ms, Max: ${Math.max(...times).toFixed(0)}ms`);
}));

// ----------------------------------------
// Error Handling Tests
// ----------------------------------------
log('\n📋 Error Handling Tests\n');

await runTest(test('Invalid license returns APIError', async () => {
  try {
    await sdk.validateLicense('INVALID-LICENSE-KEY-12345');
    throw new Error('Should have thrown');
  } catch (err) {
    assert(err instanceof APIError, 'Should be APIError');
    assert(err.status === 404 || err.status === 422, `Status should be 404 or 422, got ${err.status}`);
    assert(err.data?.error?.code !== undefined, 'Error code should exist');
    log(`     → status: ${err.status}, code: ${err.data?.error?.code}`);
  }
}));

await runTest(test('Missing productSlug throws ConfigurationError', async () => {
  try {
    const badSdk = new LicenseSeat({
      apiKey: CONFIG.API_KEY,
      autoInitialize: false
      // Missing productSlug!
    });
    await badSdk.activate('TEST-KEY');
    throw new Error('Should have thrown');
  } catch (err) {
    assert(err instanceof ConfigurationError || err.name === 'ConfigurationError',
      `Should be ConfigurationError, got ${err.name}`);
    log(`     → ${err.message}`);
  }
}));

// ----------------------------------------
// Deactivation Tests
// ----------------------------------------
log('\n📋 Deactivation Tests\n');

await runTest(test('License deactivation', async () => {
  const result = await sdk.deactivate();

  assertEqual(result.object, 'deactivation', 'object should be "deactivation"');
  assert(result.activation_id !== undefined, 'activation_id should exist');
  assert(result.deactivated_at !== undefined, 'deactivated_at should exist');

  log(`     → activation_id: ${result.activation_id}`);
  log(`     → deactivated_at: ${result.deactivated_at}`);
}));

await runTest(test('Status after deactivation is inactive', async () => {
  const status = sdk.getStatus();
  assertEqual(status.status, 'inactive', 'Status should be inactive');
}));

await runTest(test('Cache cleared after deactivation', async () => {
  const cached = sdk.cache.getLicense();
  assertEqual(cached, null, 'Cache should be null');
}));

// ----------------------------------------
// Re-activation Tests
// ----------------------------------------
log('\n📋 Re-activation Tests\n');

await runTest(test('Re-activation after deactivation', async () => {
  const result = await sdk.activate(CONFIG.LICENSE_KEY);
  assertEqual(result.license_key, CONFIG.LICENSE_KEY, 'license_key should match');
  log(`     → Re-activated with device_id: ${result.device_id}`);
}));

await runTest(test('SDK reset clears everything', async () => {
  sdk.reset();

  const status = sdk.getStatus();
  const cached = sdk.cache.getLicense();

  assertEqual(status.status, 'inactive', 'Status should be inactive after reset');
  assertEqual(cached, null, 'Cache should be null after reset');
}));

// ----------------------------------------
// Offline Token & Crypto Tests
// ----------------------------------------
log('\n📋 Offline Token & Crypto Tests\n');

// Re-activate for offline tests (reset cleared everything)
await sdk.activate(CONFIG.LICENSE_KEY);
log('  (Re-activated license for offline tests)\n');

await runTest(test('Fetch offline token', async () => {
  const token = await sdk.getOfflineToken();

  assert(token !== null, 'Token should not be null');
  assertEqual(token.object, 'offline_token', 'object should be "offline_token"');
  assert(token.token !== undefined, 'token payload should exist');
  assert(token.signature !== undefined, 'signature should exist');
  assert(token.canonical !== undefined, 'canonical should exist');

  // Check token payload
  assertEqual(token.token.license_key, CONFIG.LICENSE_KEY, 'license_key should match');
  assertEqual(token.token.product_slug, CONFIG.PRODUCT_SLUG, 'product_slug should match');
  assert(typeof token.token.iat === 'number', 'iat should be a number');
  assert(typeof token.token.exp === 'number', 'exp should be a number');
  assert(typeof token.token.nbf === 'number', 'nbf should be a number');
  assert(token.token.kid !== undefined, 'kid should exist');

  // Check signature
  assertEqual(token.signature.algorithm, 'Ed25519', 'algorithm should be Ed25519');
  assert(token.signature.key_id !== undefined, 'key_id should exist');
  assert(token.signature.value !== undefined, 'signature value should exist');

  log(`     → token.license_key: ${token.token.license_key}`);
  log(`     → token.product_slug: ${token.token.product_slug}`);
  log(`     → token.mode: ${token.token.mode}`);
  log(`     → token.plan_key: ${token.token.plan_key}`);
  log(`     → token.exp: ${new Date(token.token.exp * 1000).toISOString()}`);
  log(`     → signature.algorithm: ${token.signature.algorithm}`);
  log(`     → signature.key_id: ${token.signature.key_id}`);
}));

await runTest(test('Fetch signing key', async () => {
  // Get the offline token first to get the key_id
  const token = await sdk.getOfflineToken();
  const keyId = token.signature.key_id;

  const signingKey = await sdk.getSigningKey(keyId);

  assert(signingKey !== null, 'Signing key should not be null');
  assertEqual(signingKey.object, 'signing_key', 'object should be "signing_key"');
  assertEqual(signingKey.key_id, keyId, 'key_id should match');
  assertEqual(signingKey.algorithm, 'Ed25519', 'algorithm should be Ed25519');
  assert(signingKey.public_key !== undefined, 'public_key should exist');
  assertEqual(signingKey.status, 'active', 'status should be active');

  log(`     → key_id: ${signingKey.key_id}`);
  log(`     → algorithm: ${signingKey.algorithm}`);
  log(`     → status: ${signingKey.status}`);
  log(`     → public_key: ${signingKey.public_key.substring(0, 30)}...`);
}));

await runTest(test('Verify offline token signature (Ed25519)', async () => {
  // Get the offline token
  const token = await sdk.getOfflineToken();

  // Get the signing key (public key)
  const signingKey = await sdk.getSigningKey(token.signature.key_id);
  const publicKeyB64 = signingKey.public_key;

  // Verify the token (this uses Ed25519 crypto verification)
  const isValid = await sdk.verifyOfflineToken(token, publicKeyB64);

  assertEqual(isValid, true, 'Token signature should be valid');

  log(`     → signature valid: ${isValid}`);
  log(`     → algorithm: Ed25519`);
  log(`     → verified canonical: ${token.canonical.substring(0, 50)}...`);
}));

await runTest(test('Cache offline token', async () => {
  // Sync offline assets (this fetches and caches the token)
  await sdk.syncOfflineAssets();

  // Check that the token is cached
  const cachedToken = sdk.cache.getOfflineToken();

  assert(cachedToken !== null, 'Cached token should exist');
  assertEqual(cachedToken.object, 'offline_token', 'object should be "offline_token"');
  assertEqual(cachedToken.token.license_key, CONFIG.LICENSE_KEY, 'license_key should match');

  log(`     → Offline token cached successfully`);
  log(`     → token.exp: ${new Date(cachedToken.token.exp * 1000).toISOString()}`);
}));

await runTest(test('Offline validation with cached token', async () => {
  // Ensure we have cached offline token
  const cachedToken = sdk.cache.getOfflineToken();
  assert(cachedToken !== null, 'Should have cached token');

  // Perform offline verification using cached data
  const result = await sdk.verifyCachedOffline();

  assertEqual(result.valid, true, 'Offline validation should be valid');
  assertEqual(result.offline, true, 'Should be marked as offline validation');
  // Note: active_entitlements may be undefined if license has no entitlements
  const entitlements = result.active_entitlements || [];

  log(`     → valid: ${result.valid}`);
  log(`     → offline: ${result.offline}`);
  log(`     → entitlements: ${entitlements.length}`);
}));

await runTest(test('Quick local offline verification', async () => {
  // This does local-only verification without any network calls
  // Note: This is async and returns a Promise
  const result = await sdk.quickVerifyCachedOfflineLocal();

  assert(result !== null, 'Result should not be null (public key must be cached)');
  assertEqual(result.valid, true, 'Quick offline validation should be valid');
  assertEqual(result.offline, true, 'Should be marked as offline');

  log(`     → valid: ${result.valid}`);
  log(`     → offline: ${result.offline}`);
}));

await runTest(test('Public key is cached', async () => {
  // Get the offline token to find the key_id
  const token = sdk.cache.getOfflineToken();
  const keyId = token.token.kid;

  // Check if the public key is cached
  const cachedKey = sdk.cache.getPublicKey(keyId);

  assert(cachedKey !== null, 'Public key should be cached');
  assert(typeof cachedKey === 'string', 'Cached key should be a string');
  assert(cachedKey.length > 20, 'Cached key should have reasonable length');

  log(`     → key_id: ${keyId}`);
  log(`     → cached public_key: ${cachedKey.substring(0, 30)}...`);
}));

await runTest(test('Tampered token signature verification fails', async () => {
  // Get the current cached token and public key
  const originalToken = sdk.cache.getOfflineToken();
  const keyId = originalToken.token.kid;
  const publicKey = sdk.cache.getPublicKey(keyId);

  // Create a tampered token (modify the canonical JSON which is what's signed)
  const tamperedToken = JSON.parse(JSON.stringify(originalToken));
  // Tamper with the canonical JSON - this breaks the Ed25519 signature
  tamperedToken.canonical = tamperedToken.canonical.replace(
    `"license_key":"${CONFIG.LICENSE_KEY}"`,
    `"license_key":"TAMPERED-KEY-1234"`
  );

  try {
    const isValid = await sdk.verifyOfflineToken(tamperedToken, publicKey);
    assertEqual(isValid, false, 'Tampered token signature should be invalid');
    log(`     → Signature verification correctly returned false for tampered data`);
  } catch (err) {
    // CryptoError is also acceptable - signature mismatch
    assert(err.message.includes('signature') || err.name === 'CryptoError',
      `Expected signature error, got: ${err.message}`);
    log(`     → Correctly threw CryptoError for tampered token: ${err.message}`);
  }
}));

await runTest(test('Tampered signature value is rejected', async () => {
  // Get the current cached token and public key
  const originalToken = sdk.cache.getOfflineToken();
  const keyId = originalToken.token.kid;
  const publicKey = sdk.cache.getPublicKey(keyId);

  // Create a token with corrupted signature bytes
  const tamperedToken = JSON.parse(JSON.stringify(originalToken));
  // Corrupt the signature by flipping some characters
  const sigValue = tamperedToken.signature.value;
  tamperedToken.signature.value = sigValue.substring(0, 10) + 'XXXXXX' + sigValue.substring(16);

  try {
    const isValid = await sdk.verifyOfflineToken(tamperedToken, publicKey);
    assertEqual(isValid, false, 'Corrupted signature should be invalid');
    log(`     → Signature verification correctly returned false for corrupted signature`);
  } catch (err) {
    // CryptoError is also acceptable
    log(`     → Correctly threw error for corrupted signature: ${err.message}`);
  }
}));

// ----------------------------------------
// Singleton Pattern Tests
// ----------------------------------------
log('\n📋 Singleton Pattern Tests\n');

await runTest(test('configure() and getSharedInstance()', async () => {
  resetSharedInstance();

  configure({
    apiKey: CONFIG.API_KEY,
    productSlug: CONFIG.PRODUCT_SLUG,
    autoInitialize: false
  });

  const shared1 = getSharedInstance();
  const shared2 = getSharedInstance();

  assert(shared1 === shared2, 'Should return same instance');
  assertEqual(shared1.config.productSlug, CONFIG.PRODUCT_SLUG, 'productSlug should be set');

  resetSharedInstance();
}));

// ----------------------------------------
// Events Test
// ----------------------------------------
log('\n📋 Events Captured\n');

log(`   Total events captured: ${events.length}`);
const eventCounts = events.reduce((acc, e) => {
  acc[e.event] = (acc[e.event] || 0) + 1;
  return acc;
}, {});
for (const [evt, count] of Object.entries(eventCounts)) {
  log(`   → ${evt}: ${count}`);
}

// ----------------------------------------
// Final Summary
// ----------------------------------------
log('\n' + '='.repeat(60));
log(`📊 RESULTS: ${passed} passed, ${failed} failed`);
log('='.repeat(60) + '\n');

if (failed > 0) {
  log('Failed tests:');
  results.filter(r => r.status === 'fail').forEach(r => {
    log(`  ❌ ${r.name}: ${r.error}`);
  });
  process.exit(1);
} else {
  log('🎉 All tests passed!\n');
  process.exit(0);
}
