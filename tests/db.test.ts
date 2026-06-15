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
const { auditDao } = await import("../src/db/dao/audit");

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

  test("all 10 tables exist (AC-4)", () => {
    const rows = getRawDb()
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%';")
      .all() as { name: string }[];
    const names = rows.map((r) => r.name).sort();
    expect(names).toEqual(
      [
        "audit",
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

describe("auditDao (GRANT-6)", () => {
  test("records entries and roundtrips JSON detail", () => {
    const a = auditDao.record({ action: "permission_grant", provider: "microsoft365", outcome: "success", detail: { granted: ["Mail.Send"] } });
    expect(a.id).toBeTruthy();
    expect(a.outcome).toBe("success");
    const b = auditDao.record({ action: "permission_grant", provider: "microsoft365", outcome: "error", detail: { error: "boom" } });
    const list = auditDao.list(10);
    const ids = list.map((e) => e.id);
    expect(ids).toContain(a.id);
    expect(ids).toContain(b.id);
    expect(list.find((e) => e.id === a.id)?.detail).toEqual({ granted: ["Mail.Send"] });
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
    // updatedAt is refreshed on write; assert it's not older (same-ms ties are fine).
    expect(updated!.updatedAt >= created.updatedAt).toBe(true);

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

describe("performance pragmas (AC-DB1)", () => {
  const pragma = <T>(name: string): T => getRawDb().query(`PRAGMA ${name};`).get() as T;

  test("synchronous = NORMAL (1)", () => {
    expect(pragma<{ synchronous: number }>("synchronous").synchronous).toBe(1);
  });
  test("temp_store = MEMORY (2)", () => {
    expect(pragma<{ temp_store: number }>("temp_store").temp_store).toBe(2);
  });
  test("cache_size = -16000", () => {
    expect(pragma<{ cache_size: number }>("cache_size").cache_size).toBe(-16000);
  });
  test("mmap_size is enabled (file-backed)", () => {
    expect(pragma<{ mmap_size: number }>("mmap_size").mmap_size).toBeGreaterThan(0);
  });
  test("wal_autocheckpoint = 1000", () => {
    expect(pragma<{ wal_autocheckpoint: number }>("wal_autocheckpoint").wal_autocheckpoint).toBe(1000);
  });
});

describe("hot-path indexes (AC-DB2)", () => {
  const plan = (sql: string): string =>
    (getRawDb().query(`EXPLAIN QUERY PLAN ${sql}`).all() as { detail: string }[])
      .map((r) => r.detail)
      .join(" | ");

  test("executions.forJob uses an index (no full SCAN)", () => {
    const detail = plan(
      "SELECT * FROM executions WHERE job_id = 'x' ORDER BY started_at DESC LIMIT 50",
    );
    expect(detail).toMatch(/USING INDEX idx_executions_job_started/);
  });

  test("logs.forExecution uses an index (no full SCAN)", () => {
    const detail = plan(
      "SELECT * FROM logs WHERE execution_id = 'x' ORDER BY timestamp",
    );
    expect(detail).toMatch(/USING INDEX idx_logs_execution/);
  });

  test("baselines.history uses the composite index", () => {
    const detail = plan(
      "SELECT metric_value FROM baselines WHERE job_id = 'x' AND metric_name = 'count' ORDER BY calculated_at DESC LIMIT 30",
    );
    expect(detail).toMatch(/USING INDEX idx_baselines_job_metric_calc/);
  });
});

describe("batched log flush (AC-DB3)", () => {
  test("finalize writes all buffered logs and the patch in one call", () => {
    const job = jobsDao.create({
      name: "batch",
      reportType: "sign-in-anomalies",
      scheduleType: "preset",
      schedulePreset: "daily",
    });
    const exec = executionsDao.create({
      jobId: job.id,
      status: "warning",
      startedAt: new Date().toISOString(),
    });
    const ts = new Date().toISOString();
    const rows = [
      { id: crypto.randomUUID(), executionId: exec.id, level: "info" as const, message: "a", timestamp: ts },
      { id: crypto.randomUUID(), executionId: exec.id, level: "warning" as const, message: "b", timestamp: ts },
      { id: crypto.randomUUID(), executionId: exec.id, level: "error" as const, message: "c", timestamp: ts },
    ];
    const updated = executionsDao.finalize(exec.id, { status: "success", recordsProcessed: 5 }, rows);

    expect(updated?.status).toBe("success");
    expect(updated?.recordsProcessed).toBe(5);
    const persisted = logsDao.forExecution(exec.id);
    expect(persisted.map((l) => l.message)).toEqual(["a", "b", "c"]);

    jobsDao.delete(job.id);
  });

  test("appendMany with empty array is a no-op", () => {
    expect(() => logsDao.appendMany([])).not.toThrow();
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
