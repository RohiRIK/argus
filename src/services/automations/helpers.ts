import type { AutomationAction, AutomationRun } from "@/db/schema";
import type { AutomationDefinition } from "./types";

export const MICROSOFT_TENANT_APP_OWNER_ID = "f8cdef31-a31e-4b4a-93e4-5f571e91255a";
export const GLOBAL_ADMIN_ROLE_TEMPLATE_ID = "62e90394-69f5-4237-9190-012177145e10";

export function asStringList(val: unknown, fallback: string[] = []): string[] {
  if (Array.isArray(val)) {
    return val
      .map((x) => String(x ?? "").trim())
      .filter(Boolean);
  }
  if (typeof val === "string") {
    return val
      .split(/[\n,;]+/)
      .map((x) => x.trim())
      .filter(Boolean);
  }
  return fallback;
}

export function asNumber(val: unknown, fallback: number, min = 0): number {
  const n = typeof val === "number" ? val : Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.round(n));
}

export function asBoolean(val: unknown, fallback: boolean): boolean {
  if (typeof val === "boolean") return val;
  if (val === "true") return true;
  if (val === "false") return false;
  return fallback;
}

export function asString(val: unknown, fallback = ""): string {
  return typeof val === "string" && val.trim() ? val.trim() : fallback;
}

export function daysSinceIso(iso: string | null | undefined, nowMs = Date.now()): number | null {
  if (!iso) return null;
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return null;
  return Math.floor((nowMs - ts) / 86_400_000);
}

export function latestIso(...dates: Array<string | null | undefined>): string | null {
  let best: string | null = null;
  let bestMs = -Infinity;
  for (const d of dates) {
    if (!d) continue;
    const ms = Date.parse(d);
    if (!Number.isNaN(ms) && ms > bestMs) {
      bestMs = ms;
      best = d;
    }
  }
  return best;
}

export function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Render an editorial, self-contained HTML email/report summary for an Automation Run,
 * detailing the execution mode (`AUDIT` vs `ENFORCE`), metrics, and per-target changes.
 */
export function renderAutomationRunHtml(opts: {
  organizationName: string;
  policyName: string;
  definition: AutomationDefinition;
  run: Pick<
    AutomationRun,
    | "id"
    | "mode"
    | "status"
    | "startedAt"
    | "evaluatedCount"
    | "plannedCount"
    | "appliedCount"
    | "failedCount"
    | "summaryText"
  >;
  actions: Array<
    Pick<
      AutomationAction,
      "targetType" | "targetLabel" | "actionType" | "status" | "reason" | "errorMessage"
    >
  >;
}): { subject: string; html: string; text: string } {
  const { organizationName, policyName, definition, run, actions } = opts;
  const modeLabel =
    run.mode === "enforce" ? "ENFORCE" : run.mode === "rollback" ? "ROLLBACK" : "AUDIT (DRY-RUN)";
  const statusLabel = run.status.replace(/_/g, " ").toUpperCase();
  const subject = `[Argus ${modeLabel}] ${policyName} — ${
    run.mode === "enforce"
      ? `${run.appliedCount} applied`
      : run.plannedCount > 0
        ? `${run.plannedCount} drift item(s)`
        : "Compliant"
  }`;

  const rowsHtml =
    actions.length === 0
      ? `<p style="font-size:13px;color:#475569;margin:12px 0;">No configuration drift or pending remediation items detected across ${run.evaluatedCount} evaluated resource(s).</p>`
      : `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:12px;font-size:12px;">
          <thead>
            <tr style="background:#f8fafc;border-bottom:1px solid #cbd5e1;text-align:left;">
              <th style="padding:8px;">Target</th>
              <th style="padding:8px;">Action</th>
              <th style="padding:8px;">Status</th>
              <th style="padding:8px;">Reason</th>
            </tr>
          </thead>
          <tbody>
            ${actions
              .slice(0, 50)
              .map(
                (a) => `<tr style="border-bottom:1px solid #e2e8f0;">
                  <td style="padding:8px;font-weight:600;color:#0f172a;">${escapeHtml(a.targetLabel)} <span style="color:#64748b;font-weight:400;">(${escapeHtml(a.targetType)})</span></td>
                  <td style="padding:8px;font-family:monospace;color:#334155;">${escapeHtml(a.actionType)}</td>
                  <td style="padding:8px;text-transform:uppercase;font-weight:600;color:${
                    a.status === "applied"
                      ? "#15803d"
                      : a.status === "failed"
                        ? "#b91c1c"
                        : "#b45309"
                  };">${escapeHtml(a.status)}</td>
                  <td style="padding:8px;color:#334155;">${escapeHtml(a.reason)}${
                    a.errorMessage ? ` <span style="color:#b91c1c;">(${escapeHtml(a.errorMessage)})</span>` : ""
                  }</td>
                </tr>`,
              )
              .join("")}
          </tbody>
        </table>`;

  const html = `<!DOCTYPE html>
<html>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f8fafc;padding:24px;color:#0f172a;">
  <div style="max-width:720px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;padding:24px;">
    <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #e2e8f0;padding-bottom:14px;">
      <div>
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.12em;color:#64748b;">${escapeHtml(organizationName)} · Argus Automation</div>
        <h2 style="margin:4px 0 0;font-size:18px;color:#0f172a;">${escapeHtml(policyName)}</h2>
      </div>
      <div style="font-size:11px;font-weight:700;padding:4px 10px;border-radius:4px;border:1px solid #cbd5e1;background:#f1f5f9;">
        ${escapeHtml(modeLabel)} · ${escapeHtml(statusLabel)}
      </div>
    </div>
    <p style="font-size:13px;color:#334155;margin:14px 0;">${escapeHtml(run.summaryText ?? definition.description)}</p>
    <div style="display:flex;gap:16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:12px;font-size:12px;">
      <div><strong>Evaluated:</strong> ${run.evaluatedCount}</div>
      <div><strong>Planned / Drift:</strong> ${run.plannedCount}</div>
      <div><strong>Applied:</strong> ${run.appliedCount}</div>
      <div><strong>Failed:</strong> ${run.failedCount}</div>
    </div>
    ${rowsHtml}
    <p style="margin-top:18px;font-size:11px;color:#64748b;">Run ID: ${escapeHtml(run.id)} · Catalog: ${escapeHtml(definition.id)} v${escapeHtml(definition.version)} · Pre/post JSON state snapshots saved in Argus.</p>
  </div>
</body>
</html>`;

  const textLines = [
    `${organizationName} — Argus Automation (${modeLabel})`,
    `Policy: ${policyName} (${definition.name})`,
    `Status: ${statusLabel}`,
    `Summary: ${run.summaryText ?? definition.description}`,
    `Evaluated: ${run.evaluatedCount} | Planned: ${run.plannedCount} | Applied: ${run.appliedCount} | Failed: ${run.failedCount}`,
    "",
    ...actions.slice(0, 50).map((a) => `- [${a.status.toUpperCase()}] ${a.targetLabel} (${a.actionType}): ${a.reason}`),
  ];

  return { subject, html, text: textLines.join("\n") };
}
