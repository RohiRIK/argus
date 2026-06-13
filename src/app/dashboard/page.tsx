import Link from "next/link";
import { jobsDao } from "@/db/dao/jobs";
import { executionsDao } from "@/db/dao/executions";
import { resolveCron } from "@/services/scheduler";
import { nextRuns } from "@/lib/cron";
import { StatusBadge } from "@/components/status-badge";
import { ThemeToggle } from "@/components/theme-toggle";
import { JobActions } from "@/components/job-actions";

export const dynamic = "force-dynamic";

function nextRunLabel(job: ReturnType<typeof jobsDao.findAll>[number]): string {
  if (job.status === "disabled") return "—";
  const expr = resolveCron(job);
  if (!expr) return "invalid schedule";
  const [next] = nextRuns(expr, 1);
  return next ? next.toLocaleString() : "—";
}

export default function DashboardPage() {
  // Next's build "collecting page data" step renders this server component once
  // under Node, where bun:sqlite is unavailable. Skip DB access during build;
  // force-dynamic guarantees a real render (under Bun) at request time.
  const jobs =
    process.env.NEXT_PHASE === "phase-production-build" ? [] : jobsDao.findAll();

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Jobs</h1>
          <p className="text-sm opacity-60">{jobs.length} configured</p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/settings"
            className="rounded-md border border-[hsl(var(--border))] px-3 py-1.5 text-xs hover:bg-[hsl(var(--muted))]"
          >
            Settings
          </Link>
          <ThemeToggle />
        </div>
      </header>

      {jobs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[hsl(var(--border))] p-12 text-center text-sm opacity-60">
          No jobs yet. Configure credentials in{" "}
          <Link href="/settings" className="underline">
            Settings
          </Link>{" "}
          and create one from the catalog.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {jobs.map((job) => {
            const last = executionsDao.forJob(job.id, 1)[0];
            const status = job.status === "disabled" ? "disabled" : (last?.status ?? "disabled");
            return (
              <article
                key={job.id}
                className="rounded-lg border border-[hsl(var(--border))] p-4 transition hover:shadow-sm"
              >
                <div className="mb-2 flex items-start justify-between">
                  <h2 className="font-medium">{job.name}</h2>
                  <StatusBadge status={status} />
                </div>
                <p className="mb-3 text-xs opacity-60">{job.description || job.reportType}</p>
                <dl className="mb-4 grid grid-cols-2 gap-1 text-xs opacity-70">
                  <dt>Last run</dt>
                  <dd className="text-right">{last ? new Date(last.startedAt).toLocaleString() : "never"}</dd>
                  <dt>Next run</dt>
                  <dd className="text-right">{nextRunLabel(job)}</dd>
                </dl>
                <JobActions jobId={job.id} status={job.status} />
              </article>
            );
          })}
        </div>
      )}
    </main>
  );
}
