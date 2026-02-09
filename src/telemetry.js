/**
 * LicenseSeat SDK Telemetry Collection
 *
 * Collects non-PII platform information for analytics.
 * All fields use snake_case keys to match the server API.
 *
 * @module telemetry
 */

/**
 * Detect the current OS name
 * @returns {string} OS name ("Windows", "macOS", "Linux", "iOS", "Android", or "Unknown")
 * @private
 */
function detectOSName() {
  // Node.js environment
  if (typeof process !== "undefined" && process.platform) {
    const map = {
      darwin: "macOS",
      win32: "Windows",
      linux: "Linux",
      freebsd: "FreeBSD",
      sunos: "SunOS",
    };
    return map[process.platform] || process.platform;
  }

  // Browser: prefer userAgentData when available
  if (typeof navigator !== "undefined") {
    if (navigator.userAgentData && navigator.userAgentData.platform) {
      const p = navigator.userAgentData.platform;
      if (p === "macOS" || p === "Windows" || p === "Linux") return p;
      return p;
    }

    const ua = navigator.userAgent || "";
    if (/Android/i.test(ua)) return "Android";
    if (/iPhone|iPad|iPod/i.test(ua)) return "iOS";
    if (/Mac/i.test(ua)) return "macOS";
    if (/Win/i.test(ua)) return "Windows";
    if (/Linux/i.test(ua)) return "Linux";
  }

  return "Unknown";
}

/**
 * Detect the current OS version
 * @returns {string|null} OS version string or null
 * @private
 */
function detectOSVersion() {
  // Node.js
  if (typeof process !== "undefined" && process.version) {
    try {
      const os = await_free_os_release();
      if (os) return os;
    } catch (_) {
      // fall through
    }
    return process.version; // e.g. "v20.10.0"
  }

  // Browser
  if (typeof navigator !== "undefined") {
    const ua = navigator.userAgent || "";

    // macOS: "Mac OS X 10_15_7" or "Mac OS X 10.15.7"
    const macMatch = ua.match(/Mac OS X\s+([\d._]+)/);
    if (macMatch) return macMatch[1].replace(/_/g, ".");

    // Windows: "Windows NT 10.0"
    const winMatch = ua.match(/Windows NT\s+([\d.]+)/);
    if (winMatch) return winMatch[1];

    // Android: "Android 14"
    const androidMatch = ua.match(/Android\s+([\d.]+)/);
    if (androidMatch) return androidMatch[1];

    // iOS: "OS 17_1_1" or "OS 17.1.1"
    const iosMatch = ua.match(/OS\s+([\d._]+)/);
    if (iosMatch) return iosMatch[1].replace(/_/g, ".");

    // Linux: usually no version in UA
  }

  return null;
}

/**
 * Synchronous OS release helper (avoids top-level await)
 * @returns {string|null}
 * @private
 */
function await_free_os_release() {
  try {
    // Dynamic require for Node.js (won't execute in browser bundles)
    // eslint-disable-next-line no-new-func
    const os = new Function("try { return require('os') } catch(e) { return null }")();
    if (os && os.release) return os.release();
  } catch (_) {
    // not available
  }
  return null;
}

/**
 * Detect the runtime platform
 * @returns {string} "node", "electron", "react-native", "deno", "bun", or "browser"
 * @private
 */
function detectPlatform() {
  if (typeof process !== "undefined") {
    if (process.versions && process.versions.electron) return "electron";
    if (process.versions && process.versions.bun) return "bun";
    if (process.versions && process.versions.node) return "node";
  }
  // @ts-ignore
  if (typeof Deno !== "undefined") return "deno";
  if (typeof navigator !== "undefined" && navigator.product === "ReactNative") return "react-native";
  if (typeof window !== "undefined") return "browser";
  return "unknown";
}

/**
 * Detect device model (browser only, via userAgentData)
 * @returns {string|null}
 * @private
 */
function detectDeviceModel() {
  if (typeof navigator !== "undefined" && navigator.userAgentData) {
    return navigator.userAgentData.model || null;
  }
  return null;
}

/**
 * Detect the user's locale
 * @returns {string|null}
 * @private
 */
function detectLocale() {
  if (typeof navigator !== "undefined" && navigator.language) {
    return navigator.language;
  }
  if (typeof Intl !== "undefined") {
    try {
      return Intl.DateTimeFormat().resolvedOptions().locale || null;
    } catch (_) {
      // fall through
    }
  }
  if (typeof process !== "undefined" && process.env) {
    return process.env.LANG || process.env.LC_ALL || null;
  }
  return null;
}

/**
 * Detect the user's timezone
 * @returns {string|null}
 * @private
 */
function detectTimezone() {
  if (typeof Intl !== "undefined") {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
    } catch (_) {
      // fall through
    }
  }
  return null;
}

/**
 * Collect telemetry data for the current environment.
 * Returns a plain object with snake_case keys matching the server schema.
 * Null/undefined values are filtered out.
 *
 * @param {string} sdkVersion - The SDK version string
 * @returns {Object} Telemetry data object
 */
export function collectTelemetry(sdkVersion) {
  const raw = {
    sdk_version: sdkVersion,
    os_name: detectOSName(),
    os_version: detectOSVersion(),
    platform: detectPlatform(),
    device_model: detectDeviceModel(),
    locale: detectLocale(),
    timezone: detectTimezone(),
    app_version: null,
    app_build: null,
  };

  // Filter out null/undefined values
  const result = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value != null) {
      result[key] = value;
    }
  }
  return result;
}
