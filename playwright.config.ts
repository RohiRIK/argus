import { defineConfig, devices } from "@playwright/test";

const PORT = 3993;
// When E2E_BASE_URL is set (e.g. the Docker container), test against it and skip
// the local webServer.
const external = process.env.E2E_BASE_URL;
const baseURL = external ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL,
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  // VR runs first, against the pristine boot-time seed. The functional ("app")
  // tests create/run/tag jobs in the shared e2e DB, so they must run *after* the
  // pixel baselines are captured — enforced via the project dependency below.
  projects: [
    {
      name: "vr",
      testMatch: /vr\.spec\.ts$/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "app",
      testIgnore: /vr\.spec\.ts$/,
      dependencies: ["vr"],
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: external
    ? undefined
    : {
        command: "bash scripts/e2e-server.sh",
        url: `${baseURL}/api/health`,
        timeout: 120_000,
        reuseExistingServer: !process.env.CI,
        stdout: "pipe",
        stderr: "pipe",
      },
});
