import type { Job } from "@/db/schema";
import type { GraphTransport } from "@/services/graph/client";
import { liveGraphTransport } from "@/services/graph/client";
import { type EmailTransport, liveEmailTransport } from "@/services/dispatch/email";
import { shouldAlertOnFailures, buildFailureAlertEmail } from "@/services/dispatch/alerts";
import { getReport } from "@/services/reports/registry";
import { detectAnomaly, computeTrend } from "@/services/report-engine/baseline";
import { evaluateCondition } from "@/services/report-engine/conditions";
import { renderReport, renderSubject, type RenderInput } from "@/services/report-engine/default-template";
import { templatesDao } from "@/db/dao/templates";
import { executionsDao } from "@/db/dao/executions";
import { baselinesDao } from "@/db/dao/baselines";
import { settingsDao } from "@/db/dao/settings";
import { webhooksDao } from "@/db/dao/webhooks";
import {
  dispatchWebhooks,
  type WebhookTarget,
  type WebhookResult,
} from "@/services/dispatch/webhook";
import { vaultService } from "@/services/vault/vault";
import { ValidationError } from "@/lib/errors";
import type { Execution, NewExecution, NewLog } from "@/db/schema";

const METRIC = "count";
const PRUNE_INTERVAL_MS = 86_400_000; // prune stale baselines at most once/day (AC-S4)
let lastPruneAt = 0;

export interface ExecutorDeps {
  transport?: GraphTransport;
  email?: EmailTransport;
  now?: () => Date;
  tenantName?: string;
  /** Mailbox already validated? When false, email is skipped (read-only mode). */
  canSendEmail?: boolean;
  /** Override webhook dispatch (tests); defaults to live dispatch over enabled targets. */
  dispatchWebhooks?: (targets: WebhookTarget[], payload: import("@/services/dispatch/webhook").WebhookPayload) => Promise<WebhookResult[]>;
}

/**
 * Run a single job end-to-end (PRD §4.3 "Run Now"). Persists an execution + logs,
 * applies baseline + conditional logic, renders the report, and either emails or
 * suppresses. Non-critical failures (baseline) degrade to `warning`; critical
 * failures (fetch, render, the sole delivery) end as `failed` (spec §7).
 */
export async function runJob(job: Job, deps: ExecutorDeps = {}): Promise<Execution> {
  const now = deps.now ?? (() => new Date());
  const transport = deps.transport ?? liveGraphTransport;
  const email = deps.email ?? liveEmailTransport;
  const startedAt = now().toISOString();

  const execution = executionsDao.create({ jobId: job.id, status: "warning", startedAt });
  // Buffer log lines and flush them in a single transaction at finalize (AC-DB3):
  // a run emits ~8–10 lines; one commit instead of one per line.
  const logBuffer: NewLog[] = [];
  const log = (level: "info" | "warning" | "error", message: string) => {
    logBuffer.push({
      id: crypto.randomUUID(),
      executionId: execution.id,
      level,
      message,
      timestamp: new Date().toISOString(),
    });
  };
  const finalize = (status: Execution["status"], patch: Partial<NewExecution>): Execution => {
    const updated = executionsDao.finalize(execution.id, { status, ...patch }, logBuffer);
    if (!updated) throw new Error(`Execution ${execution.id} vanished during finalize`);
    return updated;
  };
  log("info", `Execution started for job "${job.name}" (${job.reportType})`);

  try {
    const report = getReport(job.reportType);
    if (!report) throw new ValidationError(`Unknown report type: ${job.reportType}`);

    // 1. Fetch (critical). On a 403, name the exact permissions this report needs.
    const fetchStart = performance.now();
    const rows = await report.fetch(transport, job.params).catch((err: unknown) => {
      const e = err as { graphStatus?: number; message?: string };
      if (e?.graphStatus === 403) {
        const perms = report.requiredPermissions.filter((p) => !p.startsWith("(")).join(", ");
        throw new Error(
          `${e.message ?? "Permission denied"} Permissions this report needs: ${perms || "see the catalog"}. Delivery also needs Mail.Send.`,
        );
      }
      throw err;
    });
    const latencyMs = Math.round(performance.now() - fetchStart);
    const summary = report.summarize(rows);
    log("info", `Fetched ${rows.length} record(s); primary metric = ${summary.count}`);

    // 2. Baseline (non-critical — degrade to warning on error).
    let isAnomaly = false;
    let baselineMean = 0;
    let baselineSnapshot: Record<string, number> | null = null;
    try {
      const history = baselinesDao.history(job.id, METRIC);
      const result = detectAnomaly(summary.count, history);
      isAnomaly = result.isAnomaly;
      baselineMean = result.mean;
      baselineSnapshot = { mean: result.mean, stddev: result.stddev, zScore: result.zScore };
      if (isAnomaly) log("warning", `Anomaly: z-score ${result.zScore.toFixed(2)} vs baseline`);
    } catch (err) {
      log("warning", `Baseline computation failed (degraded): ${errMsg(err)}`);
    }

    // 3. Previous count + trend.
    const prior = executionsDao.forJob(job.id, 2).find((e) => e.id !== execution.id);
    const previousCount = prior?.recordsProcessed ?? null;
    const trend = computeTrend(summary.count, previousCount ?? summary.count);

    // 4. Conditional send.
    const decision = evaluateCondition(job.conditionalRules, {
      count: summary.count,
      previousCount,
      isAnomaly,
      newItemCount: previousCount === null ? summary.count : Math.max(0, summary.count - previousCount),
    });
    log("info", `Condition (${job.conditionalRules.mode}): ${decision.reason}`);

    // 5. Render (critical). Resolve template: job override → report default → built-in.
    const renderInput: RenderInput = {
      reportName: report.name,
      organizationName: deps.tenantName ?? "your organization",
      category: report.category,
      executionId: execution.id,
      count: summary.count,
      executiveSummary: `${summary.count} item(s) detected. ${decision.reason}.`,
      trendPercent: trend.percent,
      trendDirection: trend.direction,
      isAnomaly,
      baselineMean,
      variables: summary.variables,
      rows: summary.rows,
    };
    const template =
      (job.templateId ? templatesDao.findById(job.templateId) : undefined) ??
      templatesDao.defaultFor(job.reportType);
    if (template) log("info", `Using template "${template.name}"`);
    const html = renderReport(renderInput, template?.htmlBody);
    const subject = renderSubject(renderInput, template?.subject);

    // 6. Record baseline metric for future runs; prune old data at most once/day
    // (a full scan every execution was wasteful — AC-S4).
    baselinesDao.record(job.id, METRIC, summary.count);
    const nowMs = now().getTime();
    if (nowMs - lastPruneAt >= PRUNE_INTERVAL_MS) {
      baselinesDao.prune(settingsDao.get().retentionDays); // RT-2: configurable window
      lastPruneAt = nowMs;
    }

    // 7. Deliver or suppress. Read settings once for this run (AC-S4).
    const settings = settingsDao.get();
    const recipients = job.recipients.length ? job.recipients : settings.globalRecipients;
    // Empty reports: don't email a 0-item run when suppression is on (default). Applies to every report.
    if (decision.send && summary.count === 0 && settings.suppressEmptyReports) {
      log("info", "Empty report (0 items) — email suppressed");
      return finalize("suppressed", {
        recordsProcessed: 0,
        graphApiLatencyMs: latencyMs,
        outputHtml: html,
        emailSent: false,
        suppressionReason: "no items — empty report suppressed",
        baselineSnapshot,
        endedAt: now().toISOString(),
      });
    }
    if (decision.send) {
      const canSend = deps.canSendEmail ?? settings.permissionStatus === "ok";
      if (!canSend) {
        log("warning", "Read-only mode: mailbox not validated — email skipped");
        return finalize("warning", {
          recordsProcessed: summary.count,
          graphApiLatencyMs: latencyMs,
          outputHtml: html,
          emailSent: false,
          emailRecipients: recipients,
          suppressionReason: "read-only mode (mailbox unvalidated)",
          baselineSnapshot,
          endedAt: now().toISOString(),
        });
      }
      if (recipients.length === 0) {
        log("warning", "No recipients configured (job and global recipients both empty) — email skipped");
        return finalize("warning", {
          recordsProcessed: summary.count,
          graphApiLatencyMs: latencyMs,
          outputHtml: html,
          emailSent: false,
          emailRecipients: [],
          suppressionReason: "no recipients configured",
          baselineSnapshot,
          endedAt: now().toISOString(),
        });
      }
      const from = settings.fromAddress || vaultService.get("mailbox") || ""; // FR-2
      await email.send({ from, to: recipients, subject, html, replyTo: settings.replyTo ?? undefined });
      log("info", `Email sent to ${recipients.length} recipient(s)`);
      return finalize("success", {
        recordsProcessed: summary.count,
        graphApiLatencyMs: latencyMs,
        outputHtml: html,
        emailSent: true,
        emailRecipients: recipients,
        baselineSnapshot,
        endedAt: now().toISOString(),
      });
    }

    log("info", `Suppressed: ${decision.reason}`);

    // Suppressed → notify configured webhooks (non-critical; PRD §4.4).
    let webhookDelivered = false;
    let webhookError: string | null = null;
    const targets = webhooksDao.enabledTargets();
    if (targets.length > 0) {
      try {
        const dispatch = deps.dispatchWebhooks ?? dispatchWebhooks;
        const results = await dispatch(targets, {
          executionId: execution.id,
          jobId: job.id,
          jobName: job.name,
          suppressionReason: decision.reason,
          timestamp: now().toISOString(),
          recordsProcessed: summary.count,
          baselineSnapshot,
          metadata: { graphApiLatencyMs: latencyMs, reportType: job.reportType },
          fullHtml: html,
        });
        for (const r of results) webhooksDao.recordDelivery(r.webhookId, r.status);
        const failures = results.filter((r) => r.status === "failed");
        webhookDelivered = failures.length < results.length;
        if (failures.length) {
          webhookError = failures.map((f) => `${f.webhookId}: ${f.error}`).join("; ");
          log("warning", `${failures.length}/${results.length} webhook(s) failed`);
        } else {
          log("info", `Delivered to ${results.length} webhook(s)`);
        }
      } catch (err) {
        webhookError = errMsg(err);
        log("warning", `Webhook dispatch failed (degraded): ${webhookError}`);
      }
    }

    return finalize("suppressed", {
      recordsProcessed: summary.count,
      graphApiLatencyMs: latencyMs,
      outputHtml: html,
      emailSent: false,
      suppressionReason: decision.reason,
      baselineSnapshot,
      webhookDelivered,
      webhookError,
      endedAt: now().toISOString(),
    });
  } catch (err) {
    log("error", `Execution failed: ${errMsg(err)}`);
    const failed = finalize("failed", {
      errorMessage: errMsg(err),
      endedAt: now().toISOString(),
    });
    await maybeAlertOnFailure(job, failed, email, deps).catch(() => {
      /* alert delivery is best-effort — never mask the original failure */
    });
    return failed;
  }
}

/**
 * Job-failure alerts: when a job has failed `alertThreshold` times in a row,
 * email the configured admin contacts once. Disabled when threshold is 0, no
 * admins are set, or the mailbox isn't validated. Live send needs a real tenant.
 */
async function maybeAlertOnFailure(job: Job, failed: Execution, email: EmailTransport, deps: ExecutorDeps): Promise<void> {
  const settings = settingsDao.get();
  if (settings.adminContacts.length === 0) return;
  const statuses = executionsDao.forJob(job.id, 50).map((e) => e.status); // newest-first
  if (!shouldAlertOnFailures(statuses, settings.alertThreshold)) return;
  const canSend = deps.canSendEmail ?? settings.permissionStatus === "ok";
  if (!canSend) return;
  const message = buildFailureAlertEmail({
    jobName: job.name,
    consecutiveFailures: settings.alertThreshold,
    errorMessage: failed.errorMessage,
    recipients: settings.adminContacts,
    from: settings.fromAddress || vaultService.get("mailbox") || "",
    replyTo: settings.replyTo ?? undefined,
  });
  await email.send(message);
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
