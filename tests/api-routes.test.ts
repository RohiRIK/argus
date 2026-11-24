import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "argus-r2-"));
process.env.ARGUS_DB_PATH = join(dir, "test.db");
process.env.ARGUS_MASTER_KEY = "0".repeat(64);

const logsRoute = await import("../src/app/api/logs/route");
const templatesRoute = await import("../src/app/api/templates/route");
const templateItemRoute = await import("../src/app/api/templates/[id]/route");
const starterPackRoute = await import("../src/app/api/onboarding/starter-pack/route");
const certRoute = await import("../src/app/api/integrations/[provider]/cert/route");
const auditRoute = await import("../src/app/api/integrations/[provider]/audit/route");
const previewRoute = await import("../src/app/api/jobs/[id]/schedule-preview/route");
const baselineRoute = await import("../src/app/api/baselines/[jobId]/route");
const execPreview = await import("../src/app/api/executions/[id]/preview/route");
const webhooksRoute = await import("../src/app/api/integrations/[provider]/webhooks/route");
const healthRoute = await import("../src/app/api/health/route");
const { jobsDao } = await import("../src/db/dao/jobs");
const { templatesDao } = await import("../src/db/dao/templates");
const { auditDao } = await import("../src/db/dao/audit");
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
  const body = await (await previewRoute.GET(new Request("http://t"), { params: Promise.resolve({ id: jobId }) })).json();
  expect(body.success).toBe(true);
  expect(body.data.nextRuns.length).toBe(5);
});

test("baselines route returns stats", async () => {
  const body = await (await baselineRoute.GET(new Request("http://t"), { params: Promise.resolve({ jobId }) })).json();
  expect(body.success).toBe(true);
  expect(body.data.metric).toBe("count");
});

test("execution preview returns HTML", async () => {
  const res = await execPreview.GET(new Request("http://t"), { params: Promise.resolve({ id: execId }) });
  expect(res.headers.get("content-type")).toContain("text/html");
  expect(await res.text()).toContain("Report");
});

test("webhooks route create + list", async () => {
  const created = await (
    await webhooksRoute.POST(post("http://t", { name: "wh", url: "https://example.com/h" }), { params: Promise.resolve({ provider: "m365" }) })
  ).json();
  expect(created.success).toBe(true);
  const list = await (await webhooksRoute.GET(new Request("http://t"), { params: Promise.resolve({ provider: "m365" }) })).json();
  expect(list.data.length).toBe(1);
});

test("DELETE /api/templates/:id deletes custom and blocks default", async () => {
  const def = templatesDao.create({
    name: "Def",
    reportType: "risky-users",
    subject: "S",
    htmlBody: "<p>D</p>",
    isDefault: true,
    language: "en",
  });
  const custom = templatesDao.create({
    name: "Custom",
    reportType: "risky-users",
    subject: "S",
    htmlBody: "<p>C</p>",
    isDefault: false,
    language: "en",
  });
  const blockRes = await templateItemRoute.DELETE(new Request("http://t"), { params: Promise.resolve({ id: def.id }) });
  expect(blockRes.status).toBe(400);

  const delRes = await templateItemRoute.DELETE(new Request("http://t"), { params: Promise.resolve({ id: custom.id }) });
  expect(delRes.status).toBe(200);
  expect(templatesDao.findById(custom.id)).toBeUndefined();
});

test("POST /api/onboarding/starter-pack is idempotent", async () => {
  const first = await (await starterPackRoute.POST()).json();
  expect(first.success).toBe(true);
  expect(first.data.createdCount).toBe(4);

  const second = await (await starterPackRoute.POST()).json();
  expect(second.data.createdCount).toBe(0);
  expect(second.data.skippedCount).toBe(4);
});

test("cert route generates & serves .cer and audit excludes maintenance_window entries", async () => {
  const gen = await (await certRoute.POST(new Request("http://t/api/integrations/microsoft365/cert"), { params: Promise.resolve({ provider: "microsoft365" }) })).json();
  expect(gen.success).toBe(true);
  expect(gen.data.present).toBe(true);
  expect(gen.data.scripts.azCli).toContain("az ad app");

  const dl = await certRoute.GET(new Request("http://t/api/integrations/microsoft365/cert?download=1"), { params: Promise.resolve({ provider: "microsoft365" }) });
  expect(dl.status).toBe(200);
  expect(await dl.text()).toContain("BEGIN CERTIFICATE");

  auditDao.record({ action: "maintenance_window.create", outcome: "success", detail: {} });
  auditDao.record({ action: "admin_authorize", provider: "microsoft365", outcome: "success", detail: {} });
  const auditBody = await (await auditRoute.GET(new Request("http://t"), { params: Promise.resolve({ provider: "microsoft365" }) })).json();
  expect(auditBody.data.some((a: { action: string }) => a.action === "admin_authorize")).toBe(true);
  expect(auditBody.data.some((a: { action: string }) => a.action === "maintenance_window.create")).toBe(false);
});

test("GET /api/health returns ARGUS_ENV defaulting to production and reflects overrides", async () => {
  const prev = process.env.ARGUS_ENV;
  try {
    delete process.env.ARGUS_ENV;
    const defBody = await (await healthRoute.GET()).json();
    expect(defBody.success).toBe(true);
    expect(defBody.data.env).toBe("production");

    process.env.ARGUS_ENV = "dev";
    const devBody = await (await healthRoute.GET()).json();
    expect(devBody.success).toBe(true);
    expect(devBody.data.env).toBe("dev");
  } finally {
    if (prev === undefined) delete process.env.ARGUS_ENV;
    else process.env.ARGUS_ENV = prev;
  }
});
