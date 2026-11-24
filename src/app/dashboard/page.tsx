import { jobsDao } from "@/db/dao/jobs";
import { executionsDao } from "@/db/dao/executions";
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
import { DashboardClient, type JobCardData } from "@/components/dashboard-client";
import { OnboardingChecklist } from "@/components/onboarding-checklist";

export const dynamic = "force-dynamic";

type Job = ReturnType<typeof jobsDao.findAll>[number];

/** Next scheduled run as both a display label and an ISO timestamp (for sort + relative time). */
function nextRunInfo(job: Job, tz: string): { label: string; iso: string | null } {
  if (job.status === "disabled") return { label: "—", iso: null };
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

  const cards: JobCardData[] = jobs.map((job) => {
    const history = histories.get(job.id) ?? []; // newest-first
    const last = history[0];
    const next = nextRunInfo(job, tz);
    return {
      id: job.id,
      name: job.name,
      description: job.description,
      reportType: job.reportType,
      status: job.status,
      tags: job.tags ?? [],
      scheduleSummary: describeSchedule(job.scheduleType, job.schedulePreset, job.cronExpression),
      nextRun: next.label,
      nextRunAt: next.iso,
      lastRun: last ? { id: last.id, status: last.status, startedAt: last.startedAt } : null,
      recent: history.map((e) => e.status),
      snoozedUntil: job.snoozedUntil ?? null,
    };
  });

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
          title="No jobs configured yet"
          hint="Connect Microsoft 365 in Settings, then create your first scheduled report from the Catalog."
          action={<LinkButton href="/catalog" variant="primary" size="sm">Browse catalog</LinkButton>}
        />
      ) : (
        <DashboardClient jobs={cards} />
      )}
    </AppShell>
  );
}
