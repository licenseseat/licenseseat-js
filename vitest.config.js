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
      thresholds: {
        perFile: true,
        statements: 90,
        branches: 80,
        functions: 95,
        lines: 90,
      },
    },

    // Global timeout for tests
    testTimeout: 10000,

    // Reporter
    reporters: ["verbose"],

    // Enable globals (describe, it, expect, etc.)
    globals: true,
  },
});
