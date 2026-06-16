import { render, renderPlain, escapeHtml, type TemplateVars } from "./template";

/**
 * Default report email (PRD §11 anti-slop structure): executive summary, key
 * metrics, optional anomaly banner, details table. Inline CSS for Outlook.
 * Exported so DB-seeded editable templates share the same baseline markup.
 * {{anomalyBanner}} and {{detailsTable}} are RAW HTML fragments.
 */
export const DEFAULT_TEMPLATE_HTML = `
<div style="font-family:Segoe UI,Arial,sans-serif;max-width:680px;margin:0 auto;color:#1a202c">
  <h1 style="font-size:20px;margin:0 0 4px">{{reportName}}</h1>
  <p style="color:#718096;font-size:13px;margin:0 0 16px">{{categoryLabel}} · {{timestamp}}</p>
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

export const DEFAULT_SUBJECT = "[Argus · {{categoryLabel}}] {{reportName}}";

/** The pre-0.3.1 default subject — used to upgrade existing seeded templates in place. */
export const LEGACY_SUBJECT = "[Argus] {{reportName}} — {{organization_name}}";

/** Default plain-text body (text/plain alternative for multipart email). */
export const DEFAULT_TEXT_TEMPLATE = `{{reportName}}
{{categoryLabel}} · {{timestamp}}

{{executiveSummary}}

Primary metric: {{count}}
Trend vs. previous run: {{trendArrow}} {{trendPercent}}%
Baseline average: {{baselineAvg}}

— Sent by Argus (execution {{executionId}})`;

export interface RenderInput {
  reportName: string;
  organizationName: string;
  /** Report category (identity/security/infrastructure/custom) → shown as a friendly label. */
  category?: string;
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

const ARROWS = { up: "▲", down: "▼", flat: "■" } as const;

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

/** Flat escaped variable map for {{token}} substitution (all reports + templates). */
export function buildVars(input: RenderInput): TemplateVars {
  return {
    ...input.variables,
    reportName: input.reportName,
    organization_name: input.organizationName,
    tenantName: input.organizationName, // legacy alias
    categoryLabel: input.category ? input.category.charAt(0).toUpperCase() + input.category.slice(1) : "Report",
    executionId: input.executionId,
    count: input.count,
    executiveSummary: input.executiveSummary,
    trendPercent: Math.abs(input.trendPercent),
    trendArrow: ARROWS[input.trendDirection],
    trendDirection: input.trendDirection,
    baselineAvg: Math.round(input.baselineMean * 10) / 10,
    timestamp: new Date().toISOString(),
  };
}

/** Raw (unescaped) HTML fragments available to every template. */
export function buildRawFragments(input: RenderInput): Record<string, string> {
  return {
    anomalyBanner: anomalyBanner(input.isAnomaly, input.baselineMean, input.count),
    detailsTable: detailsTable(input.rows),
  };
}

/** Signature tagline appended under every rendered report (any template). */
export const TAGLINE = "Powered by caffeine and questionable life choices.";

/** Render a report. Uses a custom template body if provided, else the default. */
export function renderReport(input: RenderInput, templateHtml?: string): string {
  const body = render(templateHtml ?? DEFAULT_TEMPLATE_HTML, buildVars(input), buildRawFragments(input));
  return `${body}\n<p style="font-family:Segoe UI,Arial,sans-serif;max-width:680px;margin:12px auto 0;text-align:center;font-size:11px;font-style:italic;color:#a0aec0">${escapeHtml(TAGLINE)}</p>`;
}

/** Render a subject line with the same variable set (plain text — not escaped). */
export function renderSubject(input: RenderInput, subjectTemplate?: string): string {
  return renderPlain(subjectTemplate ?? DEFAULT_SUBJECT, buildVars(input));
}

/** Render the plain-text body (text/plain alternative). */
export function renderText(input: RenderInput, textTemplate?: string): string {
  return `${renderPlain(textTemplate ?? DEFAULT_TEXT_TEMPLATE, buildVars(input))}\n\n${TAGLINE}`;
}
