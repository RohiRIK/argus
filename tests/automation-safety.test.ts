import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "argus-autosafe-"));
process.env.ARGUS_DB_PATH = join(dir, "test.db");
process.env.ARGUS_MASTER_KEY = "0".repeat(64);

const { runMigrations } = await import("../src/db/migrate");
const { closeDb } = await import("../src/db/client");
const { seed } = await import("../src/db/seed");
const { automationPoliciesDao, automationRunsDao } = await import("../src/db/dao/automations");
const { auditDao } = await import("../src/db/dao/audit");
const { templatesDao } = await import("../src/db/dao/templates");
const { listAutomations } = await import("../src/services/automations/registry");
const { renderAutomationRunHtml } = await import("../src/services/automations/helpers");
const { AUTOMATION_TEMPLATE_TYPE } = await import("../src/services/report-engine/automation-template");
const createRoute = await import("../src/app/api/automations/route");
const policyRoute = await import("../src/app/api/automations/[id]/route");
const runRoute = await import("../src/app/api/automations/[id]/run/route");

beforeAll(() => {
  runMigrations();
  seed();
});
afterAll(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

const def = listAutomations()[0]!;
const req = (method: string, body: unknown, user = "alice") =>
  new Request("http://x", {
    method,
    headers: { "content-type": "application/json", "x-argus-user": user },
    body: JSON.stringify(body),
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

function makePolicy(mode: "audit" | "enforce" = "audit") {
  return automationPoliciesDao.create({
    name: "Safety test",
    automationType: def.id,
    mode,
    params: {},
    scheduleType: "manual",
    status: "active",
  });
}

function addRun(policyId: string, mode: "audit" | "enforce", status: "success" | "drift_detected" | "failed", startedAt: string) {
  return automationRunsDao.create({ policyId, mode, trigger: "manual", status, startedAt, endedAt: startedAt });
}

describe("new automations start in audit mode", () => {
  test("creating a policy directly in enforce is refused", async () => {
    const res = await createRoute.POST(
      req("POST", { name: "x", automationType: def.id, mode: "enforce", scheduleType: "manual" }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(/start in audit mode/);
  });

  test("packs cannot be deployed in enforce", async () => {
    const res = await createRoute.POST(req("POST", { packId: "secops-response", mode: "enforce" }));
    expect(res.status).toBe(400);
  });
});

describe("switching to enforce", () => {
  test("needs a finished audit run of the current settings", async () => {
    const p = makePolicy();
    const res = await policyRoute.PUT(req("PUT", { mode: "enforce", confirmEnforce: true }), ctx(p.id));
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(/audit mode first/);
  });

  test("a failed audit, or one from before the last change, does not count", async () => {
    const p = makePolicy();
    addRun(p.id, "audit", "failed", new Date(Date.now() + 1000).toISOString());
    addRun(p.id, "audit", "success", "2000-01-01T00:00:00.000Z");
    const res = await policyRoute.PUT(req("PUT", { mode: "enforce", confirmEnforce: true }), ctx(p.id));
    expect(res.status).toBe(400);
  });

  test("after an audit it still needs explicit confirmation; then it is audited with the user", async () => {
    const p = makePolicy();
    addRun(p.id, "audit", "drift_detected", new Date(Date.now() + 1000).toISOString());
    const unconfirmed = await policyRoute.PUT(req("PUT", { mode: "enforce" }), ctx(p.id));
    expect(unconfirmed.status).toBe(400);
    expect((await unconfirmed.json()).error.fields.confirmEnforce).toBeDefined();

    const ok = await policyRoute.PUT(req("PUT", { mode: "enforce", confirmEnforce: true }, "bob"), ctx(p.id));
    expect(ok.status).toBe(200);
    expect(automationPoliciesDao.findById(p.id)!.mode).toBe("enforce");
    const entry = auditDao.list().find((a) => a.action === "automation.enforce_enabled");
    expect(entry?.detail).toMatchObject({ policyId: p.id, actor: "bob" });
  });

  test("changing params of an enforcing policy puts it back into audit mode", async () => {
    const p = makePolicy("enforce");
    const res = await policyRoute.PUT(req("PUT", { params: { changed: true } }), ctx(p.id));
    const body = await res.json();
    expect(body.data.mode).toBe("audit");
    expect(body.data.notice).toMatch(/back in audit mode/);
  });

  test("a one-off enforce run of an audit policy needs the same review", async () => {
    const p = makePolicy();
    const res = await runRoute.POST(req("POST", { mode: "enforce" }), ctx(p.id));
    expect(res.status).toBe(400);
  });
});

describe("automation emails use the template system", () => {
  test("seed creates a managed automation template", () => {
    const t = templatesDao.sharedDefault("en", AUTOMATION_TEMPLATE_TYPE)!;
    expect(t.managed).toBe(true);
    expect(t.htmlBody).toContain("{{actionsTable}}");
  });

  test("rendering uses the operator's template and escapes values", () => {
    const out = renderAutomationRunHtml(
      {
        organizationName: "Contoso <b>",
        policyName: "Guests",
        definition: def,
        run: {
          id: "r1",
          mode: "audit",
          status: "drift_detected",
          startedAt: "2026-01-01T00:00:00.000Z",
          evaluatedCount: 10,
          plannedCount: 2,
          appliedCount: 0,
          failedCount: 0,
          summaryText: "2 stale guests",
        },
        actions: [
          { targetType: "user", targetLabel: "g@x.com", actionType: "disable", status: "planned", reason: "stale", errorMessage: null },
        ],
      },
      { subject: "Custom {{policyName}} {{outcomeLabel}}", htmlBody: "<p>{{organization_name}}</p>{{actionsTable}}", textBody: null },
    );
    expect(out.subject).toBe("Custom Guests 2 drift item(s)");
    expect(out.html).toContain("Contoso &lt;b&gt;");
    expect(out.html).toContain("g@x.com");
    expect(out.text).toContain("[PLANNED] g@x.com");
  });
});

describe("restart safety for automations", () => {
  test("open runs from before the restart become interrupted and are never re-run", async () => {
    const { reconcileInterruptedRuns } = await import("../src/services/scheduler");
    const p = makePolicy("enforce");
    const stuck = automationRunsDao.create({ policyId: p.id, mode: "enforce", trigger: "schedule", status: "warning", startedAt: "2020-01-01T00:00:00.000Z" });
    const current = automationRunsDao.create({ policyId: p.id, mode: "audit", trigger: "manual", status: "warning", startedAt: new Date(Date.now() + 60_000).toISOString() });
    expect(reconcileInterruptedRuns()).toBeGreaterThanOrEqual(1);
    const after = automationRunsDao.findById(stuck.id)!;
    expect(after.status).toBe("interrupted");
    expect(after.errorMessage).toMatch(/review its actions/);
    expect(automationRunsDao.findById(current.id)!.endedAt).toBeNull();
    expect(auditDao.list().some((a) => a.action === "automation.run_interrupted")).toBe(true);
  });
});
