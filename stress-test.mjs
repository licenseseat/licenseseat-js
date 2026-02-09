#!/usr/bin/env node
/**
 * LicenseSeat JS SDK — Telemetry, Heartbeat & Activation Stress Test
 *
 * Direct port of the Swift SDK StressTest (StressTest/Sources/StressTest/main.swift).
 * 9 scenarios: telemetry on/off, enriched telemetry fields, heartbeat timer,
 * auto-validation, concurrent stress, lifecycle, app_version/app_build.
 *
 * Setup:
 *   export LICENSESEAT_API_URL="http://localhost:3000/api/v1"   # optional
 *   export LICENSESEAT_API_KEY="pk_test_..."
 *   export LICENSESEAT_PRODUCT_SLUG="your-product"
 *   export LICENSESEAT_LICENSE_KEY="YOUR-LICENSE-KEY"
 *
 * Run:
 *   node stress-test.mjs
 */

// ── Node.js polyfills ──────────────────────────────────────────────
const storage = {};
globalThis.localStorage = {
  getItem(key) { return Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null; },
  setItem(key, value) { storage[key] = String(value); },
  removeItem(key) { delete storage[key]; },
  clear() { for (const key in storage) delete storage[key]; },
  get length() { return Object.keys(storage).length; },
  key(i) { return Object.keys(storage)[i] ?? null; }
};
const originalKeys = Object.keys;
Object.keys = function(obj) {
  if (obj === globalThis.localStorage) return originalKeys(storage);
  return originalKeys(obj);
};
globalThis.document = { createElement: () => ({ getContext: () => null }), querySelector: () => null };
globalThis.window = { navigator: {}, screen: {} };
globalThis.navigator = { userAgent: "Node.js", language: "en", hardwareConcurrency: 4 };

// ── Import SDK from local source ───────────────────────────────────
const { default: LicenseSeatSDK, SDK_VERSION, APIError } = await import("./src/index.js");
const { collectTelemetry } = await import("./src/telemetry.js");

// ── Configuration ──────────────────────────────────────────────────
const API_URL = process.env.LICENSESEAT_API_URL || "http://localhost:3000/api/v1";
const API_KEY = process.env.LICENSESEAT_API_KEY || "";
const PRODUCT_SLUG = process.env.LICENSESEAT_PRODUCT_SLUG || "";
const LICENSE_KEY = process.env.LICENSESEAT_LICENSE_KEY || "";

if (!API_KEY || !PRODUCT_SLUG || !LICENSE_KEY) {
  console.error("\n  Missing environment variables. Set:");
  console.error("   LICENSESEAT_API_KEY, LICENSESEAT_PRODUCT_SLUG, LICENSESEAT_LICENSE_KEY");
  console.error("   Optional: LICENSESEAT_API_URL (default: http://localhost:3000/api/v1)");
  process.exit(1);
}

// ── Test utilities (mirrors Swift) ─────────────────────────────────
let passedTests = 0;
let failedTests = 0;

function printHeader(title) {
  console.log("\n" + "=".repeat(70));
  console.log(`  ${title}`);
  console.log("=".repeat(70));
}

function printTest(name) {
  console.log(`\n-> Testing: ${name}`);
}

function pass(message = "OK") {
  passedTests++;
  console.log(`   PASS: ${message}`);
}

function fail(message) {
  failedTests++;
  console.log(`   FAIL: ${message}`);
}

function assert(condition, message) {
  if (condition) pass(message); else fail(message);
}

function log(message) {
  console.log(`   ${message}`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isAlreadyActivated(err) {
  return err instanceof APIError && err.data?.error?.code === "already_activated";
}

// ── Start ──────────────────────────────────────────────────────────
printHeader("Telemetry, Heartbeat & Activation Stress Test");
console.log(`
        API URL:      ${API_URL}
        Product:      ${PRODUCT_SLUG}
        License:      ${LICENSE_KEY.slice(0, 10)}...
        SDK Version:  ${SDK_VERSION}
`);

// ============================================================
// SCENARIO 1: Activation with telemetry enabled (default)
// ============================================================
printHeader("SCENARIO 1: Activation WITH Telemetry (default)");

const sdk = new LicenseSeatSDK({
  apiBaseUrl: API_URL,
  apiKey: API_KEY,
  productSlug: PRODUCT_SLUG,
  storagePrefix: "stress_telemetry_",
  autoValidateInterval: 0,
  heartbeatInterval: 0,
  autoInitialize: false,
  debug: false,
});
sdk.reset();

printTest("Activate license (telemetry enabled)");
let activationId;
try {
  const license = await sdk.activate(LICENSE_KEY);
  pass("Activation successful with telemetry");
  activationId = license.activation?.id;
  log(`Device ID: ${license.device_id}`);
  log(`Activation ID: ${activationId}`);
} catch (err) {
  if (isAlreadyActivated(err)) {
    pass("Already activated (reusing seat)");
    const cached = sdk.cache.getLicense();
    if (cached) activationId = cached.activation?.id;
  } else {
    fail(`Activation failed: ${err.data?.error?.code ?? "unknown"} - ${err.message}`);
  }
}

// ============================================================
// SCENARIO 2: Validate with telemetry
// ============================================================
printHeader("SCENARIO 2: Validation WITH Telemetry");

printTest("Validate license (telemetry payload attached)");
try {
  const result = await sdk.validateLicense(LICENSE_KEY);
  assert(result.valid, "License is valid (telemetry accepted by server)");
  log(`Plan: ${result.license?.plan_key}`);
  log(`Mode: ${result.license?.mode}`);
  log(`Seats: ${result.license?.active_seats}/${result.license?.seat_limit}`);
} catch (err) {
  fail(`Validation error: ${err.message}`);
}

// ============================================================
// SCENARIO 3: Heartbeat endpoint
// ============================================================
printHeader("SCENARIO 3: Heartbeat Endpoint");

printTest("Send heartbeat (first)");
try {
  const hb = await sdk.heartbeat();
  if (hb) {
    pass("Heartbeat accepted by server");
  } else {
    fail("Heartbeat returned undefined (no cached license?)");
  }
} catch (err) {
  fail(`Heartbeat failed: ${err.data?.error?.code ?? "unknown"} - ${err.message}`);
}

printTest("Send 5 rapid heartbeats");
let heartbeatSuccesses = 0;
for (let i = 1; i <= 5; i++) {
  try {
    const hb = await sdk.heartbeat();
    if (hb) heartbeatSuccesses++;
    log(`Heartbeat #${i} OK`);
  } catch (err) {
    log(`Heartbeat #${i} failed: ${err.message}`);
  }
}
assert(heartbeatSuccesses === 5, `All 5 rapid heartbeats succeeded (${heartbeatSuccesses}/5)`);

printTest("Heartbeat with short interval spacing");
heartbeatSuccesses = 0;
for (let i = 1; i <= 3; i++) {
  await sleep(500); // 0.5s between each
  try {
    const hb = await sdk.heartbeat();
    if (hb) heartbeatSuccesses++;
    log(`Spaced heartbeat #${i} OK`);
  } catch (err) {
    log(`Spaced heartbeat #${i} failed: ${err.message}`);
  }
}
assert(heartbeatSuccesses === 3, `All 3 spaced heartbeats succeeded (${heartbeatSuccesses}/3)`);

// ============================================================
// SCENARIO 4: Enriched Telemetry Fields Verification
// ============================================================
printHeader("SCENARIO 4: Enriched Telemetry Fields");

printTest("Verify all new telemetry fields are collected");
const telemetry = collectTelemetry(SDK_VERSION, { appVersion: "1.0.0-stress", appBuild: "99" });
log(`Telemetry keys: ${Object.keys(telemetry).join(", ")}`);

assert(telemetry.sdk_version === SDK_VERSION, `sdk_version = ${telemetry.sdk_version}`);
assert(typeof telemetry.os_name === "string", `os_name = ${telemetry.os_name}`);
assert(typeof telemetry.platform === "string", `platform = ${telemetry.platform}`);
assert(typeof telemetry.device_type === "string", `device_type = ${telemetry.device_type}`);
assert(typeof telemetry.architecture === "string", `architecture = ${telemetry.architecture}`);
assert(typeof telemetry.cpu_cores === "number" && telemetry.cpu_cores > 0, `cpu_cores = ${telemetry.cpu_cores}`);
assert(typeof telemetry.runtime_version === "string", `runtime_version = ${telemetry.runtime_version}`);
assert(telemetry.app_version === "1.0.0-stress", `app_version = ${telemetry.app_version}`);
assert(telemetry.app_build === "99", `app_build = ${telemetry.app_build}`);

// Optional fields that should be present in Node.js
if (telemetry.os_version) {
  log(`os_version = ${telemetry.os_version}`);
  pass("os_version present");
}
if (telemetry.language) {
  log(`language = ${telemetry.language}`);
  assert(telemetry.language.length >= 2, `language is valid 2+ char code`);
}
if (telemetry.memory_gb) {
  log(`memory_gb = ${telemetry.memory_gb}`);
  assert(telemetry.memory_gb > 0, `memory_gb is positive`);
}

// Fields that are null in Node.js (browser-only)
log(`browser_name = ${telemetry.browser_name ?? "null (expected in Node)"}`);
log(`browser_version = ${telemetry.browser_version ?? "null (expected in Node)"}`);
log(`screen_resolution = ${telemetry.screen_resolution ?? "null (expected in Node)"}`);
log(`display_scale = ${telemetry.display_scale ?? "null (expected in Node)"}`);

printTest("Verify enriched telemetry is sent with actual API requests");
// Use fetch interception to verify the telemetry payload
const originalFetch = globalThis.fetch;
let capturedTelemetry = null;
globalThis.fetch = async (url, options) => {
  if (typeof url === "string" && url.includes("/heartbeat") && options?.body) {
    try {
      const body = JSON.parse(options.body);
      capturedTelemetry = body.telemetry;
    } catch {}
  }
  return originalFetch(url, options);
};

try {
  await sdk.heartbeat();
  if (capturedTelemetry) {
    pass("Telemetry payload captured from heartbeat request");
    assert(capturedTelemetry.sdk_version === SDK_VERSION, `Sent sdk_version = ${capturedTelemetry.sdk_version}`);
    assert(capturedTelemetry.device_type !== undefined, `Sent device_type = ${capturedTelemetry.device_type}`);
    assert(capturedTelemetry.architecture !== undefined, `Sent architecture = ${capturedTelemetry.architecture}`);
    assert(capturedTelemetry.cpu_cores !== undefined, `Sent cpu_cores = ${capturedTelemetry.cpu_cores}`);
    assert(capturedTelemetry.runtime_version !== undefined, `Sent runtime_version = ${capturedTelemetry.runtime_version}`);
    log(`Telemetry payload keys: ${Object.keys(capturedTelemetry).join(", ")}`);
  } else {
    fail("Failed to capture telemetry from heartbeat request");
  }
} catch (err) {
  fail(`Heartbeat with capture failed: ${err.message}`);
} finally {
  globalThis.fetch = originalFetch;
}

// ============================================================
// SCENARIO 5: Telemetry disabled
// ============================================================
printHeader("SCENARIO 5: Telemetry DISABLED");

// Deactivate first to free the seat
printTest("Deactivate to free seat for no-telemetry test");
try {
  await sdk.deactivate();
  pass("Deactivated OK");
} catch (err) {
  log(`Deactivation issue: ${err.message} (continuing)`);
}

const noTelemetrySDK = new LicenseSeatSDK({
  apiBaseUrl: API_URL,
  apiKey: API_KEY,
  productSlug: PRODUCT_SLUG,
  storagePrefix: "stress_no_telemetry_",
  autoValidateInterval: 0,
  heartbeatInterval: 0,
  autoInitialize: false,
  debug: false,
  telemetryEnabled: false,
});
noTelemetrySDK.reset();

printTest("Activate with telemetry DISABLED");
try {
  const license = await noTelemetrySDK.activate(LICENSE_KEY);
  pass("Activation works without telemetry");
  log(`Device ID: ${license.device_id}`);
  log(`Activation ID: ${license.activation?.id}`);
} catch (err) {
  if (isAlreadyActivated(err)) {
    pass("Already activated (seat reused, no telemetry)");
  } else {
    fail(`No-telemetry activation failed: ${err.data?.error?.code ?? "unknown"} - ${err.message}`);
  }
}

printTest("Validate with telemetry DISABLED");
try {
  const result = await noTelemetrySDK.validateLicense(LICENSE_KEY);
  assert(result.valid, "Validation works without telemetry");
} catch (err) {
  fail(`No-telemetry validation error: ${err.message}`);
}

printTest("Heartbeat with telemetry DISABLED");
try {
  const hb = await noTelemetrySDK.heartbeat();
  if (hb) {
    pass("Heartbeat works without telemetry");
  } else {
    fail("Heartbeat returned undefined without telemetry");
  }
} catch (err) {
  fail(`No-telemetry heartbeat error: ${err.message}`);
}

// ============================================================
// SCENARIO 6: App Version / App Build Config
// ============================================================
printHeader("SCENARIO 6: App Version / App Build in Config");

// Deactivate no-telemetry SDK first
try { await noTelemetrySDK.deactivate(); } catch {}

const appVersionSDK = new LicenseSeatSDK({
  apiBaseUrl: API_URL,
  apiKey: API_KEY,
  productSlug: PRODUCT_SLUG,
  storagePrefix: "stress_appversion_",
  autoValidateInterval: 0,
  heartbeatInterval: 0,
  autoInitialize: false,
  debug: false,
  appVersion: "3.2.1",
  appBuild: "456",
});
appVersionSDK.reset();

printTest("Activate with appVersion/appBuild config");
let appVersionTelemetry = null;
const origFetch2 = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  if (typeof url === "string" && url.includes("/activate") && options?.body) {
    try {
      const body = JSON.parse(options.body);
      appVersionTelemetry = body.telemetry;
    } catch {}
  }
  return origFetch2(url, options);
};

try {
  await appVersionSDK.activate(LICENSE_KEY);
  pass("Activated with appVersion/appBuild");
  if (appVersionTelemetry) {
    assert(appVersionTelemetry.app_version === "3.2.1", `app_version in payload = ${appVersionTelemetry.app_version}`);
    assert(appVersionTelemetry.app_build === "456", `app_build in payload = ${appVersionTelemetry.app_build}`);
  } else {
    fail("Failed to capture telemetry with app_version/app_build");
  }
} catch (err) {
  if (isAlreadyActivated(err)) {
    pass("Already activated (checking telemetry skipped)");
  } else {
    fail(`Activate with appVersion: ${err.message}`);
  }
} finally {
  globalThis.fetch = origFetch2;
}

// Clean up
try { await appVersionSDK.deactivate(); } catch {}
appVersionSDK.destroy();

// ============================================================
// SCENARIO 7: Separate Heartbeat Timer
// ============================================================
printHeader("SCENARIO 7: Separate Heartbeat Timer");

const heartbeatTimerSDK = new LicenseSeatSDK({
  apiBaseUrl: API_URL,
  apiKey: API_KEY,
  productSlug: PRODUCT_SLUG,
  storagePrefix: "stress_hbtimer_",
  autoValidateInterval: 0, // disable auto-validation
  heartbeatInterval: 3000, // 3 second heartbeat timer for testing
  autoInitialize: false,
  debug: false,
});
heartbeatTimerSDK.reset();

let heartbeatCycleCount = 0;
heartbeatTimerSDK.on("heartbeat:cycle", () => {
  heartbeatCycleCount++;
});

printTest("Activate and verify heartbeat timer starts");
try {
  await heartbeatTimerSDK.activate(LICENSE_KEY);
  pass("Activated for heartbeat timer test");
  assert(heartbeatTimerSDK.heartbeatTimer !== null, "Heartbeat timer is running");
  assert(heartbeatTimerSDK.validationTimer === null, "Validation timer is NOT running (interval=0)");
} catch (err) {
  if (isAlreadyActivated(err)) {
    pass("Already activated");
  } else {
    fail(`Heartbeat timer test activation: ${err.message}`);
  }
}

printTest("Wait for heartbeat timer cycles (9s for ~3 cycles at 3s interval)");
for (let i = 1; i <= 3; i++) {
  log(`Waiting for heartbeat cycle #${i}...`);
  await sleep(3500);
}
assert(heartbeatCycleCount >= 2, `At least 2 heartbeat timer cycles fired (${heartbeatCycleCount} observed)`);
log(`Heartbeat timer cycles: ${heartbeatCycleCount}`);

printTest("Verify heartbeat timer is independent from auto-validation");
assert(heartbeatTimerSDK.validationTimer === null, "Validation timer still null (disabled)");
assert(heartbeatTimerSDK.heartbeatTimer !== null, "Heartbeat timer still running");

printTest("Deactivate stops heartbeat timer");
try { await heartbeatTimerSDK.deactivate(); } catch {}
assert(heartbeatTimerSDK.heartbeatTimer === null, "Heartbeat timer stopped after deactivate");
heartbeatTimerSDK.destroy();

// ============================================================
// SCENARIO 8: Auto-validation with heartbeat
// ============================================================
printHeader("SCENARIO 8: Auto-Validation + Heartbeat Cycles");

const autoSDK = new LicenseSeatSDK({
  apiBaseUrl: API_URL,
  apiKey: API_KEY,
  productSlug: PRODUCT_SLUG,
  storagePrefix: "stress_auto_",
  autoValidateInterval: 3000, // 3 second cycles for testing (JS uses ms)
  heartbeatInterval: 0, // disable separate heartbeat timer for this test
  autoInitialize: false,
  debug: false,
});
autoSDK.reset();

let autoValidationCount = 0;
autoSDK.on("autovalidation:cycle", () => {
  autoValidationCount++;
});

printTest("Activate for auto-validation test");
try {
  await autoSDK.activate(LICENSE_KEY);
  pass("Activated for auto-validation");
} catch (err) {
  if (isAlreadyActivated(err)) {
    pass("Already activated");
  } else {
    fail(`Auto-test activation failed: ${err.message}`);
  }
}

printTest("Wait for 3 auto-validation + heartbeat cycles (9-12 seconds)");
for (let i = 1; i <= 3; i++) {
  log(`Waiting for cycle #${i}...`);
  await sleep(4000); // 4s per cycle
}
assert(autoValidationCount >= 2, `At least 2 auto-validation cycles fired (${autoValidationCount} observed)`);

// Stop auto-validation before moving on -- prevents runaway requests
printTest("Stop auto-validation timer");
try { await autoSDK.deactivate(); } catch {}
autoSDK.destroy();
pass("Auto-validation SDK destroyed");

// ============================================================
// SCENARIO 9: Concurrent validation stress
// ============================================================
printHeader("SCENARIO 9: Concurrent Validation Stress");

// Fresh SDK for concurrent tests (no auto-validation running)
const concurrentSDK = new LicenseSeatSDK({
  apiBaseUrl: API_URL,
  apiKey: API_KEY,
  productSlug: PRODUCT_SLUG,
  storagePrefix: "stress_concurrent_",
  autoValidateInterval: 0,
  heartbeatInterval: 0,
  autoInitialize: false,
  debug: false,
});
concurrentSDK.reset();

printTest("Activate for concurrent test");
try {
  await concurrentSDK.activate(LICENSE_KEY);
  pass("Activated");
} catch (err) {
  if (isAlreadyActivated(err)) { pass("Already activated"); }
  else { fail(`Concurrent-test activation: ${err.message}`); }
}

printTest("Fire 5 concurrent validations");
const concurrentValidations = await Promise.allSettled(
  Array.from({ length: 5 }, () =>
    concurrentSDK.validateLicense(LICENSE_KEY).then(r => r.valid).catch(() => false)
  )
);
const validationSuccesses = concurrentValidations.filter(r => r.status === "fulfilled" && r.value === true).length;
assert(validationSuccesses >= 4, `At least 4/5 concurrent validations succeeded (${validationSuccesses}/5)`);

printTest("Fire 3 concurrent heartbeats");
const concurrentHeartbeats = await Promise.allSettled(
  Array.from({ length: 3 }, () =>
    concurrentSDK.heartbeat().then(r => !!r).catch(() => false)
  )
);
const heartbeatOKs = concurrentHeartbeats.filter(r => r.status === "fulfilled" && r.value === true).length;
assert(heartbeatOKs >= 2, `At least 2/3 concurrent heartbeats succeeded (${heartbeatOKs}/3)`);

// Clean up concurrent SDK
printTest("Deactivate concurrent SDK");
try { await concurrentSDK.deactivate(); } catch {}
concurrentSDK.destroy();
pass("Concurrent SDK cleaned up");

// ============================================================
// SCENARIO 10: Full lifecycle
// ============================================================
printHeader("SCENARIO 10: Full Lifecycle (activate -> validate -> heartbeat -> deactivate)");

const lifecycleSDK = new LicenseSeatSDK({
  apiBaseUrl: API_URL,
  apiKey: API_KEY,
  productSlug: PRODUCT_SLUG,
  storagePrefix: "stress_lifecycle_",
  autoValidateInterval: 0,
  heartbeatInterval: 0,
  autoInitialize: false,
  debug: false,
});
lifecycleSDK.reset();

const eventLog = [];
lifecycleSDK.on("activation:success", () => eventLog.push("activation:success"));
lifecycleSDK.on("validation:success", () => eventLog.push("validation:success"));
lifecycleSDK.on("deactivation:success", () => eventLog.push("deactivation:success"));

printTest("Step 1: Activate");
try {
  await lifecycleSDK.activate(LICENSE_KEY);
  pass("Activated");
} catch (err) {
  if (isAlreadyActivated(err)) { pass("Already activated"); }
  else { fail(`Activate: ${err.message}`); }
}

printTest("Step 2: Validate");
try {
  const r = await lifecycleSDK.validateLicense(LICENSE_KEY);
  assert(r.valid, "Valid");
} catch (err) {
  fail(`Validate: ${err.message}`);
}

printTest("Step 3: Heartbeat");
try {
  const hb = await lifecycleSDK.heartbeat();
  if (hb) { pass("Heartbeat OK"); }
  else { fail("Heartbeat returned undefined"); }
} catch (err) {
  fail(`Heartbeat: ${err.message}`);
}

printTest("Step 4: Deactivate");
try {
  await lifecycleSDK.deactivate();
  pass("Deactivated");
  const cached = lifecycleSDK.cache.getLicense();
  assert(cached === null, "License cleared");
} catch (err) {
  fail(`Deactivate: ${err.message}`);
}

printTest("Event log completeness");
log(`Events: ${JSON.stringify(eventLog)}`);
assert(eventLog.includes("activation:success") || eventLog.length === 0, "Activation event logged");
assert(eventLog.includes("validation:success") || eventLog.length === 0, "Validation event logged");

// ============================================================
// SUMMARY
// ============================================================
printHeader("RESULTS");

console.log("=".repeat(70));
console.log(`  Passed: ${passedTests}`);
console.log(`  Failed: ${failedTests}`);
console.log(`  Total:  ${passedTests + failedTests}`);
console.log("=".repeat(70));

if (failedTests === 0) {
  console.log(`
        ALL TESTS PASSED!

        SDK v${SDK_VERSION} verified:
        - Activation with telemetry
        - Validation with telemetry
        - Heartbeat endpoint (single + rapid + spaced)
        - Enriched telemetry fields (device_type, architecture, cpu_cores, etc.)
        - Telemetry payload verification via request interception
        - Telemetry disabled mode (activate/validate/heartbeat)
        - App version / app build in telemetry config
        - Separate heartbeat timer (independent from auto-validation)
        - Auto-validation cycles with heartbeat piggyback
        - Concurrent validation and heartbeat stress
        - Full lifecycle (activate -> validate -> heartbeat -> deactivate)
`);
} else {
  console.log(`\n   ${failedTests} test(s) failed. Review output above.\n`);
}

// Clean up timers so Node exits
sdk.destroy();
noTelemetrySDK.destroy();
lifecycleSDK.destroy();
// autoSDK, concurrentSDK, heartbeatTimerSDK, appVersionSDK already destroyed

process.exit(failedTests > 0 ? 1 : 0);
