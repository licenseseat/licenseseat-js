/**
 * Type augmentations for non-standard browser APIs used by the telemetry module.
 * These APIs exist in Chromium-based browsers but are not part of the standard
 * TypeScript DOM lib.
 */

interface NavigatorUABrandVersion {
  brand: string;
  version: string;
}

interface NavigatorUAData {
  brands: NavigatorUABrandVersion[];
  mobile: boolean;
  platform: string;
  architecture?: string;
  model?: string;
}

interface Navigator {
  userAgentData?: NavigatorUAData;
  deviceMemory?: number;
}
