import { jobsDao } from "@/db/dao/jobs";
import { executionsDao } from "@/db/dao/executions";
import { resolveCron } from "@/services/scheduler";
import { nextRuns } from "@/lib/cron";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, LinkButton, EmptyState, Badge } from "@/components/ui/primitives";
import { StatusPill, type JobStatus } from "@/components/ui/status-pill";
import { Metric } from "@/components/ui/metric";
import { JobActions } from "@/components/job-actions";

export const dynamic = "force-dynamic";

type Job = ReturnType<typeof jobsDao.findAll>[number];

function nextRunLabel(job: Job): string {
  if (job.status === "disabled") return "—";
  const expr = resolveCron(job);
  if (!expr) return "invalid schedule";
  const [next] = nextRuns(expr, 1);
  return next ? next.toLocaleString() : "—";
}

export default function DashboardPage() {
  const isBuild = process.env.NEXT_PHASE === "phase-production-build";
  const jobs = isBuild ? [] : jobsDao.findAll();
  const recent = isBuild ? [] : executionsDao.recent(200);

  const latestByJob = jobs.map((j) => ({ job: j, last: executionsDao.forJob(j.id, 1)[0] }));
  const tally = (s: string) => recent.filter((e) => e.status === s).length;
  const active = jobs.filter((j) => j.status === "active").length;

  return (
    <AppShell
      title="Dashboard"
      actions={<LinkButton href="/catalog" variant="primary" size="sm">+ New job</LinkButton>}
    >
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Jobs" value={jobs.length} hint={`${active} active`} />
        <Metric label="Successful runs" value={tally("success")} tone="success" />
        <Metric label="Suppressed" value={tally("suppressed")} tone="info" />
        <Metric label="Failed runs" value={tally("failed")} tone={tally("failed") ? "danger" : "default"} />
      </div>

      {jobs.length === 0 ? (
        <EmptyState
          title="No jobs configured yet"
          hint="Configure Microsoft 365 credentials in Settings, then create your first scheduled report from the Catalog."
          action={<LinkButton href="/catalog" variant="primary" size="sm">Browse catalog</LinkButton>}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {latestByJob.map(({ job, last }) => {
            const status: JobStatus = job.status === "disabled" ? "disabled" : ((last?.status as JobStatus) ?? "disabled");
            return (
              <Card key={job.id} data-testid="job-card" className="transition-shadow hover:shadow-elevated">
                <CardContent className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="truncate font-medium">{job.name}</h3>
                      <p className="mt-0.5 truncate text-xs text-fg-muted">{job.description || job.reportType}</p>
                    </div>
                    <StatusPill status={status} />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Badge>{job.reportType}</Badge>
                    <Badge>{job.scheduleType === "preset" ? job.schedulePreset : "cron"}</Badge>
                  </div>
                  <dl className="grid grid-cols-2 gap-y-1 text-xs text-fg-muted">
                    <dt>Last run</dt>
                    <dd className="text-right text-fg">{last ? new Date(last.startedAt).toLocaleString() : "never"}</dd>
                    <dt>Next run</dt>
                    <dd className="text-right text-fg">{nextRunLabel(job)}</dd>
                  </dl>
                  <div className="flex items-center justify-between border-t border-border pt-3">
                    <JobActions jobId={job.id} status={job.status} />
                    {last && (
                      <LinkButton href={`/executions/${last.id}`} variant="ghost" size="sm">
                        Logs
                      </LinkButton>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
