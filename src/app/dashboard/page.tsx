import { jobsDao } from "@/db/dao/jobs";
import { executionsDao } from "@/db/dao/executions";
import { automationPoliciesDao, automationRunsDao } from "@/db/dao/automations";
import { getAutomation } from "@/services/automations/registry";
import { reportWorkItem, automationWorkItem, type WorkItem } from "@/lib/work-items";
import { settingsDao } from "@/db/dao/settings";
import { integrationsDao } from "@/db/dao/integrations";
import { hasMasterKey } from "@/config/env";
import { vaultService } from "@/services/vault/vault";
import { requiredScopes } from "@/services/graph/connection-test";
import { resolveCron } from "@/services/scheduler";
import { nextRuns, formatInZone } from "@/lib/cron";
import { describeSchedule } from "@/lib/schedule";
import { AppShell } from "@/components/app-shell";
import { LinkButton, EmptyState } from "@/components/ui/primitives";
import { DashboardClient } from "@/components/dashboard-client";
import { OnboardingChecklist } from "@/components/onboarding-checklist";
import { RecentActivity } from "@/components/recent-activity";
import { activityRunsDao } from "@/db/dao/activity-runs";

export const dynamic = "force-dynamic";

type Job = ReturnType<typeof jobsDao.findAll>[number];
type Policy = ReturnType<typeof automationPoliciesDao.findAll>[number];

/** Next scheduled run as both a display label and an ISO timestamp (for sort + relative time). */
function nextRunInfo(job: Job | Policy, tz: string): { label: string; iso: string | null } {
  if (job.status === "disabled") return { label: "—", iso: null };
  if (job.scheduleType === "manual") return { label: "manual only", iso: null };
  const expr = resolveCron(job);
  if (!expr) return { label: "invalid schedule", iso: null };
  const [next] = nextRuns(expr, 1, new Date(), tz);
  return next ? { label: formatInZone(next, tz), iso: next.toISOString() } : { label: "—", iso: null };
}

export default function DashboardPage() {
  const isBuild = process.env.NEXT_PHASE === "phase-production-build";
  const jobs = isBuild ? [] : jobsDao.findAll();
  const tz = isBuild ? "UTC" : settingsDao.get().timezone;
  const histories = isBuild
    ? new Map<string, Array<{ id: string; status: "success" | "warning" | "failed" | "suppressed"; startedAt: string }>>()
    : executionsDao.recentStatusesByJobIds(jobs.map((j) => j.id), 20);

  const policies = isBuild ? [] : automationPoliciesDao.findAll();
  const runHistories = isBuild
    ? new Map<string, Array<{ id: string; status: string; startedAt: string }>>()
    : automationRunsDao.recentStatusesByPolicyIds(policies.map((p) => p.id), 20);

  const schedule = (item: Job | Policy) => {
    const next = nextRunInfo(item, tz);
    return {
      scheduleSummary:
        item.scheduleType === "manual"
          ? "Manual only"
          : describeSchedule(item.scheduleType, item.schedulePreset, item.cronExpression),
      nextRun: next.label,
      nextRunAt: next.iso,
    };
  };

  // Report jobs and automation policies share one list (same columns, filters, counters).
  const cards: WorkItem[] = [
    ...jobs.map((job) => reportWorkItem(job, histories.get(job.id) ?? [], schedule(job))),
    ...policies.map((p) =>
      automationWorkItem(p, runHistories.get(p.id) ?? [], schedule(p), getAutomation(p.automationType)?.name),
    ),
  ];

  const settings = isBuild ? null : settingsDao.get();
  const m365 = isBuild ? undefined : integrationsDao.findByProvider("microsoft365");
  const cfg = (m365?.config ?? {}) as Record<string, unknown>;
  const grantedScopes = Array.isArray(cfg.grantedScopes) ? (cfg.grantedScopes as string[]) : [];
  const onboarding = isBuild
    ? null
    : {
        masterKeyPresent: hasMasterKey(),
        vaultConfigured: vaultService.isConfigured(),
        integrationStatus: (m365?.status ?? "disconnected") as "connected" | "disconnected" | "error",
        tenantDisplayName: typeof cfg.tenantDisplayName === "string" ? cfg.tenantDisplayName : undefined,
        primaryDomain: typeof cfg.primaryDomain === "string" ? cfg.primaryDomain : undefined,
        grantedCount: grantedScopes.length,
        requiredCount: requiredScopes().length,
        hasMailSend: settings?.permissionStatus === "ok" || grantedScopes.includes("Mail.Send"),
        jobsCount: jobs.length,
      };

  return (
    <AppShell
      title="Dashboard"
      actions={<LinkButton href="/catalog" variant="primary" size="sm">+ New job</LinkButton>}
    >
      {onboarding && <OnboardingChecklist state={onboarding} />}
      {cards.length === 0 ? (
        <EmptyState
          title="No jobs or automations yet"
          hint="Connect Microsoft 365 in Settings, then create your first scheduled report from the Catalog or a policy from Automations."
          action={<LinkButton href="/catalog" variant="primary" size="sm">Browse catalog</LinkButton>}
        />
      ) : (
        <>
          <DashboardClient jobs={cards} />
          <RecentActivity runs={isBuild ? [] : activityRunsDao.page({}, { limit: 8 }).rows} />
        </>
      )}
    </AppShell>
  );
}
