import type { Job } from "@/db/schema";
import type { GraphTransport } from "@/services/graph/client";
import { liveGraphTransport } from "@/services/graph/client";
import { type EmailTransport, liveEmailTransport } from "@/services/dispatch/email";
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

    // 1. Fetch (critical).
    const fetchStart = performance.now();
    const rows = await report.fetch(transport, job.params);
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

    // 6. Record baseline metric for future runs; prune data older than 90 days.
    baselinesDao.record(job.id, METRIC, summary.count);
    baselinesDao.prune(90);

    // 7. Deliver or suppress.
    const recipients = job.recipients.length ? job.recipients : settingsDao.get().globalRecipients;
    if (decision.send) {
      const canSend = deps.canSendEmail ?? settingsDao.get().permissionStatus === "ok";
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
      const from = vaultService.get("mailbox") ?? "";
      await email.send({ from, to: recipients, subject, html });
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
    return finalize("failed", {
      errorMessage: errMsg(err),
      endedAt: now().toISOString(),
    });
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
