import { createHmac, randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

// The local webServer inherits this env, so the suite knows the master key and
// can derive the operator access key (same HMAC as src/lib/auth/access.ts).
process.env.ARGUS_MASTER_KEY ??= randomBytes(32).toString("hex");
const accessKey =
  process.env.ARGUS_ACCESS_KEY ??
  "argus_" +
    createHmac("sha256", Buffer.from(process.env.ARGUS_MASTER_KEY, "hex"))
      .update("argus:access-key:v1")
      .digest("base64url");
process.env.ARGUS_ACCESS_KEY = accessKey;

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
    // Signed in as the operator for every spec; e2e/auth.spec.ts opts out.
    extraHTTPHeaders: { Authorization: `Bearer ${accessKey}` },
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
