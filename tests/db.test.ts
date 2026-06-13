import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Point the DB at an isolated temp file BEFORE any module reads getEnv().
const dir = mkdtempSync(join(tmpdir(), "argus-db-"));
process.env.ARGUS_DB_PATH = join(dir, "test.db");

const { getDb, getRawDb, closeDb } = await import("../src/db/client");
const { runMigrations } = await import("../src/db/migrate");
const { jobsDao } = await import("../src/db/dao/jobs");
const { executionsDao, logsDao } = await import("../src/db/dao/executions");
const { settingsDao } = await import("../src/db/dao/settings");

beforeAll(() => {
  runMigrations();
});

afterAll(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

describe("database", () => {
  test("opens in WAL mode (NFR-6)", () => {
    const mode = getRawDb().query("PRAGMA journal_mode;").get() as { journal_mode: string };
    expect(mode.journal_mode.toLowerCase()).toBe("wal");
  });

  test("all 9 tables exist (AC-4)", () => {
    const rows = getRawDb()
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%';")
      .all() as { name: string }[];
    const names = rows.map((r) => r.name).sort();
    expect(names).toEqual(
      [
        "baselines",
        "executions",
        "integrations",
        "jobs",
        "logs",
        "settings",
        "templates",
        "vault",
        "webhooks",
      ].sort(),
    );
  });

  test("foreign keys are enforced", () => {
    const fk = getRawDb().query("PRAGMA foreign_keys;").get() as { foreign_keys: number };
    expect(fk.foreign_keys).toBe(1);
  });
});

describe("jobsDao", () => {
  test("CRUD roundtrip", () => {
    const created = jobsDao.create({
      name: "Daily Sign-in Anomalies",
      reportType: "sign-in-anomalies",
      scheduleType: "preset",
      schedulePreset: "daily",
      recipients: ["admin@example.com"],
    });
    expect(created.id).toBeTruthy();
    expect(created.status).toBe("active");

    const fetched = jobsDao.findById(created.id);
    expect(fetched?.name).toBe("Daily Sign-in Anomalies");

    const updated = jobsDao.update(created.id, { description: "edited" });
    expect(updated?.description).toBe("edited");
    expect(updated?.updatedAt).not.toBe(created.updatedAt);

    expect(jobsDao.active().length).toBeGreaterThan(0);

    jobsDao.delete(created.id);
    expect(jobsDao.findById(created.id)).toBeUndefined();
  });
});

describe("executions + logs (append-only, cascade)", () => {
  test("execution + logs cascade-delete with job", () => {
    const job = jobsDao.create({
      name: "temp",
      reportType: "sign-in-anomalies",
      scheduleType: "preset",
      schedulePreset: "daily",
    });
    const exec = executionsDao.create({
      jobId: job.id,
      status: "success",
      startedAt: new Date().toISOString(),
    });
    logsDao.append(exec.id, "info", "started");
    logsDao.append(exec.id, "error", "boom");

    expect(logsDao.forExecution(exec.id).length).toBe(2);
    expect(logsDao.query({ level: "error" }).length).toBeGreaterThan(0);

    jobsDao.delete(job.id);
    expect(executionsDao.findById(exec.id)).toBeUndefined();
    expect(logsDao.forExecution(exec.id).length).toBe(0); // cascaded
  });
});

describe("settingsDao (singleton)", () => {
  test("get creates default row; update persists", () => {
    const s = settingsDao.get();
    expect(s.id).toBe("singleton");
    expect(s.permissionStatus).toBe("missing");

    const updated = settingsDao.update({ language: "he", permissionStatus: "ok" });
    expect(updated.language).toBe("he");
    expect(settingsDao.get().permissionStatus).toBe("ok");
  });
});
