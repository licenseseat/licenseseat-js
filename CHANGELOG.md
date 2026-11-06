# Changelog

All notable changes to the LicenseSeat JavaScript SDK will be documented in this file.

This project follows [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Security

- An authoritative server denial (`version_not_entitled`, `not_entitled`,
  `product_mismatch`, `floating_not_implemented`, `named_user_not_implemented`,
  any letter case, as `valid: false` or as an HTTP error) is no longer overridden
  by the cached offline token after a later outage or a reload. The denial already
  persisted as the cached validation; offline verification now honours it first.
  The token is kept (a denial is not a revocation), and the next successful online
  validation clears the denial. Matches licenseseat-swift #26.
- The recorded denial is no longer erased by a later failure that is neither a
  denial nor a revocation (an HTTP 503, an unrelated `valid: false`, an offline
  failure). A denial carried by an HTTP 408 is classified before the offline
  fallback is considered (a plain 408 still falls back). Each instance also latches
  the denial in memory, and a denial recorded while offline signature verification
  is in flight (by the same or another instance sharing storage) wins over that
  verification's result.
- A denial carried by a retryable status (408, 429, 5xx) ends the retry loop and is
  returned as the result, so later transient failures can no longer replace it and
  reach the offline fallback. The in-memory denial is bound to the license key and
  device it was received for (activating another key drops it), and an online
  success clears the persisted denial first as its own small write; if storage
  cannot take even that, the session keeps an in-memory online-valid override.
- A `valid: false` revocation (`revoked`, `suspended`, `expired`, `not_active` and
  their `license_` forms) now clears the cached offline token, as the HTTP-error
  form already did.
- Offline tokens with a zero-width validity window (`nbf == exp`) are rejected.
  Windows are half-open `[nbf, exp)`; such a token was previously accepted when
  `nbf` fell inside the clock-skew allowance. Matches the Swift, Rust and C++ SDKs
  and the server (#16).

## [0.5.0] - 2026-08-10

### Security

- Moved license keys out of lifecycle request URLs and into bounded JSON request
  bodies on the product-scoped API routes.
- Restricted credential-bearing requests to the configured HTTPS origin and API
  root, with only an explicit loopback HTTP development exception; redirects,
  cookies, ambiguous paths, query/fragment injection, and oversized bodies are
  rejected.
- Added bounded streaming response reads, strict media-type/framing checks, and a
  duplicate-key-rejecting JSON parser with depth, node, collection, string, and
  numeric limits.
- Bound every authoritative response to the requested license, product, device,
  activation, status, and timestamps before updating SDK state.
- Hardened signed offline verification across envelope shape, canonical bytes,
  Ed25519 key/signature encoding, key ID, visible/signed claim equality, identity,
  entitlement, lifetime, clock rollback, and local grace policy.
- Removed cached validation and cached signing keys as independent roots of
  authority. Offline use now requires an enabled positive local window and an
  explicitly trusted or authenticated signing key.
- Added generation-based lifecycle guards so stale asynchronous work cannot
  restore authority after reset, deactivation, destruction, or a newer result.
- Bounded cache, configuration, telemetry, event, and logging inputs; sensitive
  values are redacted from SDK-generated diagnostics.

### Added

- Added opt-in `browserHighEntropyTelemetryEnabled` collection for the bounded UA
  Client Hints fields `platformVersion`, `architecture`, and `model`. Collection
  is nonblocking, fail-soft, in-memory only, and remains disabled by default.
- Added adversarial regression suites for transport confusion, redirects,
  response framing, strict JSON, cache/key substitution, offline signatures,
  clock rollback, retries, lifecycle races, timers, destruction, telemetry, and
  package entrypoints.

### Changed

- Configuration is normalized and frozen; unknown keys, getters/accessors,
  non-plain objects, unsafe Unicode/control text, insecure production HTTP, and
  out-of-range limits now fail closed.
- `maxOfflineDays: 0` consistently disables offline authority instead of acting
  as an unlimited window.
- Cached online validation no longer grants authority during startup; callers
  must wait for online revalidation or successful signed-offline verification.
- Explicit redirects are refused, and unsafe mutations are not automatically
  replayed.
- Node.js 18 or newer is required, package exports point at built JavaScript and
  declarations, and lint/type/build/package validation now runs in CI.

---

## [0.4.3] - 2026-02-25

### Added

- Added the `LicenseSeatSDK.VERSION` static property.

### Fixed

- Included telemetry when `getOfflineToken()` is called without options.

---

## [0.4.2] - 2026-02-25

### Changed

- Emit `heartbeat:cycle` immediately when the heartbeat timer starts.
- Do not start the heartbeat timer without a configured product slug.
- Validate the SDK version in tests with a semantic-version expression.

---

## [0.4.1] - 2026-02-09

### Changed

- `syncOfflineAssets()` and `verifyCachedOffline()` are now public APIs
- Added offline token download & verification to stress test suite

---

## [0.4.0] - 2026-02-09

### Added

- **Telemetry**: Auto-collected device and environment data is now sent with every POST request. Collected fields include `sdk_name`, `sdk_version`, `os_name`, `os_version`, `platform`, `device_model`, `device_type`, `locale`, `timezone`, `language`, `architecture`, `cpu_cores`, `memory_gb`, `screen_resolution`, `display_scale`, `browser_name`, `browser_version`, `runtime_version`, `app_version`, and `app_build`. Fields that cannot be detected are omitted.
- **Heartbeat endpoint**: New `sdk.heartbeat()` method sends a heartbeat signal to the server, reporting that the current device is still active.
- **Auto-heartbeat**: The SDK now sends periodic heartbeats automatically while a license is active. Default interval is 5 minutes (`300000` ms), configurable via the `heartbeatInterval` option. Set to `0` to disable.
- **New configuration options**:
  - `telemetryEnabled` (default: `true`) -- set `false` to disable telemetry collection (e.g. for GDPR compliance).
  - `appVersion` -- your app version string, sent as `app_version` in telemetry.
  - `appBuild` -- your app build identifier, sent as `app_build` in telemetry.
  - `heartbeatInterval` (default: `300000`) -- interval in ms between automatic heartbeats.
- **New events**: `heartbeat:success` and `heartbeat:cycle` for monitoring heartbeat activity.
- **New export**: `collectTelemetry` function exported for advanced use cases.

---

## [0.3.1] - 2025-12-01

### Fixed

- Auto-validation runaway loop prevention.

---

## [0.3.0] - 2025-11-01

### Changed

- **Breaking**: Updated SDK to v1 API specification.
- `productSlug` is now required for all API operations.
- `apiBaseUrl` default changed to `https://licenseseat.com/api/v1`.
- `deviceIdentifier` renamed to `deviceId`.
- `getOfflineLicense()` renamed to `getOfflineToken()`.
- `getPublicKey()` renamed to `getSigningKey()`.
- Error format standardized to `{ error: { code, message, details? } }`.
- Deactivation response simplified to `{ object, activation_id, deactivated_at }`.

---

## [0.2.2] - 2025-10-01

### Fixed

- Stable device IDs and Node.js support improvements.
- `ConfigurationError` usage fixes.

---

## [0.2.1] - 2025-09-01

### Fixed

- Comprehensive API compliance audit and critical bug fixes.
