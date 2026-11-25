import type { EmailMessage } from "./email";
import { escapeHtml } from "@/services/report-engine/template";

/**
 * Pure helpers for operational notifications: job-failure alerts and test-sends.
 * Message construction is kept side-effect-free so it is fully unit-testable; the
 * actual Graph send happens in the executor / API route via an EmailTransport.
 */

/** Count leading "failed" runs in a newest-first status list (the current streak). */
export function consecutiveFailures(statusesNewestFirst: string[]): number {
  let n = 0;
  for (const s of statusesNewestFirst) {
    if (s === "failed") n++;
    else break;
  }
  return n;
}

/**
 * Whether to fire a failure alert *now*. Fires exactly when the streak reaches the
 * threshold (not on every subsequent failure), so admins get one alert per breach.
 * A threshold <= 0 disables alerting.
 */
export function shouldAlertOnFailures(statusesNewestFirst: string[], threshold: number): boolean {
  if (threshold <= 0) return false;
  return consecutiveFailures(statusesNewestFirst) === threshold;
}

export interface AlertContext {
  jobName: string;
  consecutiveFailures: number;
  errorMessage?: string | null;
  recipients: string[];
  from: string;
  replyTo?: string;
}

/** Build the failure-alert email (admins) for a job that has failed N times running. */
export function buildFailureAlertEmail(ctx: AlertContext): EmailMessage {
  const safeJobName = ctx.jobName.replace(/[\r\n]+/g, " ").trim();
  const subject = `[Argus] Job "${safeJobName}" has failed ${ctx.consecutiveFailures}× in a row`;
  const html =
    `<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#ffffff;color:#1a202c;border:1px solid #e2e8f0;border-radius:8px">` +
    `<h2 style="margin:0 0 12px;font-size:18px;color:#c53030">Job failure alert</h2>` +
    `<p style="margin:0 0 12px;font-size:14px;line-height:1.5">The scheduled job <strong>${escapeHtml(safeJobName)}</strong> has failed ` +
    `<strong>${escapeHtml(ctx.consecutiveFailures)}</strong> consecutive time(s).</p>` +
    (ctx.errorMessage
      ? `<p style="margin:0 0 12px;padding:10px 12px;background:#fff5f5;border-left:4px solid #c53030;border-radius:4px;font-size:13px;color:#742a2a">Latest error: <code style="font-family:Consolas,monospace;word-break:break-word">${escapeHtml(ctx.errorMessage)}</code></p>`
      : "") +
    `<p style="margin:0;font-size:13px;color:#4a5568">Check the execution logs in Argus for details.</p>` +
    `</div>`;
  return { from: ctx.from, to: ctx.recipients, subject, html, replyTo: ctx.replyTo };
}

export interface TestSendContext {
  subject: string;
  html: string;
  recipients: string[];
  from: string;
  replyTo?: string;
}

/** Build a test-send email — the rendered sample with a clear [TEST] subject prefix. */
export function buildTestSendEmail(ctx: TestSendContext): EmailMessage {
  const subject = ctx.subject.startsWith("[TEST]") ? ctx.subject : `[TEST] ${ctx.subject}`;
  return { from: ctx.from, to: ctx.recipients, subject, html: ctx.html, replyTo: ctx.replyTo };
}
