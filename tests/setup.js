/**
 * Vitest test setup file
 * This file runs before each test file.
 */

import { beforeAll, afterAll, afterEach } from "vitest";
import { server } from "./mocks/server.js";

// Mock localStorage for jsdom environment
const createLocalStorageMock = () => {
  let store = {};
  const mock = {
    getItem: (key) => store[key] || null,
    setItem: (key, value) => {
      store[key] = value.toString();
    },
    removeItem: (key) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (index) => Object.keys(store)[index] || null,
  };

  // Make Object.keys(localStorage) work by returning keys from the store
  return new Proxy(mock, {
    ownKeys: () => Object.keys(store),
    getOwnPropertyDescriptor: (target, prop) => {
      if (prop in store) {
        return { enumerable: true, configurable: true, value: store[prop] };
      }
      return Object.getOwnPropertyDescriptor(target, prop);
    },
  });
};

const localStorageMock = createLocalStorageMock();

Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
});

// Mock window.atob for base64 decoding
if (typeof globalThis.atob === "undefined") {
  globalThis.atob = (str) => Buffer.from(str, "base64").toString("binary");
}

// Mock window.btoa for base64 encoding
if (typeof globalThis.btoa === "undefined") {
  globalThis.btoa = (str) => Buffer.from(str, "binary").toString("base64");
}

// Mock TextEncoder/TextDecoder if not available
if (typeof globalThis.TextEncoder === "undefined") {
  const { TextEncoder, TextDecoder } = await import("util");
  globalThis.TextEncoder = TextEncoder;
  globalThis.TextDecoder = TextDecoder;
}

// Mock canvas for device fingerprinting
HTMLCanvasElement.prototype.getContext = () => ({
  textBaseline: "",
  font: "",
  fillText: () => {},
});

HTMLCanvasElement.prototype.toDataURL = () =>
  "data:image/png;base64,mockCanvasFingerprint";

// Start MSW server before all tests
beforeAll(() => {
  server.listen({ onUnhandledRequest: "warn" });
});

// Reset handlers after each test
afterEach(() => {
  server.resetHandlers();
  localStorage.clear();
});

// Stop server after all tests
afterAll(() => {
  server.close();
});
