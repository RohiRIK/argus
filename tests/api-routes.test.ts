import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "argus-r2-"));
process.env.ARGUS_DB_PATH = join(dir, "test.db");
process.env.ARGUS_MASTER_KEY = "0".repeat(64);

const logsRoute = await import("../src/app/api/logs/route");
const templatesRoute = await import("../src/app/api/templates/route");
const previewRoute = await import("../src/app/api/jobs/[id]/schedule-preview/route");
const baselineRoute = await import("../src/app/api/baselines/[jobId]/route");
const execPreview = await import("../src/app/api/executions/[id]/preview/route");
const webhooksRoute = await import("../src/app/api/integrations/[provider]/webhooks/route");
const { jobsDao } = await import("../src/db/dao/jobs");
const { executionsDao, logsDao } = await import("../src/db/dao/executions");
const { baselinesDao } = await import("../src/db/dao/baselines");
const { runMigrations } = await import("../src/db/migrate");
const { closeDb } = await import("../src/db/client");

let jobId = "";
let execId = "";

beforeAll(() => {
  runMigrations();
  const job = jobsDao.create({ name: "r", reportType: "sign-in-anomalies", scheduleType: "preset", schedulePreset: "daily" });
  jobId = job.id;
  const exec = executionsDao.create({ jobId, status: "success", startedAt: new Date().toISOString(), outputHtml: "<h1>Report</h1>" });
  execId = exec.id;
  logsDao.append(execId, "info", "hello");
  baselinesDao.record(jobId, "count", 4);
});
afterAll(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

const post = (url: string, body: unknown) =>
  new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("GET /api/logs filters by execution", async () => {
  const body = await (await logsRoute.GET(new Request(`http://t/api/logs?executionId=${execId}`))).json();
  expect(body.success).toBe(true);
  expect(body.data.length).toBeGreaterThan(0);
});

test("templates POST then GET", async () => {
  const created = await (
    await templatesRoute.POST(post("http://t/api/templates", { name: "T", subject: "S", htmlBody: "<p>{{count}}</p>" }))
  ).json();
  expect(created.success).toBe(true);
  const list = await (await templatesRoute.GET()).json();
  expect(list.data.length).toBe(1);
});

test("schedule-preview returns next runs", async () => {
  const body = await (await previewRoute.GET(new Request("http://t"), { params: { id: jobId } })).json();
  expect(body.success).toBe(true);
  expect(body.data.nextRuns.length).toBe(5);
});

test("baselines route returns stats", async () => {
  const body = await (await baselineRoute.GET(new Request("http://t"), { params: { jobId } })).json();
  expect(body.success).toBe(true);
  expect(body.data.metric).toBe("count");
});

test("execution preview returns HTML", async () => {
  const res = await execPreview.GET(new Request("http://t"), { params: { id: execId } });
  expect(res.headers.get("content-type")).toContain("text/html");
  expect(await res.text()).toContain("Report");
});

test("webhooks route create + list", async () => {
  const created = await (
    await webhooksRoute.POST(post("http://t", { name: "wh", url: "https://example.com/h" }), { params: { provider: "m365" } })
  ).json();
  expect(created.success).toBe(true);
  const list = await (await webhooksRoute.GET(new Request("http://t"), { params: { provider: "m365" } })).json();
  expect(list.data.length).toBe(1);
});
