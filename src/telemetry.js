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
      return navigator.userAgentData.platform;
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
 * Dynamic require helper for Node.js modules (won't execute in browser bundles)
 * @param {string} moduleName - The module to require
 * @returns {Object|null}
 * @private
 */
function dynamicRequire(moduleName) {
  try {
    // eslint-disable-next-line no-new-func
    return new Function("m", "try { return require(m) } catch(e) { return null }")(moduleName);
  } catch (_) {
    return null;
  }
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
  try {
    if (typeof navigator !== "undefined" && navigator.userAgentData) {
      return navigator.userAgentData.model || null;
    }
  } catch (_) {
    // not available
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
 * Detect device type
 * @returns {string} "phone", "tablet", "desktop", "server", or "unknown"
 * @private
 */
function detectDeviceType() {
  try {
    const platform = detectPlatform();

    // Node.js server (but not Electron)
    if (platform === "node" || platform === "bun" || platform === "deno") return "server";
    if (platform === "electron") return "desktop";

    // React Native: check screen dimensions
    if (platform === "react-native") {
      if (typeof screen !== "undefined" && screen.width) {
        return screen.width < 768 ? "phone" : "tablet";
      }
      return "phone";
    }

    // Browser
    if (typeof navigator !== "undefined") {
      // Check userAgentData.mobile first (Chromium)
      if (navigator.userAgentData && typeof navigator.userAgentData.mobile === "boolean") {
        if (navigator.userAgentData.mobile) {
          // Distinguish phone vs tablet by screen width
          if (typeof screen !== "undefined" && screen.width >= 768) return "tablet";
          return "phone";
        }
        return "desktop";
      }

      // Fallback: touch points heuristic
      if (navigator.maxTouchPoints > 0) {
        if (typeof screen !== "undefined" && screen.width >= 768) return "tablet";
        return "phone";
      }

      return "desktop";
    }
  } catch (_) {
    // fall through
  }
  return "unknown";
}

/**
 * Detect CPU architecture
 * @returns {string|null} "arm64", "x64", "x86", "arm", or null
 * @private
 */
function detectArchitecture() {
  try {
    // Node.js / Bun
    if (typeof process !== "undefined" && process.arch) {
      const map = { ia32: "x86", x64: "x64", arm: "arm", arm64: "arm64" };
      return map[process.arch] || process.arch;
    }

    // Browser: userAgentData.architecture (sync access, may be empty string)
    if (typeof navigator !== "undefined" && navigator.userAgentData) {
      // architecture may not be available synchronously; getHighEntropyValues is async
      // We can only get it if it's already populated
      if (navigator.userAgentData.architecture) {
        return navigator.userAgentData.architecture;
      }
    }
  } catch (_) {
    // not available
  }
  return null;
}

/**
 * Detect number of CPU cores
 * @returns {number|null}
 * @private
 */
function detectCpuCores() {
  try {
    // Browser
    if (typeof navigator !== "undefined" && navigator.hardwareConcurrency) {
      return navigator.hardwareConcurrency;
    }

    // Node.js
    if (typeof process !== "undefined" && process.versions && process.versions.node) {
      const os = dynamicRequire("os");
      if (os && os.cpus) {
        const cpus = os.cpus();
        if (cpus && cpus.length) return cpus.length;
      }
    }
  } catch (_) {
    // not available
  }
  return null;
}

/**
 * Detect approximate RAM in GB
 * @returns {number|null}
 * @private
 */
function detectMemoryGb() {
  try {
    // Browser (Chrome only)
    if (typeof navigator !== "undefined" && navigator.deviceMemory) {
      return navigator.deviceMemory;
    }

    // Node.js
    if (typeof process !== "undefined" && process.versions && process.versions.node) {
      const os = dynamicRequire("os");
      if (os && os.totalmem) {
        return Math.round(os.totalmem() / (1024 * 1024 * 1024));
      }
    }
  } catch (_) {
    // not available
  }
  return null;
}

/**
 * Detect 2-letter language code
 * @returns {string|null} e.g. "en", "pt", "es"
 * @private
 */
function detectLanguage() {
  try {
    const locale = detectLocale();
    if (locale) {
      const lang = locale.split(/[-_]/)[0];
      if (lang && lang.length >= 2) return lang.toLowerCase();
    }
  } catch (_) {
    // fall through
  }
  return null;
}

/**
 * Detect screen resolution
 * @returns {string|null} e.g. "1920x1080"
 * @private
 */
function detectScreenResolution() {
  try {
    if (typeof screen !== "undefined" && screen.width && screen.height) {
      return `${screen.width}x${screen.height}`;
    }
  } catch (_) {
    // not available
  }
  return null;
}

/**
 * Detect display pixel ratio
 * @returns {number|null}
 * @private
 */
function detectDisplayScale() {
  try {
    if (typeof window !== "undefined" && window.devicePixelRatio) {
      return window.devicePixelRatio;
    }
  } catch (_) {
    // not available
  }
  return null;
}

/**
 * Detect browser name
 * @returns {string|null} e.g. "Chrome", "Safari", "Firefox", "Edge"
 * @private
 */
function detectBrowserName() {
  try {
    if (typeof navigator === "undefined") return null;

    // Prefer userAgentData brands (Chromium-based browsers)
    if (navigator.userAgentData && navigator.userAgentData.brands) {
      const brands = navigator.userAgentData.brands;
      // Look for specific browser brands, skip "Chromium" and "Not" brands
      for (const b of brands) {
        const name = b.brand || "";
        if (/^(Google Chrome|Microsoft Edge|Opera|Brave|Vivaldi|Samsung Internet)$/i.test(name)) {
          return name;
        }
      }
      // Fallback to Chromium if that's all we have
      for (const b of brands) {
        if ((b.brand || "").toLowerCase() === "chromium") return "Chrome";
      }
    }

    // Fallback: parse user agent string
    const ua = navigator.userAgent || "";
    if (/Edg\//i.test(ua)) return "Edge";
    if (/OPR\//i.test(ua) || /Opera/i.test(ua)) return "Opera";
    if (/Brave/i.test(ua)) return "Brave";
    if (/Vivaldi/i.test(ua)) return "Vivaldi";
    if (/Firefox/i.test(ua)) return "Firefox";
    if (/SamsungBrowser/i.test(ua)) return "Samsung Internet";
    if (/CriOS/i.test(ua)) return "Chrome"; // Chrome on iOS
    if (/Chrome/i.test(ua)) return "Chrome";
    if (/Safari/i.test(ua)) return "Safari";
  } catch (_) {
    // not available
  }
  return null;
}

/**
 * Detect browser version
 * @returns {string|null} e.g. "123.0"
 * @private
 */
function detectBrowserVersion() {
  try {
    if (typeof navigator === "undefined") return null;

    // Prefer userAgentData brands
    if (navigator.userAgentData && navigator.userAgentData.brands) {
      const brands = navigator.userAgentData.brands;
      for (const b of brands) {
        const name = b.brand || "";
        if (/^(Google Chrome|Microsoft Edge|Opera|Brave|Vivaldi|Samsung Internet)$/i.test(name)) {
          return b.version || null;
        }
      }
      for (const b of brands) {
        if ((b.brand || "").toLowerCase() === "chromium") return b.version || null;
      }
    }

    // Fallback: parse user agent
    const ua = navigator.userAgent || "";
    const patterns = [
      /Edg\/([\d.]+)/,
      /OPR\/([\d.]+)/,
      /Firefox\/([\d.]+)/,
      /SamsungBrowser\/([\d.]+)/,
      /CriOS\/([\d.]+)/,
      /Chrome\/([\d.]+)/,
      /Version\/([\d.]+).*Safari/,
    ];
    for (const re of patterns) {
      const m = ua.match(re);
      if (m) return m[1];
    }
  } catch (_) {
    // not available
  }
  return null;
}

/**
 * Detect runtime version
 * @returns {string|null} e.g. "20.11.0" for Node, "1.40.0" for Deno
 * @private
 */
function detectRuntimeVersion() {
  try {
    if (typeof process !== "undefined" && process.versions) {
      if (process.versions.bun) return process.versions.bun;
      if (process.versions.electron) return process.versions.electron;
      if (process.versions.node) return process.versions.node;
    }
    // @ts-ignore
    if (typeof Deno !== "undefined" && Deno.version) return Deno.version.deno;
  } catch (_) {
    // not available
  }
  return null;
}

/**
 * Collect telemetry data for the current environment.
 * Returns a plain object with snake_case keys matching the server schema.
 * Null/undefined values are filtered out.
 *
 * @param {string} sdkVersion - The SDK version string
 * @param {Object} [options] - Additional options
 * @param {string} [options.appVersion] - User-provided app version
 * @param {string} [options.appBuild] - User-provided app build
 * @returns {Object} Telemetry data object
 */
export function collectTelemetry(sdkVersion, options) {
  const locale = detectLocale();

  const raw = {
    sdk_version: sdkVersion,
    sdk_name: 'js',
    os_name: detectOSName(),
    os_version: detectOSVersion(),
    platform: detectPlatform(),
    device_model: detectDeviceModel(),
    device_type: detectDeviceType(),
    locale: locale,
    timezone: detectTimezone(),
    language: detectLanguage(),
    architecture: detectArchitecture(),
    cpu_cores: detectCpuCores(),
    memory_gb: detectMemoryGb(),
    screen_resolution: detectScreenResolution(),
    display_scale: detectDisplayScale(),
    browser_name: detectBrowserName(),
    browser_version: detectBrowserVersion(),
    runtime_version: detectRuntimeVersion(),
    app_version: (options && options.appVersion) || null,
    app_build: (options && options.appBuild) || null,
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
