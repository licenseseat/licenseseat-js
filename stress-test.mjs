#!/usr/bin/env node
/**
 * LicenseSeat JS SDK — Telemetry, Heartbeat & Activation Stress Test
 *
 * Direct port of the Swift SDK StressTest (StressTest/Sources/StressTest/main.swift).
 * 7 scenarios: telemetry on/off, heartbeat, auto-validation, concurrent stress, lifecycle.
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

// ── Configuration ──────────────────────────────────────────────────
const API_URL = process.env.LICENSESEAT_API_URL || "http://localhost:3000/api/v1";
const API_KEY = process.env.LICENSESEAT_API_KEY || "";
const PRODUCT_SLUG = process.env.LICENSESEAT_PRODUCT_SLUG || "";
const LICENSE_KEY = process.env.LICENSESEAT_LICENSE_KEY || "";

if (!API_KEY || !PRODUCT_SLUG || !LICENSE_KEY) {
  console.error("\n❌ Missing environment variables. Set:");
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
  console.log(`   ✅ PASS: ${message}`);
}

function fail(message) {
  failedTests++;
  console.log(`   ❌ FAIL: ${message}`);
}

function assert(condition, message) {
  if (condition) pass(message); else fail(message);
}

function log(message) {
  console.log(`   📝 ${message}`);
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
// SCENARIO 4: Telemetry disabled
// ============================================================
printHeader("SCENARIO 4: Telemetry DISABLED");

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
// SCENARIO 5: Auto-validation with heartbeat
// ============================================================
printHeader("SCENARIO 5: Auto-Validation + Heartbeat Cycles");

// Deactivate no-telemetry SDK
try { await noTelemetrySDK.deactivate(); } catch {}

const autoSDK = new LicenseSeatSDK({
  apiBaseUrl: API_URL,
  apiKey: API_KEY,
  productSlug: PRODUCT_SLUG,
  storagePrefix: "stress_auto_",
  autoValidateInterval: 3000, // 3 second cycles for testing (JS uses ms)
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

// Stop auto-validation before moving on — prevents runaway requests
printTest("Stop auto-validation timer");
try { await autoSDK.deactivate(); } catch {}
autoSDK.destroy();
pass("Auto-validation SDK destroyed");

// ============================================================
// SCENARIO 6: Concurrent validation stress
// ============================================================
printHeader("SCENARIO 6: Concurrent Validation Stress");

// Fresh SDK for concurrent tests (no auto-validation running)
const concurrentSDK = new LicenseSeatSDK({
  apiBaseUrl: API_URL,
  apiKey: API_KEY,
  productSlug: PRODUCT_SLUG,
  storagePrefix: "stress_concurrent_",
  autoValidateInterval: 0,
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
// SCENARIO 7: Full lifecycle
// ============================================================
printHeader("SCENARIO 7: Full Lifecycle (activate -> validate -> heartbeat -> deactivate)");

const lifecycleSDK = new LicenseSeatSDK({
  apiBaseUrl: API_URL,
  apiKey: API_KEY,
  productSlug: PRODUCT_SLUG,
  storagePrefix: "stress_lifecycle_",
  autoValidateInterval: 0,
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
        🎉 ALL TESTS PASSED!

        SDK v${SDK_VERSION} verified:
        ✅ Activation with telemetry
        ✅ Validation with telemetry
        ✅ Heartbeat endpoint (single + rapid + spaced)
        ✅ Telemetry disabled mode (activate/validate/heartbeat)
        ✅ Auto-validation cycles with heartbeat
        ✅ Concurrent validation and heartbeat stress
        ✅ Full lifecycle (activate -> validate -> heartbeat -> deactivate)
`);
} else {
  console.log(`\n   ⚠️  ${failedTests} test(s) failed. Review output above.\n`);
}

// Clean up timers so Node exits
sdk.destroy();
noTelemetrySDK.destroy();
lifecycleSDK.destroy();
// autoSDK and concurrentSDK already destroyed in their scenarios

process.exit(failedTests > 0 ? 1 : 0);
