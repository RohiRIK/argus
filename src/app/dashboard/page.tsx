import { jobsDao } from "@/db/dao/jobs";
import { executionsDao } from "@/db/dao/executions";
import { settingsDao } from "@/db/dao/settings";
import { resolveCron } from "@/services/scheduler";
import { nextRuns, formatInZone } from "@/lib/cron";
import { describeSchedule } from "@/lib/schedule";
import { AppShell } from "@/components/app-shell";
import { LinkButton, EmptyState } from "@/components/ui/primitives";
import { Metric } from "@/components/ui/metric";
import { DashboardClient, type JobCardData } from "@/components/dashboard-client";

export const dynamic = "force-dynamic";

type Job = ReturnType<typeof jobsDao.findAll>[number];

function nextRunLabel(job: Job, tz: string): string {
  if (job.status === "disabled") return "—";
  const expr = resolveCron(job);
  if (!expr) return "invalid schedule";
  const [next] = nextRuns(expr, 1, new Date(), tz);
  return next ? formatInZone(next, tz) : "—";
}

export default function DashboardPage() {
  const isBuild = process.env.NEXT_PHASE === "phase-production-build";
  const jobs = isBuild ? [] : jobsDao.findAll();
  const recent = isBuild ? [] : executionsDao.recent(200);
  const tz = isBuild ? "UTC" : settingsDao.get().timezone;

  const cards: JobCardData[] = jobs.map((job) => {
    const history = executionsDao.forJob(job.id, 20); // newest-first
    const last = history[0];
    return {
      id: job.id,
      name: job.name,
      description: job.description,
      reportType: job.reportType,
      status: job.status,
      tags: job.tags ?? [],
      scheduleSummary: describeSchedule(job.scheduleType, job.schedulePreset, job.cronExpression),
      nextRun: nextRunLabel(job, tz),
      lastRun: last ? { id: last.id, status: last.status, startedAt: last.startedAt } : null,
      recent: history.map((e) => e.status),
      snoozedUntil: job.snoozedUntil ?? null,
    };
  });

  const tally = (s: string) => recent.filter((e) => e.status === s).length;
  const active = jobs.filter((j) => j.status === "active").length;

  return (
    <AppShell
      title="Dashboard"
      actions={<LinkButton href="/catalog" variant="primary" size="sm">+ New job</LinkButton>}
    >
      {/* Metric cards */}
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Metric label="Jobs" value={jobs.length} hint={`${active} active`} />
        <Metric label="Successful runs" value={tally("success")} tone="success" />
        <Metric label="Suppressed" value={tally("suppressed")} tone="info" />
        <Metric label="Failed runs" value={tally("failed")} tone={tally("failed") ? "danger" : "default"} />
      </div>

      {cards.length === 0 ? (
        <EmptyState
          title="No jobs configured yet"
          hint="Configure Microsoft 365 credentials in Settings, then create your first scheduled report from the Catalog."
          action={<LinkButton href="/catalog" variant="primary" size="sm">Browse catalog</LinkButton>}
        />
      ) : (
        <>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-fg">Active jobs</h2>
            <span className="text-[10px] uppercase tracking-wider text-fg-muted/60">{cards.length} total</span>
          </div>
          <DashboardClient jobs={cards} />
        </>
      )}
    </AppShell>
  );
}
