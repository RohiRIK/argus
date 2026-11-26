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
