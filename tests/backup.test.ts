import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "argus-backup-"));
process.env.ARGUS_DB_PATH = join(dir, "test.db");
process.env.ARGUS_MASTER_KEY = "0".repeat(64);

const { exportBackup, importBackup } = await import("../src/services/backup");
const { jobsDao } = await import("../src/db/dao/jobs");
const { maintenanceWindowsDao } = await import("../src/db/dao/maintenance-windows");
const { settingsDao } = await import("../src/db/dao/settings");
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

  test("round-trips maintenance windows and alerting settings", () => {
    settingsDao.update({ alertThreshold: 3, suppressEmptyReports: false });
    const win = maintenanceWindowsDao.create({
      name: "Weekly Patch",
      kind: "recurring",
      dayOfWeek: 0,
      startMinute: 60,
      endMinute: 120,
      enabled: true,
    });

    const snapshot = exportBackup();
    expect(snapshot.maintenanceWindows?.some((w) => w.id === win.id)).toBe(true);
    expect(snapshot.settings.alertThreshold).toBe(3);
    expect(snapshot.settings.suppressEmptyReports).toBe(false);

    maintenanceWindowsDao.delete(win.id);
    settingsDao.update({ alertThreshold: 0, suppressEmptyReports: true });

    const res = importBackup(snapshot);
    expect(res.maintenanceWindows).toBeGreaterThanOrEqual(1);
    expect(maintenanceWindowsDao.findById(win.id)?.name).toBe("Weekly Patch");
    expect(settingsDao.get().alertThreshold).toBe(3);
    expect(settingsDao.get().suppressEmptyReports).toBe(false);
  });

  test("rolls back atomically if an imported maintenance window is invalid", () => {
    const beforeJobs = jobsDao.findAll().length;
    expect(() =>
      importBackup({
        version: 1,
        exportedAt: new Date().toISOString(),
        jobs: [
          {
            id: "rollback-job-1",
            name: "Should Roll Back",
            description: "",
            reportType: "sign-in-anomalies",
            params: {},
            scheduleType: "preset",
            schedulePreset: "daily",
            cronExpression: null,
            templateId: null,
            recipients: [],
            recipientGroupIds: [],
            conditionalRules: { mode: "always" },
            tags: [],
            status: "active",
            snoozedUntil: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        templates: [],
        maintenanceWindows: [
          {
            id: "bad-win-1",
            name: "Bad",
            kind: "recurring",
            dayOfWeek: 0,
            startMinute: 400,
            endMinute: 100, // invalid wrap
            startsAt: null,
            endsAt: null,
            enabled: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        settings: exportBackup().settings,
      }),
    ).toThrow();
    expect(jobsDao.findAll().length).toBe(beforeJobs);
    expect(jobsDao.findById("rollback-job-1")).toBeUndefined();
  });
});
