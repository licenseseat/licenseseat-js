# Changelog

All notable changes to the LicenseSeat JavaScript SDK will be documented in this file.

This project follows [Semantic Versioning](https://semver.org/).

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
