/**
 * jest.config.ts — electron/ai test suite configuration
 *
 * Run all tests:       npx jest --config electron/ai/jest.config.ts
 * Run unit tests only: npx jest --config electron/ai/jest.config.ts --testNamePattern="^(?!.*integration)"
 * Run with coverage:   npx jest --config electron/ai/jest.config.ts --coverage
 */

import type { Config } from "jest";

const config: Config = {
  // ── Preset ──────────────────────────────────────────────────────────────────
  preset: "ts-jest",
  testEnvironment: "node",

  // ── Roots ───────────────────────────────────────────────────────────────────
  roots: ["<rootDir>"],

  // ── Test file patterns ───────────────────────────────────────────────────────
  testMatch: [
    "**/*.test.ts",
    "**/__tests__/**/*.test.ts",
  ],

  // ── TypeScript transform ─────────────────────────────────────────────────────
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: {
          target:        "ES2022",
          module:        "CommonJS",
          moduleResolution: "node",
          strict:        true,
          esModuleInterop: true,
          skipLibCheck:  true,
        },
      },
    ],
  },

  // ── Coverage ─────────────────────────────────────────────────────────────────
  collectCoverageFrom: [
    "**/*.ts",
    "!**/*.test.ts",
    "!**/__tests__/**",
    "!**/node_modules/**",
    "!jest.config.ts",
  ],

  coverageThreshold: {
    global: {
      branches:  60,
      functions: 70,
      lines:     70,
      statements: 70,
    },
  },

  coverageReporters: ["text", "lcov", "json-summary"],

  // ── Setup files ───────────────────────────────────────────────────────────────
  // ── Timeouts ─────────────────────────────────────────────────────────────────
  testTimeout: 30_000,

  // ── Display ──────────────────────────────────────────────────────────────────
  verbose: true,

  // ── Ignore patterns ──────────────────────────────────────────────────────────
  testPathIgnorePatterns: [
    "/node_modules/",
  ],
};

export default config;
