import { jobsDao } from "@/db/dao/jobs";
import { executionsDao } from "@/db/dao/executions";
import { settingsDao } from "@/db/dao/settings";
import { resolveCron } from "@/services/scheduler";
import { nextRuns, formatInZone } from "@/lib/cron";
import { describeSchedule } from "@/lib/schedule";
import { AppShell } from "@/components/app-shell";
import { LinkButton, EmptyState } from "@/components/ui/primitives";
import { DashboardClient, type JobCardData } from "@/components/dashboard-client";

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

  const cards: JobCardData[] = jobs.map((job) => {
    const history = executionsDao.forJob(job.id, 20); // newest-first
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

  return (
    <AppShell
      title="Dashboard"
      actions={<LinkButton href="/catalog" variant="primary" size="sm">+ New job</LinkButton>}
    >
      {cards.length === 0 ? (
        <EmptyState
          title="No jobs configured yet"
          hint="Configure Microsoft 365 credentials in Settings, then create your first scheduled report from the Catalog."
          action={<LinkButton href="/catalog" variant="primary" size="sm">Browse catalog</LinkButton>}
        />
      ) : (
        <DashboardClient jobs={cards} />
      )}
    </AppShell>
  );
}
