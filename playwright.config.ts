import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  timeout: 30_000,
  expect: {
    timeout: 30_000,
  },
  use: {
    baseURL: process.env.UNSPOOL_E2E_BASE_URL ?? "http://127.0.0.1:1420",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(process.env.UNSPOOL_PLAYWRIGHT_CHANNEL === undefined
          ? {}
          : { channel: process.env.UNSPOOL_PLAYWRIGHT_CHANNEL }),
      },
    },
  ],
});
