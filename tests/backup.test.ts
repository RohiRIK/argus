import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "argus-backup-"));
process.env.ARGUS_DB_PATH = join(dir, "test.db");
process.env.ARGUS_MASTER_KEY = "0".repeat(64);

const { exportBackup, importBackup } = await import("../src/services/backup");
const { jobsDao } = await import("../src/db/dao/jobs");
const { runMigrations } = await import("../src/db/migrate");
const { stopScheduler } = await import("../src/services/scheduler");
const { closeDb } = await import("../src/db/client");

beforeAll(() => runMigrations());
afterAll(() => {
  stopScheduler();
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

describe("backup (P5)", () => {
  test("export excludes vault secrets", () => {
    const b = exportBackup();
    expect(b.version).toBe(1);
    expect(JSON.stringify(b)).not.toContain("clientSecret");
    expect((b as unknown as Record<string, unknown>).vault).toBeUndefined();
  });

  test("import round-trips a job", () => {
    const job = jobsDao.create({
      name: "BK Job",
      reportType: "sign-in-anomalies",
      scheduleType: "preset",
      schedulePreset: "daily",
    });
    const snapshot = exportBackup();
    jobsDao.delete(job.id);
    expect(jobsDao.findById(job.id)).toBeUndefined();

    const res = importBackup(snapshot);
    expect(res.jobs).toBeGreaterThanOrEqual(1);
    expect(jobsDao.findById(job.id)?.name).toBe("BK Job");
  });

  test("rejects a malformed payload without writing", () => {
    expect(() => importBackup({ version: 2 })).toThrow();
    expect(() => importBackup({ version: 1, jobs: "nope", templates: [] })).toThrow();
  });
});
