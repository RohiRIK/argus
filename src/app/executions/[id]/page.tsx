import { notFound } from "next/navigation";
import { executionsDao, logsDao } from "@/db/dao/executions";
import { jobsDao } from "@/db/dao/jobs";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, LinkButton, Badge } from "@/components/ui/primitives";
import { StatusPill, type JobStatus } from "@/components/ui/status-pill";
import { Metric } from "@/components/ui/metric";
import { sparkColor } from "@/lib/job-health";

export const dynamic = "force-dynamic";

const LEVEL_COLOR: Record<string, string> = {
  info: "text-info",
  warning: "text-warning",
  error: "text-danger",
};

export default async function ExecutionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (process.env.NEXT_PHASE === "phase-production-build") return null;

  const execution = executionsDao.findById(id);
  if (!execution) notFound();
  const job = jobsDao.findById(execution.jobId);
  const history = executionsDao.forJob(execution.jobId, 20); // newest-first
  const idx = history.findIndex((e) => e.id === execution.id);
  const previous = idx >= 0 ? history[idx + 1] : undefined; // next-older run
  const logs = logsDao.forExecution(id);
  const duration = execution.endedAt
    ? `${Math.round((new Date(execution.endedAt).getTime() - new Date(execution.startedAt).getTime()))} ms`
    : "—";

  return (
    <AppShell
      title="Execution"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {execution.outputHtml && (
            <>
              <LinkButton href={`/api/executions/${execution.id}/preview`} variant="outline" size="sm">
                View report ↗
              </LinkButton>
              <LinkButton href={`/api/executions/${execution.id}/download?format=html`} variant="ghost" size="sm" data-testid="download-html">
                Download HTML
              </LinkButton>
            </>
          )}
          <LinkButton href={`/api/executions/${execution.id}/download?format=csv`} variant="ghost" size="sm" data-testid="download-csv">
            Download CSV
          </LinkButton>
          {previous && (
            <LinkButton
              href={`/executions/compare?a=${previous.id}&b=${execution.id}`}
              variant="ghost"
              size="sm"
              data-testid="compare-previous"
            >
              Compare with previous
            </LinkButton>
          )}
        </div>
      }
    >
      <div className="space-y-6">
        {/* Identity bar */}
        <div className="flex items-start justify-between border border-border/60 bg-surface p-4">
          <div className="min-w-0 space-y-1">
            {job && <p className="truncate text-sm font-semibold text-fg">{job.name}</p>}
            <p className="font-mono text-xs text-fg-muted/80">{execution.id}</p>
            <p className="text-xs text-fg-muted/60">{new Date(execution.startedAt).toLocaleString()}</p>
            {job && job.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1" data-testid="execution-tags">
                {job.tags.map((t) => (
                  <Badge key={t} className="border-accent/30 text-accent/90">{t}</Badge>
                ))}
              </div>
            )}
          </div>
          <StatusPill status={execution.status as JobStatus} />
        </div>

        {/* Run history timeline (UX-HL3) */}
        {history.length > 1 && (
          <div className="border border-border/60 bg-surface p-4">
            <p className="mb-2.5 text-[10px] uppercase tracking-wider text-fg-muted/60">Run history</p>
            <div className="flex items-end gap-1" data-testid="execution-timeline">
              {[...history].reverse().map((e) => (
                <a
                  key={e.id}
                  href={`/executions/${e.id}`}
                  title={`${e.status} · ${new Date(e.startedAt).toLocaleString()}`}
                  className={`h-6 w-2.5 rounded-sm transition-transform hover:scale-y-110 ${sparkColor(e.status)} ${
                    e.id === execution.id ? "ring-2 ring-accent ring-offset-1 ring-offset-surface" : ""
                  }`}
                />
              ))}
            </div>
          </div>
        )}

        {/* Metrics */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Metric label="Records" value={execution.recordsProcessed} />
          <Metric label="Graph latency" value={`${execution.graphApiLatencyMs} ms`} />
          <Metric label="Duration" value={duration} />
          <Metric label="Email" value={execution.emailSent ? "sent" : "no"} tone={execution.emailSent ? "success" : "default"} />
        </div>

        {/* Alerts */}
        {execution.suppressionReason && (
          <div className="border border-info/20 bg-info/5 p-4 text-sm">
            <div className="flex items-center gap-2 mb-1">
              <span className="h-1.5 w-1.5 rounded-full bg-info" />
              <strong className="text-info text-xs uppercase tracking-wider">Suppressed</strong>
            </div>
            <p className="text-fg-muted ml-3.5">{execution.suppressionReason}</p>
          </div>
        )}
        {execution.errorMessage && (
          <div className="border border-danger/20 bg-danger/5 p-4 text-sm">
            <div className="flex items-center gap-2 mb-1">
              <span className="h-1.5 w-1.5 rounded-full bg-danger" />
              <strong className="text-danger text-xs uppercase tracking-wider">Error</strong>
            </div>
            <p className="text-fg-muted ml-3.5">{execution.errorMessage}</p>
          </div>
        )}

        {/* Console */}
        <Card className="overflow-hidden border-border/40">
          <CardHeader>
            <CardTitle>Console</CardTitle>
            <span className="text-xs text-fg-muted/60">{logs.length} entries</span>
          </CardHeader>
          <CardContent className="p-0">
            <div className="max-h-[480px] overflow-auto bg-[hsl(222_47%_3%)] p-4 font-mono text-xs leading-relaxed">
              {logs.length === 0 ? (
                <span className="text-fg-muted/40">no log entries</span>
              ) : (
                <div className="space-y-0.5">
                  {logs.map((l) => (
                    <div key={l.id} className="flex items-start gap-3 rounded px-2 py-1 hover:bg-white/[0.02]">
                      <span className="shrink-0 text-fg-muted/40 tabular-nums">
                        {new Date(l.timestamp).toLocaleTimeString()}
                      </span>
                      <span className={`${LEVEL_COLOR[l.level] ?? ""} shrink-0 font-semibold uppercase text-[10px]`}>
                        [{l.level}]
                      </span>
                      <span className="text-fg-muted/80">{l.message}</span>
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
