import type {
  AutomationAction,
  AutomationPolicy,
  AutomationRun,
  NewAutomationAction,
  NewAutomationLog,
  NewAutomationRun,
} from "@/db/schema";
import {
  automationActionsDao,
  automationPoliciesDao,
  automationRunsDao,
} from "@/db/dao/automations";
import { auditDao } from "@/db/dao/audit";
import { settingsDao } from "@/db/dao/settings";
import { integrationsDao } from "@/db/dao/integrations";
import { webhooksDao } from "@/db/dao/webhooks";
import { maintenanceWindowsDao } from "@/db/dao/maintenance-windows";
import { isMuted } from "@/services/report-engine/maintenance";
import { resolveJobRecipients, type ResolvedRecipientsResult } from "@/services/graph/groups";
import { type EmailTransport, liveEmailTransport } from "@/services/dispatch/email";
import {
  dispatchWebhooks,
  type WebhookPayload,
  type WebhookResult,
  type WebhookTarget,
} from "@/services/dispatch/webhook";
import {
  AUTOMATION_PROVIDER,
  liveAutomationGraphTransport,
} from "@/services/graph/automation-client";
import { resolveOrganizationName } from "@/lib/org-name";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { withConcurrencyLimit } from "@/services/run-queue";
import { getAutomation } from "./registry";
import { renderAutomationRunHtml } from "./helpers";
import { templatesDao } from "@/db/dao/templates";
import { AUTOMATION_TEMPLATE_TYPE } from "@/services/report-engine/automation-template";
import { effectiveSender } from "@/services/graph/capabilities";
import { deliveryPreflight } from "@/services/job-readiness";
import type { AutomationGraphTransport } from "./types";

export interface AutomationEngineDeps {
  transport?: AutomationGraphTransport;
  email?: EmailTransport;
  now?: () => Date;
  canSendEmail?: boolean;
  modeOverride?: "audit" | "enforce";
  trigger?: "manual" | "schedule";
  resolveRecipients?: (opts: {
    directRecipients: string[];
    groupIds: string[];
    globalRecipients: string[];
    globalGroupIds: string[];
    syncLive?: boolean;
  }) => Promise<ResolvedRecipientsResult>;
  dispatchWebhooks?: (
    targets: WebhookTarget[],
    payload: WebhookPayload,
  ) => Promise<WebhookResult[]>;
}

// Per-policy overlap lock so scheduled + manual runs of the same automation policy never race.
const g = globalThis as unknown as { __argusAutomationInFlight?: Set<string> };
const inFlightPolicies: Set<string> = (g.__argusAutomationInFlight ??= new Set());

/**
 * Defense-in-depth wrapper injected during `plan()`: guarantees a catalog plugin's
 * discovery phase can NEVER issue POST / PATCH / DELETE against Microsoft Graph.
 */
function createReadOnlyPlanGuard(inner: AutomationGraphTransport): AutomationGraphTransport {
  const deny = (method: string) => () => {
    throw new Error(`Security violation: ${method} is forbidden during Automation plan() phase`);
  };
  return {
    get: (path) => inner.get(path),
    getOne: (path) => inner.getOne(path),
    post: deny("POST"),
    patch: deny("PATCH"),
    delete: deny("DELETE"),
  };
}

export async function enqueueAutomationRun(
  policy: AutomationPolicy,
  deps: AutomationEngineDeps = {},
): Promise<{ ran: boolean; reason?: string; run?: AutomationRun }> {
  if (inFlightPolicies.has(policy.id)) {
    return { ran: false, reason: "already running" };
  }
  inFlightPolicies.add(policy.id);
  try {
    const run = await withConcurrencyLimit(() => runAutomationPolicy(policy, deps));
    return { ran: true, run };
  } finally {
    inFlightPolicies.delete(policy.id);
  }
}

export async function runAutomationPolicy(
  policy: AutomationPolicy,
  deps: AutomationEngineDeps = {},
): Promise<AutomationRun> {
  const now = deps.now ?? (() => new Date());
  const transport = deps.transport ?? liveAutomationGraphTransport;
  const email = deps.email ?? liveEmailTransport;
  const effectiveMode = deps.modeOverride ?? policy.mode;
  const trigger = deps.trigger ?? "manual";
  const startedAt = now().toISOString();

  const runRow = automationRunsDao.create({
    policyId: policy.id,
    mode: effectiveMode,
    trigger,
    status: "warning",
    startedAt,
  });

  const logBuffer: NewAutomationLog[] = [];
  const actionBuffer: NewAutomationAction[] = [];
  const log = (level: "info" | "warning" | "error", message: string) => {
    logBuffer.push({
      id: crypto.randomUUID(),
      runId: runRow.id,
      level,
      message,
      timestamp: now().toISOString(),
    });
  };

  const finalize = (
    status: AutomationRun["status"],
    patch: Partial<NewAutomationRun>,
  ): AutomationRun => {
    const updated = automationRunsDao.finalize(
      runRow.id,
      { status, endedAt: now().toISOString(), ...patch },
      logBuffer,
      actionBuffer,
    );
    if (!updated) throw new Error(`AutomationRun ${runRow.id} vanished during finalize`);
    return updated;
  };

  log(
    "info",
    `Automation started for "${policy.name}" (${policy.automationType}) in ${effectiveMode.toUpperCase()} mode`,
  );

  try {
    const def = getAutomation(policy.automationType);
    if (!def) throw new ValidationError(`Unknown automation type: ${policy.automationType}`);

    // 1. Read-Only Plan Phase (protected by ReadOnlyGuardTransport).
    const planStart = performance.now();
    const planResult = await def
      .plan(createReadOnlyPlanGuard(transport), policy.params)
      .catch((err: unknown) => {
        const e = err as { graphStatus?: number; message?: string };
        if (e?.graphStatus === 403) {
          throw new Error(
            `${e.message ?? "Permission denied"} Required Automation scopes: ${def.requiredPermissions.join(", ")}.`,
          );
        }
        throw err;
      });
    let totalLatencyMs = Math.round(performance.now() - planStart);

    log(
      "info",
      `Plan completed in ${totalLatencyMs} ms: evaluated=${planResult.evaluatedCount}, planned=${planResult.actions.length}. ${planResult.summary}`,
    );

    // 2. Blast-Radius Circuit Breaker check before any Graph write occurs.
    const maxActions = Math.max(1, policy.maxActionsPerRun || 25);
    if (effectiveMode === "enforce" && planResult.actions.length > maxActions) {
      const msg = `Circuit breaker halted ENFORCE run: ${planResult.actions.length} planned actions exceed policy maxActionsPerRun (${maxActions}). Review the planned snapshot or raise maxActionsPerRun.`;
      log("error", msg);
      for (const planned of planResult.actions) {
        actionBuffer.push({
          id: crypto.randomUUID(),
          runId: runRow.id,
          policyId: policy.id,
          targetType: planned.targetType,
          targetId: planned.targetId,
          targetLabel: planned.targetLabel,
          actionType: planned.actionType,
          status: "skipped",
          reason: planned.reason,
          beforeState: planned.beforeState,
          afterState: planned.plannedAfterState ?? null,
          rollbackPayload: planned.rollbackPayload ?? null,
          errorMessage: "Halted by maxActionsPerRun circuit breaker",
          createdAt: now().toISOString(),
        });
      }
      return finalize("halted", {
        evaluatedCount: planResult.evaluatedCount,
        plannedCount: planResult.actions.length,
        appliedCount: 0,
        failedCount: 0,
        graphApiLatencyMs: totalLatencyMs,
        summaryText: msg,
        errorMessage: msg,
      });
    }

    // 3. Mode Gate: Audit (Dry-Run) vs Enforce (Live Remediation).
    let appliedCount = 0;
    let failedCount = 0;

    if (effectiveMode === "audit") {
      for (const planned of planResult.actions) {
        actionBuffer.push({
          id: crypto.randomUUID(),
          runId: runRow.id,
          policyId: policy.id,
          targetType: planned.targetType,
          targetId: planned.targetId,
          targetLabel: planned.targetLabel,
          actionType: planned.actionType,
          status: "planned",
          reason: planned.reason,
          beforeState: planned.beforeState,
          afterState: planned.plannedAfterState ?? null,
          rollbackPayload: planned.rollbackPayload ?? null,
          createdAt: now().toISOString(),
        });
      }
      if (planResult.actions.length > 0) {
        log(
          "warning",
          `AUDIT (Dry-Run) recorded ${planResult.actions.length} planned remediation item(s) without mutating Microsoft Graph.`,
        );
      }
    } else {
      // ENFORCE mode: apply each planned action sequentially, recording before/after + rollback payloads.
      for (const planned of planResult.actions) {
        const applyStart = performance.now();
        try {
          const applied = await def.apply(transport, planned, policy.params);
          totalLatencyMs += Math.round(performance.now() - applyStart);
          appliedCount++;
          actionBuffer.push({
            id: crypto.randomUUID(),
            runId: runRow.id,
            policyId: policy.id,
            targetType: planned.targetType,
            targetId: planned.targetId,
            targetLabel: planned.targetLabel,
            actionType: planned.actionType,
            status: "applied",
            reason: planned.reason,
            beforeState: planned.beforeState,
            afterState: applied.afterState,
            rollbackPayload:
              applied.rollbackPayload !== undefined
                ? applied.rollbackPayload
                : (planned.rollbackPayload ?? null),
            createdAt: now().toISOString(),
          });
          log("info", `Applied ${planned.actionType} on "${planned.targetLabel}"`);
        } catch (err) {
          totalLatencyMs += Math.round(performance.now() - applyStart);
          failedCount++;
          const errMsg = err instanceof Error ? err.message : String(err);
          actionBuffer.push({
            id: crypto.randomUUID(),
            runId: runRow.id,
            policyId: policy.id,
            targetType: planned.targetType,
            targetId: planned.targetId,
            targetLabel: planned.targetLabel,
            actionType: planned.actionType,
            status: "failed",
            reason: planned.reason,
            beforeState: planned.beforeState,
            afterState: null,
            rollbackPayload: planned.rollbackPayload ?? null,
            errorMessage: errMsg,
            createdAt: now().toISOString(),
          });
          log("error", `Failed ${planned.actionType} on "${planned.targetLabel}": ${errMsg}`);
        }
      }

      if (appliedCount > 0 || failedCount > 0) {
        auditDao.record({
          action: "automation_enforce_run",
          provider: AUTOMATION_PROVIDER,
          outcome: failedCount === 0 ? "success" : appliedCount > 0 ? "partial" : "error",
          detail: {
            policyId: policy.id,
            policyName: policy.name,
            automationType: policy.automationType,
            runId: runRow.id,
            appliedCount,
            failedCount,
          },
        });
      }
    }

    const terminalStatus: AutomationRun["status"] =
      failedCount > 0 && appliedCount === 0
        ? "failed"
        : failedCount > 0
          ? "warning"
          : effectiveMode === "audit" && planResult.actions.length > 0
            ? "drift_detected"
            : "success";

    const s = settingsDao.get();
    const m365 = integrationsDao.findByProvider("microsoft365");
    const m365Config = (m365?.config ?? {}) as { tenantDisplayName?: unknown; primaryDomain?: unknown };
    const orgName = resolveOrganizationName({
      settingsOrgName: s.organizationDisplayName,
      tenantDisplayName: m365Config.tenantDisplayName,
      primaryDomain: m365Config.primaryDomain,
    });

    // Same template system as reports: the operator-editable automation template (H9 ownership rules).
    const template = templatesDao.sharedDefault("en", AUTOMATION_TEMPLATE_TYPE);
    const rendered = renderAutomationRunHtml({
      organizationName: orgName,
      policyName: policy.name,
      definition: def,
      run: {
        id: runRow.id,
        mode: effectiveMode,
        status: terminalStatus,
        startedAt,
        evaluatedCount: planResult.evaluatedCount,
        plannedCount: planResult.actions.length,
        appliedCount,
        failedCount,
        summaryText: planResult.summary,
      },
      actions: actionBuffer.map((a) => ({
        targetType: a.targetType,
        targetLabel: a.targetLabel,
        actionType: a.actionType,
        status: a.status as AutomationAction["status"],
        reason: a.reason,
        errorMessage: a.errorMessage ?? null,
      })),
    }, template);

    // 4. Optional Notification Dispatch (respects notifyOn + maintenance windows).
    const shouldNotify =
      policy.notifyOn === "always" ||
      (policy.notifyOn === "changes_only" && (planResult.actions.length > 0 || failedCount > 0)) ||
      (policy.notifyOn === "failures_only" && failedCount > 0);

    let emailSent = false;
    let emailRecipients: string[] | null = null;
    let webhookDelivered = false;
    let webhookError: string | null = null;

    const mutedWindow = isMuted(maintenanceWindowsDao.list(), now(), s.timezone || "UTC");
    if (shouldNotify && !mutedWindow) {
      const resolver = deps.resolveRecipients ?? resolveJobRecipients;
      const resolved = await resolver({
        directRecipients: policy.recipients,
        groupIds: policy.recipientGroupIds,
        globalRecipients: s.globalRecipients,
        globalGroupIds: s.globalRecipientGroupIds,
        syncLive: false,
      });
      // Same sender and send check as report jobs (H2/H3): one identity, one preflight.
      const senderMailbox = effectiveSender(s).address ?? "";
      const preflight = deliveryPreflight(s);
      const canSend = deps.canSendEmail ?? preflight.canDeliver;
      if (!canSend) log("warning", `Notification blocked: ${preflight.reason ?? "delivery is not ready"}`);
      else if (resolved.emails.length === 0) log("warning", "Notification skipped: no recipients (policy and global lists are empty)");

      if (canSend && resolved.emails.length > 0 && senderMailbox) {
        try {
          await email.send({
            from: senderMailbox,
            replyTo: s.replyTo ?? undefined,
            to: resolved.emails,
            subject: rendered.subject,
            html: rendered.html,
          });
          emailSent = true;
          emailRecipients = resolved.emails;
          log("info", `Dispatched notification email to ${resolved.emails.length} recipient(s)`);
        } catch (err) {
          log("warning", `Notification email failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      const hooks = webhooksDao.enabledTargets();
      if (hooks.length > 0) {
        try {
          const dispatch = deps.dispatchWebhooks ?? dispatchWebhooks;
          const results = await dispatch(hooks, {
            executionId: runRow.id,
            jobId: policy.id,
            jobName: policy.name,
            suppressionReason: `automation:${effectiveMode}:${terminalStatus}`,
            timestamp: now().toISOString(),
            recordsProcessed: effectiveMode === "enforce" ? appliedCount : planResult.actions.length,
            baselineSnapshot: null,
            metadata: {
              source: "automation",
              automationType: policy.automationType,
              status: terminalStatus,
              mode: effectiveMode,
              evaluated: planResult.evaluatedCount,
              planned: planResult.actions.length,
              applied: appliedCount,
              failed: failedCount,
              graphApiLatencyMs: totalLatencyMs,
            },
            fullHtml: rendered.html,
          });
          for (const r of results) webhooksDao.recordDelivery(r.webhookId, r.status);
          const failures = results.filter((r) => r.status === "failed");
          webhookDelivered = failures.length < results.length;
          if (failures.length) webhookError = failures.map((f) => `${f.webhookId}: ${f.error}`).join("; ");
        } catch (err) {
          webhookError = err instanceof Error ? err.message : String(err);
          log("warning", `Webhook dispatch failed (degraded): ${webhookError}`);
        }
      }
    }

    return finalize(terminalStatus, {
      evaluatedCount: planResult.evaluatedCount,
      plannedCount: planResult.actions.length,
      appliedCount,
      failedCount,
      graphApiLatencyMs: totalLatencyMs,
      summaryText: planResult.summary,
      outputHtml: rendered.html,
      emailSent,
      emailRecipients,
      webhookDelivered,
      webhookError,
      ...(failedCount > 0 ? { errorMessage: `${failedCount} remediation action(s) failed` } : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log("error", `Automation failed: ${message}`);
    return finalize("failed", {
      errorMessage: message,
      summaryText: message,
    });
  }
}

/**
 * Execute the stored `rollbackPayload` for a previously applied `AutomationAction`,
 * restoring the captured pre-change state in Microsoft Graph and recording a forensic
 * `rollback` run + audit log entry.
 */
export async function rollbackAutomationAction(
  actionId: string,
  deps: { transport?: AutomationGraphTransport; now?: () => Date } = {},
): Promise<{ action: AutomationAction; run: AutomationRun }> {
  const now = deps.now ?? (() => new Date());
  const transport = deps.transport ?? liveAutomationGraphTransport;

  const action = automationActionsDao.findById(actionId);
  if (!action) throw new NotFoundError(`Automation action ${actionId} not found`);
  if (action.status !== "applied") {
    throw new ConflictError(`Only "applied" actions can be rolled back (current status: ${action.status})`);
  }
  if (!action.rollbackPayload) {
    throw new ValidationError(`Action "${action.actionType}" does not have a reversible Graph rollback payload`);
  }
  const policy = automationPoliciesDao.findById(action.policyId);
  if (!policy) throw new NotFoundError(`Parent automation policy ${action.policyId} not found`);

  const startedAt = now().toISOString();
  const rbRun = automationRunsDao.create({
    policyId: policy.id,
    mode: "rollback",
    trigger: "rollback",
    status: "warning",
    startedAt,
  });

  const spec = action.rollbackPayload;
  const start = performance.now();
  try {
    if (spec.method === "PATCH") {
      await transport.patch(spec.path, spec.body ?? {});
    } else if (spec.method === "POST") {
      await transport.post(spec.path, spec.body ?? {});
    } else if (spec.method === "DELETE") {
      await transport.delete(spec.path);
    }
    const latencyMs = Math.round(performance.now() - start);
    const updatedAction = automationActionsDao.updateStatus(action.id, "rolled_back")!;
    const finalizedRun = automationRunsDao.finalize(
      rbRun.id,
      {
        status: "success",
        endedAt: now().toISOString(),
        evaluatedCount: 1,
        plannedCount: 1,
        appliedCount: 1,
        failedCount: 0,
        graphApiLatencyMs: latencyMs,
        summaryText: `Rolled back ${action.actionType} on "${action.targetLabel}": ${spec.description}`,
      },
      [
        {
          id: crypto.randomUUID(),
          runId: rbRun.id,
          level: "info",
          message: `Executed rollback (${spec.method} ${spec.path}): ${spec.description}`,
          timestamp: now().toISOString(),
        },
      ],
    )!;

    auditDao.record({
      action: "automation_action_rollback",
      provider: AUTOMATION_PROVIDER,
      outcome: "success",
      detail: {
        actionId: action.id,
        policyId: policy.id,
        targetLabel: action.targetLabel,
        method: spec.method,
        path: spec.path,
      },
    });

    return { action: updatedAction, run: finalizedRun };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    automationRunsDao.finalize(
      rbRun.id,
      {
        status: "failed",
        endedAt: now().toISOString(),
        evaluatedCount: 1,
        plannedCount: 1,
        appliedCount: 0,
        failedCount: 1,
        errorMessage: message,
        summaryText: `Rollback failed for "${action.targetLabel}": ${message}`,
      },
      [
        {
          id: crypto.randomUUID(),
          runId: rbRun.id,
          level: "error",
          message: `Rollback failed (${spec.method} ${spec.path}): ${message}`,
          timestamp: now().toISOString(),
        },
      ],
    );
    auditDao.record({
      action: "automation_action_rollback",
      provider: AUTOMATION_PROVIDER,
      outcome: "error",
      detail: { actionId: action.id, error: message },
    });
    throw err;
  }
}
