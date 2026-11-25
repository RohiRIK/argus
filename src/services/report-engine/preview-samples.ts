import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getReport } from "@/services/reports/registry";
import type { GraphTransport } from "@/services/graph/client";
import type { ReportSummary } from "@/services/reports/types";
import type { RenderInput } from "./default-template";

interface FixturePayload {
  params?: Record<string, unknown>;
  rows?: unknown[];
  csvRows?: Record<string, string>[];
}

function loadFixtureTransport(reportId: string): { transport: GraphTransport; params: Record<string, unknown>; hasFixture: boolean } {
  const fixturePath = join(process.cwd(), "src", "plugins", "reports", reportId, "fixtures.json");
  if (!existsSync(fixturePath)) {
    return {
      hasFixture: false,
      params: {},
      transport: {
        async get<T = unknown>() {
          return { value: [] as T[], latencyMs: 1 };
        },
        async batch() {
          return [];
        },
        async getCsv() {
          return { headers: [], rows: [], latencyMs: 1 };
        },
      },
    };
  }
  const raw = JSON.parse(readFileSync(fixturePath, "utf8")) as FixturePayload;
  return {
    hasFixture: true,
    params: raw.params ?? {},
    transport: {
      async get<T = unknown>() {
        return { value: (raw.rows ?? []) as T[], latencyMs: 1 };
      },
      async batch() {
        return [];
      },
      async getCsv() {
        const csvRows = (raw.csvRows ?? raw.rows ?? []) as Record<string, string>[];
        return { headers: Object.keys(csvRows[0] ?? {}), rows: csvRows, latencyMs: 1 };
      },
    },
  };
}

/**
 * Generate a faithful sample RenderInput for preview or test-send.
 * Uses the plugin's own fixture + fetch/summarize contract when `reportType`
 * matches an installed report plugin so every report renders accurate columns
 * and real report-specific {{variables}}.
 */
export async function buildSampleRenderInput(opts: {
  reportType?: string;
  organizationName: string;
  jobName?: string;
  executionId?: string;
  timezone?: string;
}): Promise<{ input: RenderInput; pluginVars: string[] }> {
  const executionId = opts.executionId ?? "preview-0000";
  const report = opts.reportType ? getReport(opts.reportType) : undefined;

  if (!report) {
    return {
      input: {
        reportName: opts.reportType || "Daily Sign-in Anomalies",
        organizationName: opts.organizationName,
        executionId,
        count: 14,
        executiveSummary: opts.jobName
          ? `Sample run for "${opts.jobName}" — 14 item(s), up 40% on the previous run.`
          : "14 failed sign-ins detected — up 40% on the previous run.",
        trendPercent: 40,
        trendDirection: "up",
        isAnomaly: true,
        baselineMean: 8.5,
        addedCount: 2,
        totalCount: 14,
        timezone: opts.timezone,
        variables: {
          totalSignIns: 1280,
          failedSignIns: 14,
          legacyAuthSignIns: 3,
          distinctCountries: 5,
          topRiskUsers: "alice@contoso.com, bob@contoso.com",
        },
        rows: [
          { user: "alice@contoso.com", ip: "203.0.113.7", reason: "Invalid credentials", country: "DE" },
          { user: "bob@contoso.com", ip: "198.51.100.2", reason: "MFA required", country: "US" },
        ],
      },
      pluginVars: ["totalSignIns", "failedSignIns", "legacyAuthSignIns", "distinctCountries", "topRiskUsers"],
    };
  }

  let summary: ReportSummary;
  const { transport, params, hasFixture } = loadFixtureTransport(report.id);
  if (hasFixture) {
    try {
      const rows = await report.fetch(transport, params);
      summary = report.summarize(rows);
    } catch {
      summary = report.summarize([]);
    }
  } else {
    summary = report.summarize([]);
  }

  const count = summary.count;
  const executiveSummary = opts.jobName
    ? `Sample run for "${opts.jobName}" (${report.name}) — ${count} item(s) summarized from fixture telemetry.`
    : `${report.description} Sample run reported ${count} item(s).`;

  return {
    input: {
      reportName: report.name,
      organizationName: opts.organizationName,
      category: report.category,
      executionId,
      count,
      executiveSummary,
      trendPercent: count > 0 ? 15 : 0,
      trendDirection: count > 0 ? "up" : "flat",
      isAnomaly: count > 0,
      baselineMean: Math.max(1, Math.round(count * 0.7 * 10) / 10),
      addedCount: Math.min(1, summary.rows?.length ?? 0),
      totalCount: count,
      timezone: opts.timezone,
      variables: summary.variables,
      rows: summary.rows,
    },
    pluginVars: Object.keys(summary.variables),
  };
}
