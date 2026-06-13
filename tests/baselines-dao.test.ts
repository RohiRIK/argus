import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "argus-bl-"));
process.env.ARGUS_DB_PATH = join(dir, "test.db");
process.env.ARGUS_MASTER_KEY = "0".repeat(64);

const { baselinesDao } = await import("../src/db/dao/baselines");
const { jobsDao } = await import("../src/db/dao/jobs");
const { getDb } = await import("../src/db/client");
const { runMigrations } = await import("../src/db/migrate");
const { closeDb } = await import("../src/db/client");
const { baselines } = await import("../src/db/schema");

beforeAll(() => runMigrations());
afterAll(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

describe("baselinesDao.prune", () => {
  test("removes rows older than the window, keeps recent", () => {
    const job = jobsDao.create({
      name: "p",
      reportType: "sign-in-anomalies",
      scheduleType: "preset",
      schedulePreset: "daily",
    });

    // Recent rows via the DAO.
    baselinesDao.record(job.id, "count", 5);
    baselinesDao.record(job.id, "count", 7);

    // Two stale rows (120 days old) inserted directly.
    const old = new Date(Date.now() - 120 * 86_400_000).toISOString();
    for (const v of [1, 2]) {
      getDb()
        .insert(baselines)
        .values({ id: crypto.randomUUID(), jobId: job.id, metricName: "count", metricValue: v, windowDays: 7, calculatedAt: old })
        .run();
    }

    const removed = baselinesDao.prune(90);
    expect(removed).toBe(2);
    expect(baselinesDao.history(job.id, "count").sort()).toEqual([5, 7]);
  });
});
