import { render, escapeHtml, type TemplateVars } from "./template";

/**
 * Default report email (PRD §11 anti-slop structure): executive summary, key
 * metrics, optional anomaly banner, details table. Inline CSS for Outlook.
 */
const DEFAULT_TEMPLATE = `
<div style="font-family:Segoe UI,Arial,sans-serif;max-width:680px;margin:0 auto;color:#1a202c">
  <h1 style="font-size:20px;margin:0 0 4px">{{reportName}}</h1>
  <p style="color:#718096;font-size:13px;margin:0 0 16px">{{tenantName}} · {{timestamp}}</p>
  {{anomalyBanner}}
  <p style="font-size:14px;line-height:1.5">{{executiveSummary}}</p>
  <table role="presentation" style="width:100%;border-collapse:collapse;margin:16px 0">
    <tr>
      <td style="padding:12px;background:#f7fafc;border-radius:8px;text-align:center">
        <div style="font-size:28px;font-weight:700">{{count}}</div>
        <div style="font-size:12px;color:#718096">primary metric</div>
      </td>
      <td style="width:12px"></td>
      <td style="padding:12px;background:#f7fafc;border-radius:8px;text-align:center">
        <div style="font-size:28px;font-weight:700">{{trendArrow}} {{trendPercent}}%</div>
        <div style="font-size:12px;color:#718096">vs. previous run</div>
      </td>
    </tr>
  </table>
  {{detailsTable}}
  <p style="font-size:12px;color:#a0aec0;margin-top:24px">Sent by Argus · execution {{executionId}}</p>
</div>`;

export interface RenderInput {
  reportName: string;
  tenantName: string;
  executionId: string;
  count: number;
  executiveSummary: string;
  trendPercent: number;
  trendDirection: "up" | "down" | "flat";
  isAnomaly: boolean;
  baselineMean: number;
  variables: TemplateVars;
  rows?: Record<string, string | number>[];
}

function anomalyBanner(isAnomaly: boolean, mean: number, count: number): string {
  if (!isAnomaly) return "";
  return `<div style="padding:12px;background:#fff5f5;border-left:4px solid #e53e3e;border-radius:4px;margin-bottom:16px">
    <strong style="color:#c53030">Anomaly detected</strong>
    <div style="font-size:13px;color:#742a2a">Current count (${escapeHtml(count)}) deviates significantly from the baseline average (${escapeHtml(mean.toFixed(1))}).</div>
  </div>`;
}

function detailsTable(rows?: Record<string, string | number>[]): string {
  if (!rows || rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const head = headers
    .map(
      (h) =>
        `<th style="text-align:left;padding:8px;border-bottom:2px solid #e2e8f0;font-size:12px;text-transform:uppercase;color:#718096">${escapeHtml(h)}</th>`,
    )
    .join("");
  const body = rows
    .map(
      (r) =>
        `<tr>${headers.map((h) => `<td style="padding:8px;border-bottom:1px solid #edf2f7;font-size:13px">${escapeHtml(r[h])}</td>`).join("")}</tr>`,
    )
    .join("");
  return `<table role="presentation" style="width:100%;border-collapse:collapse"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

const ARROWS = { up: "▲", down: "▼", flat: "■" } as const;

/** Assemble the default report HTML from a computed render input. */
export function buildReportHtml(input: RenderInput): string {
  const vars: TemplateVars = {
    ...input.variables,
    reportName: input.reportName,
    tenantName: input.tenantName,
    executionId: input.executionId,
    count: input.count,
    executiveSummary: input.executiveSummary,
    trendPercent: Math.abs(input.trendPercent),
    trendArrow: ARROWS[input.trendDirection],
    timestamp: new Date().toISOString(),
  };
  // Inject pre-escaped HTML fragments FIRST (they contain no {{tokens}}), then
  // render value tokens — otherwise render() would strip the fragment slots.
  const withFragments = DEFAULT_TEMPLATE.replace(
    "{{anomalyBanner}}",
    anomalyBanner(input.isAnomaly, input.baselineMean, input.count),
  ).replace("{{detailsTable}}", detailsTable(input.rows));
  return render(withFragments, vars);
}
