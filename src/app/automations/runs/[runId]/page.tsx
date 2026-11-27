import { notFound } from "next/navigation";
import {
  automationActionsDao,
  automationLogsDao,
  automationPoliciesDao,
  automationRunsDao,
} from "@/db/dao/automations";
import { getAutomation } from "@/services/automations/registry";
import { AppShell } from "@/components/app-shell";
import { Badge, Card, CardContent, CardHeader, CardTitle, LinkButton } from "@/components/ui/primitives";
import { StatusPill, type JobStatus } from "@/components/ui/status-pill";
import { Metric } from "@/components/ui/metric";
import { RelativeTime } from "@/components/ui/relative-time";
import { sparkColor } from "@/lib/job-health";
import { automationRunHref, automationRunOutcome } from "@/lib/work-items";

export const dynamic = "force-dynamic";

const LEVEL_COLOR: Record<string, string> = {
  info: "text-info",
  warning: "text-warning",
  error: "text-danger",
};

const MODE_LABEL: Record<string, string> = { audit: "Audit (dry run)", enforce: "Enforce", rollback: "Rollback" };
const TRIGGER_LABEL: Record<string, string> = {
  manual: "manually (Run Now)",
  schedule: "by the schedule",
  rollback: "by a rollback",
};

const ACTION_TONE: Record<string, string> = {
  planned: "border-info/20 bg-info/8 text-info",
  applied: "border-success/20 bg-success/8 text-success",
  skipped: "border-border/50 bg-surface-2/80 text-fg-muted",
  failed: "border-danger/20 bg-danger/8 text-danger",
  rolled_back: "border-warning/20 bg-warning/8 text-warning",
};

function Json({ value, testId }: { value: unknown; testId: string }) {
  const empty = value === null || value === undefined || (typeof value === "object" && Object.keys(value).length === 0);
  return (
    <pre
      data-testid={testId}
      className="max-h-64 overflow-auto rounded-md border border-border/50 bg-surface-2/60 p-2.5 font-mono text-[11px] leading-relaxed text-fg-muted"
    >
      {empty ? "—" : JSON.stringify(value, null, 2)}
    </pre>
  );
}

/** /automations/runs/:runId — one automation run: summary, per-target changes (before/after) and logs. */
export default async function AutomationRunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  if (process.env.NEXT_PHASE === "phase-production-build") return null;

  const run = automationRunsDao.findById(runId);
  if (!run) notFound();
  const policy = automationPoliciesDao.findById(run.policyId);
  const def = policy ? getAutomation(policy.automationType) : undefined;
  const actions = automationActionsDao.forRun(runId);
  const logs = automationLogsDao.forRun(runId);
  const history = automationRunsDao.forPolicy(run.policyId, 20); // newest-first
  const outcome = automationRunOutcome(run.status);
  const duration = run.endedAt
    ? `${Math.round(new Date(run.endedAt).getTime() - new Date(run.startedAt).getTime())} ms`
    : "—";

  return (
    <AppShell
      title="Automation run"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <LinkButton href={`/api/automations/runs/${run.id}`} variant="ghost" size="sm">
            Raw JSON
          </LinkButton>
          <LinkButton href="/automations/runs" variant="ghost" size="sm">
            All runs
          </LinkButton>
          <LinkButton href="/automations" variant="outline" size="sm" data-testid="manage-policy">
            Manage policy
          </LinkButton>
        </div>
      }
    >
      <div className="space-y-6">
        {/* Identity bar */}
        <div className="flex items-start justify-between gap-4 rounded-lg border border-border/70 bg-surface p-4 shadow-sm">
          <div className="min-w-0 space-y-1">
            <p className="truncate text-sm font-semibold text-fg" data-testid="run-policy-name">
              {policy?.name ?? "Deleted policy"}
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge className="border-primary/20 bg-primary/8 font-semibold uppercase tracking-wider text-primary">
                Automation · {MODE_LABEL[run.mode] ?? run.mode}
              </Badge>
              {def && <Badge>{def.name}</Badge>}
              {policy?.tags.map((t) => (
                <Badge key={t}>{t}</Badge>
              ))}
            </div>
            <p className="font-mono text-xs text-fg-muted/80">{run.id}</p>
            <RelativeTime iso={run.startedAt} className="text-xs text-fg-muted/60" />
          </div>
          {outcome === "never" ? (
            <Badge>{run.status}</Badge>
          ) : (
            <span data-testid="run-status">
              <StatusPill status={outcome as JobStatus} />
            </span>
          )}
        </div>

        {/* Run history for this policy */}
        {history.length > 1 && (
          <div className="rounded-lg border border-border/70 bg-surface p-4 shadow-sm">
            <p className="mb-2.5 text-[10px] uppercase tracking-wider text-fg-muted/60">Run history</p>
            <div className="flex items-end gap-1" data-testid="run-timeline">
              {[...history].reverse().map((r) => {
                const o = automationRunOutcome(r.status);
                return (
                  <a
                    key={r.id}
                    href={automationRunHref(r.id)}
                    title={`${r.status} · ${new Date(r.startedAt).toLocaleString()}`}
                    className={`h-6 w-2.5 rounded-sm transition-transform hover:scale-y-110 ${sparkColor(o)} ${
                      r.id === run.id ? "ring-2 ring-accent ring-offset-1 ring-offset-surface" : ""
                    }`}
                  />
                );
              })}
            </div>
          </div>
        )}

        {/* Counts */}
        <div className="grid grid-cols-2 divide-y divide-border/50 overflow-hidden rounded-lg border border-border/70 bg-surface sm:divide-y-0 sm:divide-x lg:grid-cols-5">
          <Metric label="Evaluated" value={run.evaluatedCount} />
          <Metric label="Planned" value={run.plannedCount} />
          <Metric label="Applied" value={run.appliedCount} tone={run.appliedCount > 0 ? "success" : "default"} />
          <Metric label="Failed" value={run.failedCount} tone={run.failedCount > 0 ? "danger" : "default"} />
          <Metric label="Duration" value={duration} />
        </div>
        <p className="text-[11px] text-fg-muted" data-testid="run-trigger">
          Started {TRIGGER_LABEL[run.trigger] ?? run.trigger}
          {run.mode === "audit" && " · Audit mode: nothing was changed in the tenant"}
          {run.emailSent && " · Summary email accepted by Microsoft Graph"}
        </p>

        {run.summaryText && (
          <div className="rounded-lg border border-border/70 bg-surface p-4 text-sm text-fg-muted" data-testid="run-summary">
            {run.summaryText}
          </div>
        )}
        {run.errorMessage && (
          <div
            className="rounded-lg border border-danger/25 border-l-2 border-l-danger bg-danger/5 p-4 text-sm"
            data-testid="run-error"
          >
            <div className="mb-1 flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-danger" />
              <strong className="text-xs uppercase tracking-wider text-danger">
                {run.status === "halted" ? "Run halted" : "Run failed"}
              </strong>
            </div>
            <p className="ml-3.5 text-fg-muted">{run.errorMessage}</p>
          </div>
        )}

        {/* Per-target changes */}
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Changes</CardTitle>
            <span className="text-xs text-fg-muted/60">{actions.length} targets</span>
          </CardHeader>
          <CardContent className="space-y-3">
            {actions.length === 0 ? (
              <p className="text-sm text-fg-muted">No targets needed a change in this run.</p>
            ) : (
              actions.map((a) => (
                <div key={a.id} className="rounded-lg border border-border/60 p-3" data-testid="run-action">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                        ACTION_TONE[a.status] ?? ACTION_TONE.skipped
                      }`}
                    >
                      {a.status.replace("_", " ")}
                    </span>
                    <span className="text-sm font-medium text-fg">{a.targetLabel}</span>
                    <Badge>{a.targetType}</Badge>
                    <Badge>{a.actionType}</Badge>
                  </div>
                  <p className="mt-1.5 text-xs text-fg-muted">{a.reason}</p>
                  {a.errorMessage && <p className="mt-1 text-xs text-danger">{a.errorMessage}</p>}
                  <div className="mt-2.5 grid gap-2 md:grid-cols-2">
                    <div>
                      <p className="mb-1 text-[10px] uppercase tracking-wider text-fg-muted/60">Before</p>
                      <Json value={a.beforeState} testId="action-before" />
                    </div>
                    <div>
                      <p className="mb-1 text-[10px] uppercase tracking-wider text-fg-muted/60">After</p>
                      <Json value={a.afterState} testId="action-after" />
                    </div>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Console */}
        <Card className="overflow-hidden border-border/40">
          <CardHeader>
            <CardTitle>Console</CardTitle>
            <span className="text-xs text-fg-muted/60">{logs.length} entries</span>
          </CardHeader>
          <CardContent className="p-0">
            <div className="max-h-[480px] overflow-auto bg-sidebar-bg p-4 font-mono text-xs leading-relaxed" data-testid="run-console">
              {logs.length === 0 ? (
                <span className="text-sidebar-fg-muted/50">no log entries</span>
              ) : (
                <div className="space-y-0.5">
                  {logs.map((l) => (
                    <div key={l.id} className="flex items-start gap-3 rounded px-2 py-1 hover:bg-white/[0.03]">
                      <span className="shrink-0 tabular-nums text-sidebar-fg-muted/50">
                        {new Date(l.timestamp).toLocaleTimeString()}
                      </span>
                      <span className={`${LEVEL_COLOR[l.level] ?? ""} shrink-0 text-[10px] font-semibold uppercase`}>
                        [{l.level}]
                      </span>
                      <span className="text-sidebar-fg-muted">{l.message}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
