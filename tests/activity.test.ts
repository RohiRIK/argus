import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LogCursor } from "../src/db/dao/executions";

const dir = mkdtempSync(join(tmpdir(), "argus-activity-"));
process.env.ARGUS_DB_PATH = join(dir, "test.db");
process.env.ARGUS_MASTER_KEY = "0".repeat(64);

const { runMigrations } = await import("../src/db/migrate");
const { closeDb } = await import("../src/db/client");
const { jobsDao } = await import("../src/db/dao/jobs");
const { executionsDao, logsDao } = await import("../src/db/dao/executions");
const { automationPoliciesDao, automationRunsDao, automationLogsDao } = await import("../src/db/dao/automations");
const { auditDao } = await import("../src/db/dao/audit");
const { activityRunsDao } = await import("../src/db/dao/activity-runs");
const { activityLogsDao, formatEvent } = await import("../src/db/dao/activity-logs");
const runsRoute = await import("../src/app/api/runs/route");
const logsRoute = await import("../src/app/api/logs/route");
const { runPillStatus, runSummary, formatDuration } = await import("../src/lib/activity");

const at = (sec: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, sec)).toISOString();

let execIds: string[] = [];
let runIds: string[] = [];
let auditIds: string[] = [];

beforeAll(() => {
  runMigrations();
  const job = jobsDao.create({ name: "Risky users weekly", reportType: "sign-in-anomalies", scheduleType: "preset", schedulePreset: "daily" });
  // Reports at even seconds (one failed), automations at odd seconds plus one tie with a report.
  execIds = [0, 2, 4, 6].map(
    (s, i) =>
      executionsDao.create({
        jobId: job.id,
        status: i === 1 ? "failed" : "success",
        trigger: "scheduled",
        startedAt: at(s),
        endedAt: at(s + 3),
        recordsProcessed: 10 + i,
      }).id,
  );
  const policy = automationPoliciesDao.create({
    name: "Block risky users",
    automationType: "high-risk-user-containment",
    mode: "audit",
    params: {},
    scheduleType: "manual",
    status: "active",
  });
  runIds = [
    automationRunsDao.create({ policyId: policy.id, mode: "audit", trigger: "manual", status: "drift_detected", startedAt: at(1), plannedCount: 3, evaluatedCount: 40 }).id,
    automationRunsDao.create({ policyId: policy.id, mode: "enforce", trigger: "schedule", status: "success", startedAt: at(4), appliedCount: 2, evaluatedCount: 40 }).id,
  ];

  logsDao.appendMany([{ id: crypto.randomUUID(), executionId: execIds[0]!, level: "info", message: "report line", timestamp: at(0) }]);
  automationLogsDao.append(runIds[0]!, "warning", "automation line");
  auditIds = [
    auditDao.record({ action: "auth.login", outcome: "error", detail: { username: "alice", password: "hunter2" } }).id,
    auditDao.record({ action: "permission_grant", provider: "microsoft365", outcome: "success", detail: { secret: "s3cr3t" } }).id,
  ];
});

afterAll(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

describe("activityRunsDao", () => {
  test("merges report executions and automation runs newest first, with names", () => {
    const { rows, hasMore } = activityRunsDao.page({}, { limit: 50 });
    expect(hasMore).toBe(false);
    expect(rows.length).toBe(6);
    const keys = rows.map((r) => `${r.startedAt}|${r.id}`);
    expect(keys).toEqual([...keys].sort().reverse());
    expect(rows.filter((r) => r.source === "report").every((r) => r.name === "Risky users weekly")).toBe(true);
    expect(rows.filter((r) => r.source === "automation").every((r) => r.name === "Block risky users")).toBe(true);
  });

  test("keyset pages are gap-free and duplicate-free across sources and tied timestamps", () => {
    const seen: string[] = [];
    let after: LogCursor | null = null;
    for (;;) {
      const p = activityRunsDao.page({}, { limit: 2, after });
      seen.push(...p.rows.map((r) => r.id));
      if (!p.hasMore) break;
      after = p.nextCursor;
    }
    expect(seen.length).toBe(6);
    expect(new Set(seen).size).toBe(6);
  });

  test("source and outcome filters, with counts that match", () => {
    expect(activityRunsDao.page({ source: "automation" }).rows.map((r) => r.id).sort()).toEqual([...runIds].sort());
    expect(activityRunsDao.page({ outcome: "failed" }).rows.map((r) => r.id)).toEqual([execIds[1]!]);
    const attention = activityRunsDao.page({ outcome: "attention" }).rows;
    expect(attention.map((r) => r.id)).toEqual([runIds[0]!]);
    expect(activityRunsDao.count({ outcome: "ok" })).toBe(4);
    expect(activityRunsDao.count({})).toBe(6);
  });

  test("audit runs report planned changes, enforce runs applied changes; durations computed", () => {
    const rows = activityRunsDao.page({}).rows;
    expect(rows.find((r) => r.id === runIds[0])!.changes).toBe(3);
    expect(rows.find((r) => r.id === runIds[1])!.changes).toBe(2);
    expect(rows.find((r) => r.id === execIds[0])!.durationMs).toBe(3000);
    expect(rows.find((r) => r.id === runIds[0])!.durationMs).toBeNull();
  });
});

describe("activityLogsDao events", () => {
  test("audit events appear as source=event with mapped levels", () => {
    const rows = activityLogsDao.page({ source: "event" }).rows;
    expect(rows.map((r) => r.id).sort()).toEqual([...auditIds].sort());
    const login = rows.find((r) => r.id === auditIds[0])!;
    expect(login.level).toBe("error");
    expect(login.message).toBe("Sign-in failed: alice");
    expect(rows.find((r) => r.id === auditIds[1])!.level).toBe("info");
  });

  test("event messages never include non-whitelisted detail", () => {
    const text = activityLogsDao.page({}).rows.map((r) => r.message).join("\n");
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("s3cr3t");
  });

  test("level filter applies to events through the outcome mapping", () => {
    const errors = activityLogsDao.page({ level: "error" }).rows;
    expect(errors.map((r) => r.id)).toEqual([auditIds[0]!]);
    expect(activityLogsDao.count({ level: "error" })).toBe(1);
  });

  test("all sources merge; narrowing to an execution or run excludes events", () => {
    const sources = new Set(activityLogsDao.page({}).rows.map((r) => r.source));
    expect([...sources].sort()).toEqual(["automation", "event", "report"]);
    expect(activityLogsDao.page({ executionId: execIds[0] }).rows.every((r) => r.source === "report")).toBe(true);
    expect(activityLogsDao.page({ runId: runIds[0] }).rows.every((r) => r.source === "automation")).toBe(true);
  });

  test("formatEvent labels, partial outcome and malformed detail", () => {
    expect(formatEvent("permission_grant", "info", "microsoft365", "{}")).toBe("Permissions granted · microsoft365");
    expect(formatEvent("mailbox_verify", "warning", null, null)).toBe("Sender mailbox verified (partial)");
    expect(formatEvent("automation.run_interrupted", "error", null, "not json")).toBe("Automation run interrupted failed");
  });
});

describe("GET /api/runs", () => {
  const call = async (qs: string) => {
    const res = await runsRoute.GET(new Request(`http://localhost/api/runs${qs}`));
    return { status: res.status, body: await res.json() };
  };

  test("returns merged rows with hrefs and paging meta", async () => {
    const { status, body } = await call("?limit=4");
    expect(status).toBe(200);
    expect(body.data.length).toBe(4);
    expect(body.meta.total).toBe(6);
    expect(body.meta.hasMore).toBe(true);
    for (const r of body.data) {
      expect(r.href).toBe(r.source === "report" ? `/executions/${r.id}` : `/automations/runs/${r.id}`);
    }
    const next = await call(`?limit=4&cursor=${body.meta.nextCursor}`);
    expect(next.body.data.length).toBe(2);
    expect(next.body.meta.nextCursor).toBeNull();
  });

  test("rejects invalid source, outcome, limit and cursor with 400", async () => {
    for (const qs of ["?source=nope", "?outcome=bad", "?limit=0", "?limit=9999", "?cursor=%%%", "?from=yesterday"]) {
      expect((await call(qs)).status).toBe(400);
    }
  });
});

describe("GET /api/logs source=event", () => {
  test("accepts event and returns events without hrefs", async () => {
    const res = await logsRoute.GET(new Request("http://localhost/api/logs?source=event"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.length).toBe(2);
    expect(body.data.every((r: { source: string; href: string | null }) => r.source === "event" && r.href === null)).toBe(true);
  });
});

describe("activity formatters", () => {
  test("runPillStatus maps drift and unknown statuses", () => {
    expect(runPillStatus("drift_detected")).toBe("drift");
    expect(runPillStatus("failed")).toBe("failed");
    expect(runPillStatus("something-new")).toBe("warning");
  });

  test("runSummary and formatDuration", () => {
    expect(runSummary({ source: "report", mode: null, records: 1, changes: null })).toBe("1 row");
    expect(runSummary({ source: "automation", mode: "audit", records: 40, changes: 3 })).toBe("40 checked · 3 planned");
    expect(runSummary({ source: "automation", mode: "enforce", records: 40, changes: null })).toBe("40 checked · 0 changed");
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(250)).toBe("250ms");
    expect(formatDuration(65_000)).toBe("1m 5s");
  });
});
