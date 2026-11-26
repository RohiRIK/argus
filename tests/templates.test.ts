import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "argus-tpl-"));
process.env.ARGUS_DB_PATH = join(dir, "test.db");
process.env.ARGUS_MASTER_KEY = "0".repeat(64);

const { render } = await import("../src/services/report-engine/template");
const { renderReport, renderSubject, renderText, DEFAULT_SUBJECT, DEFAULT_TEMPLATE_HTML, LEGACY_TEMPLATE_HTML } =
  await import("../src/services/report-engine/default-template");
const { seed } = await import("../src/db/seed");
const { templatesDao, templateVersionsDao } = await import("../src/db/dao/templates");
const { jobsDao } = await import("../src/db/dao/jobs");
const { runJob } = await import("../src/services/executor");
const previewRoute = await import("../src/app/api/templates/preview/route");
const templateDetailRoute = await import("../src/app/api/templates/[id]/route");
const templateResetRoute = await import("../src/app/api/templates/[id]/reset/route");
const { listReports } = await import("../src/services/reports/registry");
const { resolveOrganizationName } = await import("../src/lib/org-name");
const { runMigrations } = await import("../src/db/migrate");
const { closeDb } = await import("../src/db/client");
import type { GraphTransport } from "../src/services/graph/client";

beforeAll(() => runMigrations());
afterAll(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

const tx = (rows: unknown[]): GraphTransport => ({ get: async () => ({ value: rows as never[], latencyMs: 1 }) });

const sampleInput = {
  reportName: "R",
  organizationName: "Contoso",
  executionId: "e1",
  count: 3,
  executiveSummary: "summary",
  trendPercent: 10,
  trendDirection: "up" as const,
  isAnomaly: true,
  baselineMean: 1,
  variables: {},
  rows: [{ user: "a@x" }],
};

describe("render", () => {
  test("escapes vars but injects raw fragments verbatim", () => {
    const out = render("{{name}}|{{block}}", { name: "<b>x</b>" }, { block: "<hr/>" });
    expect(out).toBe("&lt;b&gt;x&lt;/b&gt;|<hr/>");
  });
});

describe("renderReport", () => {
  test("injects organization_name into custom template", () => {
    const html = renderReport(sampleInput, "<p>{{organization_name}} — {{count}}</p>");
    expect(html).toContain("<p>Contoso — 3</p>");
    expect(html).toContain("questionable life choices"); // signature tagline under every report
  });
  test("default template includes anomaly banner + details table", () => {
    const html = renderReport(sampleInput);
    expect(html).toContain("Anomaly detected");
    expect(html).toContain("a@x");
  });
  test("renderSubject substitutes tokens", () => {
    expect(renderSubject(sampleInput, "{{reportName}} @ {{organization_name}}")).toBe("R @ Contoso");
  });
  test("renderText substitutes WITHOUT html-escaping", () => {
    const out = renderText(sampleInput, "Org: {{organization_name}} | Count: {{count}} | {{reportName}}");
    expect(out).toContain("Org: Contoso | Count: 3 | R");
  });
});

describe("preview route mode", () => {
  test("mode=text returns plain text, no HTML", async () => {
    const res = await previewRoute.POST(
      new Request("http://t", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "text", textBody: "{{organization_name}} :: {{count}}", organizationName: "Globex" }),
      }),
    );
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.mode).toBe("text");
    expect(body.data.text).toContain("Globex :: 14");
  });
});

describe("seed", () => {
  test("retires per-report seeded copies and creates one shared default, idempotent", () => {
    // Legacy DB state: an untouched seeded per-report default referenced by a job,
    // and a user-edited per-report default.
    const untouched = templatesDao.create({
      name: "Risky Users — Default",
      reportType: "risky-users",
      subject: DEFAULT_SUBJECT,
      htmlBody: LEGACY_TEMPLATE_HTML,
      isDefault: true,
      language: "en",
    });
    const edited = templatesDao.create({
      name: "Sign-ins — Default",
      reportType: "sign-in-anomalies",
      subject: DEFAULT_SUBJECT,
      htmlBody: "<p>my edits {{count}}</p>",
      isDefault: true,
      language: "en",
    });
    const pinned = jobsDao.create({
      name: "pinned",
      reportType: "risky-users",
      scheduleType: "preset",
      schedulePreset: "daily",
      templateId: untouched.id,
      conditionalRules: { mode: "always" },
    });

    const first = seed();
    // The shared report default + the shared automation-run default.
    expect(first.templates).toBe(2);
    const all = templatesDao.findAll();
    expect(all.filter((t) => t.isDefault).map((t) => t.reportType).sort()).toEqual(["*", "automation:*"]);
    expect(templatesDao.sharedDefault()?.reportType).toBe("*");
    expect(templatesDao.sharedDefault()?.htmlBody).toBe(DEFAULT_TEMPLATE_HTML);
    // Untouched copy removed; its job falls back to the (identical) shared default.
    expect(templatesDao.findById(untouched.id)).toBeUndefined();
    expect(jobsDao.findById(pinned.id)?.templateId).toBeNull();
    // User-edited copy kept verbatim as a selectable custom template.
    const kept = templatesDao.findById(edited.id);
    expect(kept?.htmlBody).toBe("<p>my edits {{count}}</p>");
    expect(kept?.isDefault).toBe(false);

    const second = seed();
    expect(second.templates).toBe(0); // idempotent
    expect(templatesDao.findAll()).toHaveLength(all.length);
  });

  test("every report resolves to the shared default when the job has no templateId", () => {
    const shared = templatesDao.sharedDefault()!;
    for (const report of listReports()) {
      const job = jobsDao.create({
        name: `fallback-${report.id}`,
        reportType: report.id,
        scheduleType: "preset",
        schedulePreset: "daily",
        templateId: null,
        conditionalRules: { mode: "always" },
      });
      expect(templatesDao.resolve(job.templateId)?.id).toBe(shared.id);
    }
    expect(templatesDao.resolve("missing-id")?.id).toBe(shared.id);
  });
});

describe("executor uses resolved template", () => {
  test("job.templateId template drives the output", async () => {
    const tpl = templatesDao.create({
      name: "Custom",
      reportType: "sign-in-anomalies",
      subject: "S",
      htmlBody: "<custom>{{organization_name}} count={{count}}</custom>",
      isDefault: false,
      language: "en",
    });
    const job = jobsDao.create({
      name: "j",
      reportType: "sign-in-anomalies",
      scheduleType: "preset",
      schedulePreset: "daily",
      templateId: tpl.id,
      conditionalRules: { mode: "always" },
    });
    const exec = await runJob(job, {
      transport: tx([{ id: "1", userPrincipalName: "u@x", status: { errorCode: 1 } }]),
      canSendEmail: false,
      tenantName: "AcmeOrg",
    });
    expect(exec.outputHtml).toContain("<custom>AcmeOrg count=1</custom>");
  });
});

describe("template version history (F5)", () => {
  test("each save snapshots the prior content; revert restores it", () => {
    const t = templatesDao.create({
      name: "Versioned",
      reportType: "sign-in-anomalies",
      subject: "v1-subject",
      htmlBody: "<p>v1</p>",
      isDefault: false,
      language: "en",
    });
    expect(templateVersionsDao.list(t.id)).toHaveLength(0);

    // First save snapshots v1 (the pre-update state).
    templatesDao.update(t.id, { subject: "v2-subject", htmlBody: "<p>v2</p>" });
    let versions = templateVersionsDao.list(t.id);
    expect(versions).toHaveLength(1);
    expect(versions[0].version).toBe(1);
    expect(versions[0].htmlBody).toBe("<p>v1</p>");

    // Second save snapshots v2; newest-first ordering.
    templatesDao.update(t.id, { subject: "v3-subject", htmlBody: "<p>v3</p>" });
    versions = templateVersionsDao.list(t.id);
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    expect(versions[0].htmlBody).toBe("<p>v2</p>");

    // Revert to v1: live content becomes v1, and the pre-revert (v3) is snapshotted as v3.
    const v1 = versions.find((v) => v.version === 1)!;
    const reverted = templatesDao.update(t.id, { subject: v1.subject, htmlBody: v1.htmlBody });
    expect(reverted?.htmlBody).toBe("<p>v1</p>");
    expect(templateVersionsDao.list(t.id).map((v) => v.version)).toEqual([3, 2, 1]);
  });
});

describe("preview route", () => {
  test("renders sample data", async () => {
    const res = await previewRoute.POST(
      new Request("http://t", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ htmlBody: "<p>{{organization_name}}: {{count}}</p>", organizationName: "Globex" }),
      }),
    );
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.html).toContain("Globex: 14");
  });

  test("uses plugin fixture variables and renders all 26 reports without raw token leaks", async () => {
    const ssRes = await previewRoute.POST(
      new Request("http://t", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reportType: "secure-score",
          organizationName: "Rohi Lab",
          htmlBody: "<p>{{organization_name}} score={{currentScore}}/{{maxScore}}</p>",
        }),
      }),
    );
    const ssBody = await ssRes.json();
    expect(ssBody.success).toBe(true);
    expect(ssBody.data.availableVars).toContain("currentScore");
    expect(ssBody.data.html).toContain("Rohi Lab score=");
    expect(ssBody.data.html).not.toMatch(/\{\{[^}]+\}\}/);

    for (const report of listReports()) {
      const rHtml = await previewRoute.POST(
        new Request("http://t", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reportType: report.id, mode: "html" }),
        }),
      );
      const bHtml = await rHtml.json();
      expect(bHtml.success).toBe(true);
      expect(bHtml.data.html).toContain("<!DOCTYPE html>");
      expect(bHtml.data.html).not.toMatch(/\{\{[^}]+\}\}/);
      expect(bHtml.data.subject).not.toMatch(/\{\{[^}]+\}\}/);

      const rText = await previewRoute.POST(
        new Request("http://t", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reportType: report.id, mode: "text" }),
        }),
      );
      const bText = await rText.json();
      expect(bText.success).toBe(true);
      expect(bText.data.text).not.toMatch(/\{\{[^}]+\}\}/);
    }
  });
});

describe("hardening: prototype safety, delete FK detach, reset, org name", () => {
  test("render and renderText ignore Object.prototype keys", () => {
    const html = render("{{constructor}}|{{toString}}|{{ok}}", { ok: "yes" });
    expect(html).toBe("||yes");
    const txt = renderText(sampleInput, "{{constructor}}|{{toString}}|{{reportName}}");
    expect(txt).toContain("||R");
  });

  test("DELETE /api/templates/:id detaches referencing jobs instead of throwing FK 500", async () => {
    const tpl = templatesDao.create({
      name: "Detachable Custom",
      reportType: "risky-users",
      subject: "S",
      htmlBody: "<p>custom</p>",
      isDefault: false,
      language: "en",
    });
    const job = jobsDao.create({
      name: "Detach Job",
      reportType: "risky-users",
      scheduleType: "preset",
      schedulePreset: "daily",
      templateId: tpl.id,
      conditionalRules: { mode: "always" },
    });
    const res = await templateDetailRoute.DELETE(new Request("http://t", { method: "DELETE" }), {
      params: Promise.resolve({ id: tpl.id }),
    });
    expect(res.status).toBe(200);
    expect(templatesDao.findById(tpl.id)).toBeUndefined();
    expect(jobsDao.findById(job.id)?.templateId).toBeNull();
  });

  test("POST /api/templates/:id/reset restores built-in defaults and snapshots history", async () => {
    const def = templatesDao.sharedDefault()!;
    templatesDao.update(def.id, { subject: "Custom Override", htmlBody: "<p>override</p>" });
    const res = await templateResetRoute.POST(new Request("http://t", { method: "POST" }), {
      params: Promise.resolve({ id: def.id }),
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.htmlBody).toContain("{{detailsTable}}");
    expect(templateVersionsDao.list(def.id)[0]?.htmlBody).toBe("<p>override</p>");
  });

  test("resolveOrganizationName prioritizes override, skips GUIDs when domain present", () => {
    expect(
      resolveOrganizationName({
        settingsOrgName: "Rohi Lab",
        tenantDisplayName: "Contoso",
        primaryDomain: "rohi-lab.org",
      }),
    ).toBe("Rohi Lab");
    expect(
      resolveOrganizationName({
        tenantDisplayName: "12345678-1234-1234-1234-1234567890ab",
        primaryDomain: "rohi-lab.org",
      }),
    ).toBe("rohi-lab.org");
  });
});
