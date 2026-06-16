import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "argus-tpl-"));
process.env.ARGUS_DB_PATH = join(dir, "test.db");
process.env.ARGUS_MASTER_KEY = "0".repeat(64);

const { render } = await import("../src/services/report-engine/template");
const { renderReport, renderSubject, renderText } = await import("../src/services/report-engine/default-template");
const { seed } = await import("../src/db/seed");
const { templatesDao, templateVersionsDao } = await import("../src/db/dao/templates");
const { jobsDao } = await import("../src/db/dao/jobs");
const { runJob } = await import("../src/services/executor");
const previewRoute = await import("../src/app/api/templates/preview/route");
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
  test("creates a default template per report, idempotent", () => {
    const first = seed();
    expect(first.templates).toBe(26);
    expect(templatesDao.defaultFor("sign-in-anomalies")).toBeDefined();
    const second = seed();
    expect(second.templates).toBe(0); // idempotent
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
});
