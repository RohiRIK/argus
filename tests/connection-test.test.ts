import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "argus-conn-"));
process.env.ARGUS_DB_PATH = join(dir, "test.db");
process.env.ARGUS_MASTER_KEY = "0".repeat(64);

const { testConnection } = await import("../src/services/graph/connection-test");
const { settingsDao } = await import("../src/db/dao/settings");
const { runMigrations } = await import("../src/db/migrate");
const { closeDb } = await import("../src/db/client");

beforeAll(() => runMigrations());
afterAll(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

describe("testConnection (offline failure path)", () => {
  test("reports auth failure when vault has no credentials; sets status error", async () => {
    const result = await testConnection();
    expect(result.ok).toBe(false);
    expect(result.steps.auth.ok).toBe(false);
    expect(result.steps.auth.error).toBeTruthy();
    expect(settingsDao.get().permissionStatus).toBe("error");
    expect(settingsDao.get().lastPermissionCheck).toBeTruthy();
  });
});
