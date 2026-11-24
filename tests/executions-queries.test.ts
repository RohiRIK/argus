import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "argus-execq-"));
process.env.ARGUS_DB_PATH = join(dir, "test.db");
process.env.ARGUS_MASTER_KEY = "0".repeat(64);

const { jobsDao } = await import("../src/db/dao/jobs");
const { executionsDao } = await import("../src/db/dao/executions");
const { enqueueRun, resetRunQueue } = await import("../src/services/run-queue");
const runRoute = await import("../src/app/api/jobs/[id]/run/route");
const jobExecsRoute = await import("../src/app/api/jobs/[id]/executions/route");
const { runMigrations } = await import("../src/db/migrate");
const { closeDb } = await import("../src/db/client");
import type { Execution } from "../src/db/schema";

beforeAll(() => runMigrations());
afterAll(() => {
  resetRunQueue();
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

describe("executionsDao batch & projection queries", () => {
  test("latestByJobIds omits outputHtml and returns newest per job", () => {
    const j1 = jobsDao.create({ name: "J1", reportType: "sign-in-anomalies", scheduleType: "preset", schedulePreset: "daily" });
    const j2 = jobsDao.create({ name: "J2", reportType: "sign-in-anomalies", scheduleType: "preset", schedulePreset: "daily" });
    executionsDao.create({ jobId: j1.id, status: "failed", startedAt: "2026-06-01T08:00:00Z", outputHtml: "<h1>old</h1>", recordsProcessed: 1 });
    executionsDao.create({ jobId: j1.id, status: "success", startedAt: "2026-06-02T08:00:00Z", outputHtml: "<h1>new</h1>", recordsProcessed: 9 });
    executionsDao.create({ jobId: j2.id, status: "suppressed", startedAt: "2026-06-01T09:00:00Z", outputHtml: "<h1>j2</h1>", recordsProcessed: 0 });

    const map = executionsDao.latestByJobIds([j1.id, j2.id]);
    expect(map.size).toBe(2);
    expect(map.get(j1.id)?.status).toBe("success");
    expect(map.get(j1.id)?.recordsProcessed).toBe(9);
    expect((map.get(j1.id) as unknown as Record<string, unknown>)?.outputHtml).toBeUndefined();
    expect(map.get(j2.id)?.status).toBe("suppressed");
    expect(executionsDao.latestByJobIds([]).size).toBe(0);
  });

  test("recentStatusesByJobIds respects perJobLimit", () => {
    const j = jobsDao.create({ name: "Hist", reportType: "sign-in-anomalies", scheduleType: "preset", schedulePreset: "daily" });
    for (let i = 1; i <= 5; i++) {
      executionsDao.create({ jobId: j.id, status: i === 5 ? "warning" : "success", startedAt: `2026-06-0${i}T08:00:00Z` });
    }
    const map = executionsDao.recentStatusesByJobIds([j.id], 3);
    const list = map.get(j.id) ?? [];
    expect(list).toHaveLength(3);
    expect(list[0].status).toBe("warning");
  });

  test("latestCountForJob, latestMetricsForJob, and recentStatusesForJob", () => {
    const j = jobsDao.create({ name: "Metrics", reportType: "secure-score", scheduleType: "preset", schedulePreset: "daily" });
    const e1 = executionsDao.create({
      jobId: j.id,
      status: "success",
      startedAt: "2026-06-01T08:00:00Z",
      recordsProcessed: 10,
      metricsSnapshot: { count: 10, currentScore: 68 },
    });
    // Failed run without snapshot should be skipped by latestMetricsForJob
    const e2 = executionsDao.create({
      jobId: j.id,
      status: "failed",
      startedAt: "2026-06-02T08:00:00Z",
      recordsProcessed: 0,
    });
    const current = executionsDao.create({ jobId: j.id, status: "warning", startedAt: "2026-06-03T08:00:00Z" });

    expect(executionsDao.latestCountForJob(j.id, current.id)).toBe(0); // e2 is latest prior
    expect(executionsDao.latestMetricsForJob(j.id, current.id, "currentScore")).toBe(68);
    expect(executionsDao.latestMetricsForJob(j.id, current.id, "missing")).toBeNull();
    expect(executionsDao.recentStatusesForJob(j.id, 10)).toEqual(["warning", "failed", "success"]);
    expect(e1.id).toBeTruthy();
    expect(e2.id).toBeTruthy();
  });
});

describe("execution routes concurrency & limit bounds", () => {
  test("POST /api/jobs/:id/run returns 409 ConflictError when job is already in flight", async () => {
    const job = jobsDao.create({ name: "Busy", reportType: "sign-in-anomalies", scheduleType: "preset", schedulePreset: "daily" });
    let release!: (e: Execution) => void;
    const inflight = enqueueRun(job, undefined, () => new Promise<Execution>((r) => { release = r; }));

    const res = await runRoute.POST(new Request("http://t"), { params: Promise.resolve({ id: job.id }) });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("ConflictError");

    release({
      id: "done",
      jobId: job.id,
      status: "success",
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      recordsProcessed: 0,
      graphApiLatencyMs: 1,
      errorMessage: null,
      outputHtml: null,
      emailSent: false,
      emailRecipients: null,
      suppressionReason: null,
      baselineSnapshot: null,
      metricsSnapshot: null,
      webhookDelivered: false,
      webhookError: null,
      createdAt: new Date().toISOString(),
    });
    await inflight;
  });

  test("GET /api/jobs/:id/executions clamps limit safely", async () => {
    const job = jobsDao.create({ name: "Clamp", reportType: "sign-in-anomalies", scheduleType: "preset", schedulePreset: "daily" });
    executionsDao.create({ jobId: job.id, status: "success", startedAt: "2026-06-01T08:00:00Z" });
    executionsDao.create({ jobId: job.id, status: "success", startedAt: "2026-06-02T08:00:00Z" });

    const rLow = await jobExecsRoute.GET(new Request(`http://t/api/jobs/${job.id}/executions?limit=-5`), { params: Promise.resolve({ id: job.id }) });
    expect(rLow.status).toBe(200);
    expect((await rLow.json()).data).toHaveLength(1);

    const rHigh = await jobExecsRoute.GET(new Request(`http://t/api/jobs/${job.id}/executions?limit=9999`), { params: Promise.resolve({ id: job.id }) });
    expect(rHigh.status).toBe(200);
    expect((await rHigh.json()).data).toHaveLength(2);
  });
});
