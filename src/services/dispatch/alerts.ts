import type { EmailMessage } from "./email";

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
  const subject = `[Argus] Job "${ctx.jobName}" has failed ${ctx.consecutiveFailures}× in a row`;
  const html =
    `<h2>Job failure alert</h2>` +
    `<p>The scheduled job <strong>${ctx.jobName}</strong> has failed ` +
    `<strong>${ctx.consecutiveFailures}</strong> consecutive time(s).</p>` +
    (ctx.errorMessage ? `<p>Latest error: <code>${ctx.errorMessage}</code></p>` : "") +
    `<p>Check the execution logs in Argus for details.</p>`;
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
