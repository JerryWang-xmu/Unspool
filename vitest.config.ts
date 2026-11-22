import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "apps/**/test/**/*.test.ts",
      "packages/**/test/**/*.test.ts",
      "tests/contract/**/*.test.ts",
      "tests/integration/**/*.test.ts",
      "tests/security/**/*.test.ts",
      "tests/unit/**/*.test.ts",
    ],
    exclude: ["tests/e2e/**", "tests/setup/**"],
    clearMocks: true,
    passWithNoTests: true,
    restoreMocks: true,
    testTimeout: 10_000,
  },
});
