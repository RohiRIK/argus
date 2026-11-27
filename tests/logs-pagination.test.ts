import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LogCursor } from "../src/db/dao/executions";

const dir = mkdtempSync(join(tmpdir(), "argus-logs-page-"));
process.env.ARGUS_DB_PATH = join(dir, "test.db");
process.env.ARGUS_MASTER_KEY = "0".repeat(64);

const { runMigrations } = await import("../src/db/migrate");
const { closeDb } = await import("../src/db/client");
const { jobsDao } = await import("../src/db/dao/jobs");
const { executionsDao, logsDao } = await import("../src/db/dao/executions");
const { GET } = await import("../src/app/api/logs/route");

const TOTAL = 37;
let execId = "";

beforeAll(() => {
  runMigrations();
  const job = jobsDao.create({ name: "Log pager", reportType: "sign-in-anomalies", scheduleType: "preset", schedulePreset: "daily" });
  execId = executionsDao.create({ jobId: job.id, status: "success", startedAt: new Date().toISOString() }).id;
  // Many rows share identical timestamps (bursts of 5) to exercise the id tie-breaker.
  const rows = Array.from({ length: TOTAL }, (_, i) => ({
    id: crypto.randomUUID(),
    executionId: execId,
    level: (i % 3 === 0 ? "error" : "info") as "error" | "info",
    message: `m${i}`,
    timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, Math.floor(i / 5))).toISOString(),
  }));
  logsDao.appendMany(rows);
});

afterAll(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

async function call(qs: string) {
  const res = await GET(new Request(`http://localhost/api/logs${qs}`));
  return { status: res.status, body: await res.json() };
}

describe("logsDao.page (H8)", () => {
  test("pages are stable, gap-free and duplicate-free across identical timestamps", () => {
    const all = logsDao.page({}, { limit: 500 }).rows;
    expect(all.length).toBe(TOTAL);

    const seen: string[] = [];
    let after: LogCursor | null = null;
    let pages = 0;
    for (;;) {
      const p = logsDao.page({}, { limit: 4, after });
      seen.push(...p.rows.map((r) => r.id));
      pages++;
      if (!p.hasMore) {
        expect(p.nextCursor).toBeNull();
        break;
      }
      after = p.nextCursor;
    }
    expect(pages).toBe(Math.ceil(TOTAL / 4));
    expect(new Set(seen).size).toBe(TOTAL);
    expect(seen).toEqual(all.map((r) => r.id));
  });

  test("ordering is newest first with id DESC as tie-breaker", () => {
    const rows = logsDao.page({}, { limit: 500 }).rows;
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1];
      const b = rows[i];
      expect(a.timestamp > b.timestamp || (a.timestamp === b.timestamp && a.id > b.id)).toBe(true);
    }
  });

  test("count is the real filtered total", () => {
    expect(logsDao.count({})).toBe(TOTAL);
    expect(logsDao.count({ level: "error" })).toBe(Math.ceil(TOTAL / 3));
  });

  test("legacy query() still returns newest-first filtered rows", () => {
    expect(logsDao.query({ level: "error" }).length).toBe(Math.ceil(TOTAL / 3));
  });
});

describe("GET /api/logs pagination (H8)", () => {
  test("default call is backward compatible: array data, total = real count", async () => {
    const { status, body } = await call("");
    expect(status).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBe(TOTAL);
    expect(body.meta.total).toBe(TOTAL);
    expect(body.meta.hasMore).toBe(false);
    expect(body.meta.nextCursor).toBeNull();
  });

  test("walks every page via nextCursor with a real total", async () => {
    const ids: string[] = [];
    let cursor: string | null = null;
    let last: { meta: { hasMore: boolean; total: number } } | null = null;
    do {
      const qs: string = `?limit=10${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const { body } = await call(qs);
      expect(body.meta.total).toBe(TOTAL);
      expect(body.data.length).toBeLessThanOrEqual(10);
      ids.push(...body.data.map((r: { id: string }) => r.id));
      cursor = body.meta.nextCursor;
      last = body;
    } while (cursor);
    expect(last?.meta.hasMore).toBe(false);
    expect(ids.length).toBe(TOTAL);
    expect(new Set(ids).size).toBe(TOTAL);
  });

  test("filters apply to both page and total", async () => {
    const { body } = await call("?level=error&limit=5");
    expect(body.meta.total).toBe(Math.ceil(TOTAL / 3));
    expect(body.data.length).toBe(5);
    expect(body.meta.hasMore).toBe(true);
    expect(body.data.every((r: { level: string }) => r.level === "error")).toBe(true);
  });

  test("limit is bounded", async () => {
    const { body } = await call("?limit=0");
    expect(body.data.length).toBe(1);
    const big = await call("?limit=100000");
    expect(big.body.meta.limit).toBe(500);
  });

  test("rejects a malformed cursor and an unknown level", async () => {
    expect((await call("?cursor=not-a-cursor")).status).toBe(400);
    expect((await call("?level=debug")).status).toBe(400);
  });
});

// Runs after the report-only suites above (describe-level beforeAll), so their totals stay report-only.
describe("GET /api/logs merges report and automation logs", () => {
  const AUTO = 23;
  let runId = "";
  const sameTs = new Date(Date.UTC(2026, 0, 1, 0, 0, 3)).toISOString(); // also used by report rows 15..19

  beforeAll(async () => {
    const { automationPoliciesDao, automationRunsDao } = await import("../src/db/dao/automations");
    const { getDb } = await import("../src/db/client");
    const { automationLogs } = await import("../src/db/schema");
    const policy = automationPoliciesDao.create({ name: "Log pager policy", automationType: "stale-guest-cleanup" });
    runId = automationRunsDao.create({
      policyId: policy.id,
      mode: "audit",
      status: "drift_detected",
      startedAt: new Date().toISOString(),
    }).id;
    // Interleave with the report rows: several automation lines share timestamps with report lines.
    const rows = Array.from({ length: AUTO }, (_, i) => ({
      id: crypto.randomUUID(),
      runId,
      level: (i % 4 === 0 ? "warning" : "info") as "warning" | "info",
      message: `a${i}`,
      timestamp: i < 6 ? sameTs : new Date(Date.UTC(2026, 0, 1, 0, 0, Math.floor(i / 3))).toISOString(),
    }));
    getDb().insert(automationLogs).values(rows).run();
  });

  type Entry = {
    id: string;
    source: string;
    executionId: string | null;
    runId: string | null;
    timestamp: string;
    href: string | null;
    level: string;
  };

  async function walk(qs: string, pageSize: number) {
    const rows: Entry[] = [];
    const totals = new Set<number>();
    let cursor: string | null = null;
    do {
      const sep = qs ? "&" : "";
      const page: string = `?${qs}${sep}limit=${pageSize}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const { body } = await call(page);
      totals.add(body.meta.total);
      rows.push(...body.data);
      cursor = body.meta.nextCursor;
      if (!cursor) expect(body.meta.hasMore).toBe(false);
    } while (cursor);
    return { rows, totals };
  }

  test("source=all (default) returns both, tagged and linked, with the combined total", async () => {
    const { body } = await call("");
    expect(body.meta.total).toBe(TOTAL + AUTO);
    expect(body.data.length).toBe(TOTAL + AUTO);
    const auto: Entry[] = body.data.filter((r: Entry) => r.source === "automation");
    const rep: Entry[] = body.data.filter((r: Entry) => r.source === "report");
    expect(auto.length).toBe(AUTO);
    expect(rep.length).toBe(TOTAL);
    expect(auto.every((r) => r.runId === runId && r.executionId === null && r.href === `/automations/runs/${runId}`)).toBe(true);
    expect(rep.every((r) => r.executionId === execId && r.runId === null && r.href === `/executions/${execId}`)).toBe(true);
  });

  test("merged order is (timestamp DESC, id DESC) across sources", async () => {
    const rows: Entry[] = (await call("")).body.data;
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1];
      const b = rows[i];
      expect(a.timestamp > b.timestamp || (a.timestamp === b.timestamp && a.id > b.id)).toBe(true);
    }
    // Both sources really do collide on at least one timestamp.
    const atSame = rows.filter((r) => r.timestamp === sameTs);
    expect(new Set(atSame.map((r) => r.source)).size).toBe(2);
  });

  test("small pages across identical timestamps from both sources: no gaps, no duplicates", async () => {
    const full: Entry[] = (await call("")).body.data;
    for (const size of [1, 3, 7]) {
      const { rows, totals } = await walk("", size);
      expect([...totals]).toEqual([TOTAL + AUTO]);
      expect(rows.map((r) => r.id)).toEqual(full.map((r) => r.id));
    }
  });

  test("source filter narrows rows and total", async () => {
    const rep = await walk("source=report", 10);
    expect([...rep.totals]).toEqual([TOTAL]);
    expect(rep.rows.length).toBe(TOTAL);
    expect(rep.rows.every((r) => r.source === "report")).toBe(true);

    const auto = await walk("source=automation", 10);
    expect([...auto.totals]).toEqual([AUTO]);
    expect(auto.rows.length).toBe(AUTO);
    expect(auto.rows.every((r) => r.source === "automation")).toBe(true);
  });

  test("level filter combines with source", async () => {
    const warn = await walk("level=warning", 4);
    expect([...warn.totals]).toEqual([Math.ceil(AUTO / 4)]);
    expect(warn.rows.every((r) => r.level === "warning" && r.source === "automation")).toBe(true);
    const errAuto = await walk("source=automation&level=error", 4);
    expect([...errAuto.totals]).toEqual([0]);
    expect(errAuto.rows.length).toBe(0);
    const errAll = await walk("level=error", 4);
    expect([...errAll.totals]).toEqual([Math.ceil(TOTAL / 3)]);
  });

  test("executionId / runId narrow to that execution or run", async () => {
    const byExec = await call(`?executionId=${execId}`);
    expect(byExec.body.meta.total).toBe(TOTAL);
    expect(byExec.body.data.every((r: Entry) => r.source === "report")).toBe(true);
    const byRun = await call(`?runId=${runId}`);
    expect(byRun.body.meta.total).toBe(AUTO);
    expect(byRun.body.data.every((r: Entry) => r.source === "automation")).toBe(true);
  });

  test("rejects an unknown source", async () => {
    expect((await call("?source=jobs")).status).toBe(400);
  });
});
