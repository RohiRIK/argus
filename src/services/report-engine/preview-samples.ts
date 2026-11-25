import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getReport } from "@/services/reports/registry";
import { liveGraphTransport, type GraphTransport } from "@/services/graph/client";
import { vaultService } from "@/services/vault/vault";
import { ValidationError } from "@/lib/errors";
import type { ReportSummary } from "@/services/reports/types";
import type { RenderInput } from "./default-template";

interface FixturePayload {
  params?: Record<string, unknown>;
  rows?: unknown[];
  csvRows?: Record<string, string>[];
}

function loadFixtureTransport(reportId: string): {
  transport: GraphTransport;
  params: Record<string, unknown>;
  hasFixture: boolean;
} {
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
 * Defaults to each plugin's `fixtures.json` + `fetch()/summarize()` contract,
 * or fetches live telemetry from Microsoft Graph when `dataSource === "live"`.
 */
export async function buildSampleRenderInput(opts: {
  reportType?: string;
  organizationName: string;
  jobName?: string;
  executionId?: string;
  timezone?: string;
  dataSource?: "fixture" | "live";
}): Promise<{ input: RenderInput; pluginVars: string[]; dataMode: "fixture" | "live" }> {
  const executionId = opts.executionId ?? "preview-0000";
  const report = opts.reportType ? getReport(opts.reportType) : undefined;
  const dataMode = opts.dataSource ?? "fixture";

  if (!report) {
    return {
      dataMode: "fixture",
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
  if (dataMode === "live") {
    if (!vaultService.isConfigured()) {
      throw new ValidationError("Connect Microsoft 365 in Settings → Integrations before using Live tenant preview.");
    }
    const fetched = await Promise.race([
      report.fetch(liveGraphTransport, {}),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Live Graph preview timed out after 12s")), 12_000),
      ),
    ]);
    summary = report.summarize(fetched);
  } else {
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
  }

  const count = summary.count;
  const executiveSummary =
    dataMode === "live"
      ? `Live telemetry from ${opts.organizationName} — ${count} item(s) detected.`
      : opts.jobName
        ? `Sample run for "${opts.jobName}" (${report.name}) — ${count} item(s) summarized from fixture telemetry.`
        : `${report.description} Sample run reported ${count} item(s).`;

  return {
    dataMode,
    input: {
      reportName: report.name,
      organizationName: opts.organizationName,
      category: report.category,
      executionId,
      count,
      executiveSummary,
      trendPercent: dataMode === "live" ? 0 : count > 0 ? 15 : 0,
      trendDirection: dataMode === "live" ? "flat" : count > 0 ? "up" : "flat",
      isAnomaly: dataMode === "fixture" && count > 0,
      baselineMean: Math.max(1, Math.round(count * 0.7 * 10) / 10),
      addedCount: dataMode === "fixture" ? Math.min(1, summary.rows?.length ?? 0) : 0,
      isFirstRun: dataMode === "live",
      totalCount: count,
      timezone: opts.timezone,
      variables: summary.variables,
      rows: summary.rows,
    },
    pluginVars: Object.keys(summary.variables),
  };
}
