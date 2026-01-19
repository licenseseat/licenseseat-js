import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Use jsdom for browser-like environment (localStorage, fetch, etc.)
    environment: "jsdom",

    // Test files pattern
    include: ["tests/**/*.test.js", "tests/**/*.spec.js"],

    // Setup files run before each test file
    setupFiles: ["./tests/setup.js"],

    // Coverage configuration
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.js"],
      exclude: ["src/types.js", "**/*.test.js", "**/*.spec.js"],
    },

    // Global timeout for tests
    testTimeout: 10000,

    // Reporter
    reporters: ["verbose"],

    // Enable globals (describe, it, expect, etc.)
    globals: true,
  },
});
