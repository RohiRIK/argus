import { notFound } from "next/navigation";
import { executionsDao, logsDao } from "@/db/dao/executions";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, LinkButton } from "@/components/ui/primitives";
import { StatusPill, type JobStatus } from "@/components/ui/status-pill";
import { Metric } from "@/components/ui/metric";

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
  const logs = logsDao.forExecution(id);
  const duration = execution.endedAt
    ? `${Math.round((new Date(execution.endedAt).getTime() - new Date(execution.startedAt).getTime()))} ms`
    : "—";

  return (
    <AppShell
      title="Execution"
      actions={
        execution.outputHtml ? (
          <LinkButton href={`/api/executions/${execution.id}/preview`} variant="outline" size="sm">
            View report ↗
          </LinkButton>
        ) : undefined
      }
    >
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-mono text-sm text-fg-muted">{execution.id}</p>
            <p className="text-xs text-fg-muted">{new Date(execution.startedAt).toLocaleString()}</p>
          </div>
          <StatusPill status={execution.status as JobStatus} />
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Metric label="Records" value={execution.recordsProcessed} />
          <Metric label="Graph latency" value={`${execution.graphApiLatencyMs} ms`} />
          <Metric label="Duration" value={duration} />
          <Metric label="Email" value={execution.emailSent ? "sent" : "no"} tone={execution.emailSent ? "success" : "default"} />
        </div>

        {execution.suppressionReason && (
          <div className="rounded-lg border border-info/30 bg-info/5 p-3 text-sm">
            <strong className="text-info">Suppressed:</strong> {execution.suppressionReason}
          </div>
        )}
        {execution.errorMessage && (
          <div className="rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm">
            <strong className="text-danger">Error:</strong> {execution.errorMessage}
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Console</CardTitle>
            <span className="text-xs text-fg-muted">{logs.length} entries</span>
          </CardHeader>
          <CardContent className="p-0">
            <div className="max-h-[480px] overflow-auto rounded-b-lg bg-[hsl(222_47%_5%)] p-4 font-mono text-xs leading-relaxed text-slate-300">
              {logs.length === 0 ? (
                <span className="opacity-50">no log entries</span>
              ) : (
                logs.map((l) => (
                  <div key={l.id} className="whitespace-pre-wrap">
                    <span className="opacity-40">{new Date(l.timestamp).toLocaleTimeString()} </span>
                    <span className={`${LEVEL_COLOR[l.level] ?? ""} font-semibold uppercase`}>[{l.level}]</span> {l.message}
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
