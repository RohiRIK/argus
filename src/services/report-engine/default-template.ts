import { render, renderPlain, escapeHtml, type TemplateVars } from "./template";

/** Pre-0.5.0 HTML body preserved so idempotent seeding upgrades untouched defaults in place. */
export const LEGACY_TEMPLATE_HTML = `
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

/**
 * Default report email (PRD §11 anti-slop structure): executive summary, key
 * metrics, optional anomaly & diff banners, details table. Table-based + inline
 * CSS for Outlook Desktop, Gmail, Apple Mail, and WCAG AA light-canvas contrast.
 */
/** reportType of templates that apply to every report (the shared default and its clones). */
export const SHARED_TEMPLATE_TYPE = "*";

export const DEFAULT_TEMPLATE_HTML = `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:680px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a202c">
  <tr>
    <td style="padding:24px 24px 20px">
      <h1 style="font-size:20px;line-height:1.3;margin:0 0 4px;color:#0f172a">{{reportName}}</h1>
      <p style="color:#475569;font-size:13px;margin:0 0 16px">{{organization_name}} · {{categoryLabel}} · {{timestamp}}</p>
      {{anomalyBanner}}
      {{diffBanner}}
      <p style="font-size:14px;line-height:1.55;margin:0 0 16px;color:#1e293b">{{executiveSummary}}</p>
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="width:100%;border-collapse:collapse;margin:16px 0">
        <tr>
          <td width="48%" style="width:48%;padding:14px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;text-align:center;vertical-align:top">
            <div style="font-size:28px;font-weight:700;line-height:1.2;color:#0f172a">{{count}}</div>
            <div style="font-size:12px;color:#475569;margin-top:4px">primary metric</div>
          </td>
          <td width="4%" style="width:4%"></td>
          <td width="48%" style="width:48%;padding:14px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;text-align:center;vertical-align:top">
            <div style="font-size:24px;font-weight:700;line-height:1.35;color:#0f172a">{{trendArrow}} {{trendDisplay}}</div>
            <div style="font-size:12px;color:#475569;margin-top:4px">{{trendCaption}}</div>
          </td>
        </tr>
      </table>
      {{detailsTable}}
      <p style="font-size:12px;color:#64748b;margin:20px 0 0;border-top:1px solid #e2e8f0;padding-top:12px">Sent by Argus · {{organization_name}} · execution {{executionId}}</p>
    </td>
  </tr>
</table>`;

export const DEFAULT_SUBJECT = "[Argus · {{categoryLabel}}] {{reportName}} — {{organization_name}}";

/** Previous default subjects upgraded automatically when untouched. */
export const LEGACY_SUBJECT = "[Argus] {{reportName}} — {{organization_name}}";
export const LEGACY_CATEGORY_SUBJECT = "[Argus · {{categoryLabel}}] {{reportName}}";

export const LEGACY_TEXT_TEMPLATE = `{{reportName}}
{{categoryLabel}} · {{timestamp}}

{{executiveSummary}}

Primary metric: {{count}}
Trend vs. previous run: {{trendArrow}} {{trendPercent}}%
Baseline average: {{baselineAvg}}

— Sent by Argus (execution {{executionId}})`;

/** Default plain-text body (text/plain alternative). */
export const DEFAULT_TEXT_TEMPLATE = `{{reportName}}
{{organization_name}} · {{categoryLabel}} · {{timestamp}}

{{anomalyText}}{{diffText}}{{executiveSummary}}

Primary metric: {{count}}
Trend ({{trendCaption}}): {{trendArrow}} {{trendDisplay}}
Baseline average: {{baselineAvg}}
{{detailsText}}
— Sent by Argus · {{organization_name}} (execution {{executionId}})`;

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
  isFirstRun?: boolean;
  addedCount?: number;
  removedCount?: number;
  totalCount?: number;
  timezone?: string;
}

const ARROWS = { up: "▲", down: "▼", flat: "■" } as const;

const ACRONYMS = new Set(["id", "ip", "upn", "mfa", "ca", "dlp", "sp", "sku", "url", "os", "m365"]);

/** Convert camelCase / snake_case object keys into crisp human-readable column headers. */
export function humanizeHeader(key: string): string {
  const spaced = key
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
  if (!spaced) return key;
  return spaced
    .split(/\s+/)
    .map((word) => {
      const lower = word.toLowerCase();
      if (ACRONYMS.has(lower)) return lower.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

function formatReportTimestamp(timezone?: string): string {
  const now = new Date();
  const tz = timezone && timezone.trim() ? timezone.trim() : "UTC";
  try {
    const formatted = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZoneName: "short",
    }).format(now);
    return formatted;
  } catch {
    return now.toISOString();
  }
}

function anomalyBanner(isAnomaly: boolean, mean: number, count: number): string {
  if (!isAnomaly) return "";
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="width:100%;border-collapse:collapse;margin-bottom:16px"><tr><td style="padding:12px 14px;background:#fff5f5;border-left:4px solid #c53030;border-radius:4px"><strong style="color:#9b2c2c;font-size:13px">Anomaly detected</strong><div style="font-size:13px;color:#742a2a;margin-top:2px">Current count (${escapeHtml(count)}) deviates significantly from the baseline average (${escapeHtml(mean.toFixed(1))}).</div></td></tr></table>`;
}

function diffBanner(added?: number, removed?: number): string {
  const add = added ?? 0;
  const rem = removed ?? 0;
  if (add === 0 && rem === 0) return "";
  const parts: string[] = [];
  if (add > 0) parts.push(`${escapeHtml(add)} new item${add === 1 ? "" : "s"}`);
  if (rem > 0) parts.push(`${escapeHtml(rem)} resolved item${rem === 1 ? "" : "s"}`);
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="width:100%;border-collapse:collapse;margin-bottom:14px"><tr><td style="padding:10px 14px;background:#eff6ff;border-left:4px solid #2563eb;border-radius:4px;font-size:13px;color:#1e3a8a"><strong>Changes vs. previous snapshot:</strong> ${parts.join(" · ")}</td></tr></table>`;
}

const COMPACT_COLUMNS = new Set([
  "ip",
  "ipaddress",
  "date",
  "detected",
  "status",
  "attempts",
  "country",
  "severity",
  "level",
  "state",
  "daysleft",
  "lastsignin",
  "score",
  "count",
  "remediatedat",
  "usedbytes",
  "quotabytes",
  "percent",
]);

function detailsTable(rows?: Record<string, string | number>[], totalCount?: number): string {
  if (!rows) return "";
  if (rows.length === 0) {
    return `<div style="margin:12px 0;padding:12px 14px;border:1px solid #e2e8f0;border-radius:6px;background:#f8fafc;color:#475569;font-size:13px">No matching items recorded in this run.</div>`;
  }
  const headerSet = new Set<string>();
  for (const r of rows) {
    for (const k of Object.keys(r)) headerSet.add(k);
  }
  const headers = [...headerSet];
  const head = headers
    .map(
      (h) =>
        `<th style="text-align:left;padding:8px 10px;border-bottom:2px solid #cbd5e1;font-size:11px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:#475569;background:#f8fafc;white-space:nowrap">${escapeHtml(humanizeHeader(h))}</th>`,
    )
    .join("");
  const body = rows
    .map(
      (r) =>
        `<tr>${headers
          .map((h) => {
            const compact = COMPACT_COLUMNS.has(h.toLowerCase());
            const cellStyle = compact
              ? "padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#1e293b;vertical-align:top;white-space:nowrap;word-break:normal"
              : "padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#1e293b;vertical-align:top;min-width:130px;max-width:280px;word-break:normal;overflow-wrap:break-word";
            return `<td style="${cellStyle}">${escapeHtml(r[h] ?? "—")}</td>`;
          })
          .join("")}</tr>`,
    )
    .join("");
  const truncatedNote =
    typeof totalCount === "number" && totalCount > rows.length
      ? `<p style="margin:8px 0 0;font-size:12px;color:#475569">Showing ${escapeHtml(rows.length)} of ${escapeHtml(totalCount)} total items.</p>`
      : "";
  return `<div style="overflow-x:auto;-webkit-overflow-scrolling:touch;margin-top:8px"><table style="width:100%;border-collapse:collapse"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>${truncatedNote}</div>`;
}

function detailsText(rows?: Record<string, string | number>[], totalCount?: number): string {
  if (!rows || rows.length === 0) return "\nDetails: No matching items recorded in this run.\n";
  const slice = rows.slice(0, 25);
  const lines = slice.map((r, idx) => {
    const pairs = Object.entries(r)
      .map(([k, v]) => `${humanizeHeader(k)}: ${String(v ?? "—")}`)
      .join(" | ");
    return `  ${idx + 1}. ${pairs}`;
  });
  const suffix =
    typeof totalCount === "number" && totalCount > slice.length
      ? `\n  … showing ${slice.length} of ${totalCount} items\n`
      : "\n";
  return `\nDetails (${rows.length} row${rows.length === 1 ? "" : "s"}):\n${lines.join("\n")}${suffix}`;
}

/** Flat escaped variable map for {{token}} substitution (all reports + templates). */
export function buildVars(input: RenderInput): TemplateVars {
  const isFirst = Boolean(input.isFirstRun);
  const pct = Math.abs(input.trendPercent);
  const trendDisplay = isFirst ? "First run" : `${pct}%`;
  const trendCaption = isFirst ? "baseline initialized" : "vs. previous run";
  const add = input.addedCount ?? 0;
  const rem = input.removedCount ?? 0;
  const anomalyText = input.isAnomaly
    ? `[ANOMALY] Count (${input.count}) deviates significantly from baseline (${input.baselineMean.toFixed(1)}).\n\n`
    : "";
  const diffParts: string[] = [];
  if (add > 0) diffParts.push(`${add} new`);
  if (rem > 0) diffParts.push(`${rem} resolved`);
  const diffText = diffParts.length > 0 ? `[CHANGES] ${diffParts.join(", ")} vs. previous run.\n\n` : "";

  return {
    ...input.variables,
    reportName: input.reportName,
    organization_name: input.organizationName,
    tenantName: input.organizationName, // legacy alias
    categoryLabel: input.category ? input.category.charAt(0).toUpperCase() + input.category.slice(1) : "Report",
    executionId: input.executionId,
    count: input.count,
    executiveSummary: input.executiveSummary,
    trendPercent: pct,
    trendArrow: ARROWS[input.trendDirection],
    trendDirection: input.trendDirection,
    trendDisplay,
    trendCaption,
    baselineAvg: isFirst ? "initializing" : Math.round(input.baselineMean * 10) / 10,
    addedCount: add,
    removedCount: rem,
    anomalyText,
    diffText,
    detailsText: detailsText(input.rows, input.totalCount),
    timestamp: formatReportTimestamp(input.timezone),
  };
}

/** Raw (unescaped) HTML fragments available to every template. */
export function buildRawFragments(input: RenderInput): Record<string, string> {
  return {
    anomalyBanner: anomalyBanner(input.isAnomaly, input.baselineMean, input.count),
    diffBanner: diffBanner(input.addedCount, input.removedCount),
    detailsTable: detailsTable(input.rows, input.totalCount),
  };
}

/** Signature tagline appended under every rendered report (any template). */
export const TAGLINE = "Powered by caffeine and questionable life choices.";

/** Render a report inside a light-safe HTML document wrapper. Uses custom template body if provided. */
export function renderReport(input: RenderInput, templateHtml?: string): string {
  const vars = buildVars(input);
  const raw = buildRawFragments(input);
  const body = render(templateHtml ?? DEFAULT_TEMPLATE_HTML, vars, raw);
  const taglineHtml = `<p style="font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:680px;margin:12px auto 0;text-align:center;font-size:11px;font-style:italic;color:#64748b">${escapeHtml(TAGLINE)}</p>`;

  if (/<\/body>/i.test(body)) {
    return body.replace(/<\/body>/i, `${taglineHtml}\n</body>`);
  }
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
</head>
<body style="margin:0;padding:16px;background:#f8fafc;color:#1a202c">
${body}
${taglineHtml}
</body>
</html>`;
}

/** Render a subject line with the same variable set (plain text — not escaped). */
export function renderSubject(input: RenderInput, subjectTemplate?: string): string {
  return renderPlain(subjectTemplate ?? DEFAULT_SUBJECT, buildVars(input));
}

/** Render the plain-text body (text/plain alternative). */
export function renderText(input: RenderInput, textTemplate?: string): string {
  return `${renderPlain(textTemplate ?? DEFAULT_TEXT_TEMPLATE, buildVars(input))}\n\n${TAGLINE}`;
}
