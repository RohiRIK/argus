import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "argus-sched-"));
process.env.ARGUS_DB_PATH = join(dir, "test.db");
process.env.ARGUS_MASTER_KEY = "0".repeat(64);

const { resolveCron, startScheduler, stopScheduler, isSchedulerStarted } = await import(
  "../src/services/scheduler"
);
const { jobsDao } = await import("../src/db/dao/jobs");
const { runMigrations } = await import("../src/db/migrate");
const { closeDb } = await import("../src/db/client");

beforeAll(() => runMigrations());
afterAll(() => {
  stopScheduler();
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

const mk = (over = {}) =>
  jobsDao.create({
    name: "s",
    reportType: "sign-in-anomalies",
    scheduleType: "preset",
    schedulePreset: "daily",
    ...over,
  });

describe("resolveCron", () => {
  test("preset maps to cron", () => {
    expect(resolveCron(mk({ schedulePreset: "hourly" }))).toBe("0 * * * *");
  });
  test("valid custom cron passes through", () => {
    expect(resolveCron(mk({ scheduleType: "cron", schedulePreset: null, cronExpression: "*/5 * * * *" }))).toBe(
      "*/5 * * * *",
    );
  });
  test("invalid cron resolves to null", () => {
    expect(resolveCron(mk({ scheduleType: "cron", schedulePreset: null, cronExpression: "nope" }))).toBeNull();
  });
  test("unknown preset resolves to null", () => {
    expect(resolveCron(mk({ schedulePreset: "never" }))).toBeNull();
  });
});

describe("startScheduler", () => {
  test("is idempotent (HMR-safe guard)", () => {
    stopScheduler();
    const first = startScheduler();
    expect(isSchedulerStarted()).toBe(true);
    const second = startScheduler();
    expect(second.scheduled).toBe(first.scheduled); // no double-start
    stopScheduler();
    expect(isSchedulerStarted()).toBe(false);
  });
});
