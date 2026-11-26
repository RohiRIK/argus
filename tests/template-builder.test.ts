import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { VisualPresetId } from "../src/services/report-engine/template-builder";

const dir = mkdtempSync(join(tmpdir(), "argus-tb-"));
process.env.ARGUS_DB_PATH = join(dir, "test.db");
process.env.ARGUS_MASTER_KEY = "0".repeat(64);

const { renderReport } = await import("../src/services/report-engine/default-template");
const {
  VISUAL_PRESETS,
  compileVisualTemplate,
  parseVisualConfig,
  formatHtmlSource,
} = await import("../src/services/report-engine/template-builder");
const previewRoute = await import("../src/app/api/templates/preview/route");
const { runMigrations } = await import("../src/db/migrate");
const { closeDb } = await import("../src/db/client");

beforeAll(() => runMigrations());
afterAll(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

describe("Visual Template Studio & Table Formatting", () => {
  test("compiles and round-trips all 4 presets cleanly with zero token leaks", () => {
    const sample = {
      reportName: "Daily Sign-in Anomalies",
      organizationName: "Rohi Lab",
      category: "identity",
      executionId: "exec-1",
      count: 2,
      executiveSummary: "2 anomalies detected.",
      trendPercent: 15,
      trendDirection: "up" as const,
      isAnomaly: true,
      baselineMean: 1.0,
      variables: {},
      rows: [
        {
          user: "alice@rohi-lab.org",
          app: "Microsoft 365 Portal",
          status: "Failed",
          attempts: 1,
          date: "2026-11-24",
          ip: "203.0.113.1",
          country: "US",
          reason: "Wrong username or password",
        },
      ],
    };

    for (const [id, preset] of Object.entries(VISUAL_PRESETS)) {
      const compiled = compileVisualTemplate(preset.config);
      const parsed = parseVisualConfig(compiled);
      expect(parsed).not.toBeNull();
      expect(parsed?.preset).toBe(id as VisualPresetId);

      const rendered = renderReport(sample, compiled);
      expect(rendered).toContain("<!DOCTYPE html>");
      expect(rendered).toContain("Rohi Lab");
      expect(rendered).toContain("white-space:nowrap");
      expect(rendered).not.toContain("overflow-wrap:anywhere");
      expect(rendered).not.toMatch(/\{\{[^}]+\}\}/);
    }
  });

  test("formatHtmlSource indents nested markup deterministically", () => {
    expect(formatHtmlSource("<div><p>hi</p></div>")).toBe("<div>\n  <p>hi</p>\n</div>");
  });

  test("POST /api/templates/preview returns sampleValues and clean table CSS", async () => {
    const res = await previewRoute.POST(
      new Request("http://t", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reportType: "sign-in-anomalies", mode: "html" }),
      }),
    );
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.sampleValues?.reportName).toBe("Daily Sign-in Anomalies");
    expect(body.data.html).toContain("white-space:nowrap");
    expect(body.data.html).not.toContain("overflow-wrap:anywhere");
  });
});
