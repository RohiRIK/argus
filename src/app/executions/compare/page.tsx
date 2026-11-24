import { notFound } from "next/navigation";
import { executionsDao, logsDao } from "@/db/dao/executions";
import { jobsDao } from "@/db/dao/jobs";
import { AppShell } from "@/components/app-shell";
import { LinkButton } from "@/components/ui/primitives";
import { StatusPill, type JobStatus } from "@/components/ui/status-pill";
import { diffExecutions } from "@/lib/compare";

export const dynamic = "force-dynamic";

function fmt(n: number | null): string {
  return n == null ? "—" : String(n);
}

function deltaTone(delta: number | null): string {
  if (delta == null || delta === 0) return "text-fg-muted/60";
  return delta > 0 ? "text-warning" : "text-success";
}

function CompareSide({
  label,
  e,
  job,
}: {
  label: string;
  e: NonNullable<ReturnType<typeof executionsDao.findById>>;
  job: ReturnType<typeof jobsDao.findById>;
}) {
  return (
    <div className="space-y-1 rounded-lg border border-border/60 bg-surface p-4">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted/60">{label}</span>
        <StatusPill status={e.status as JobStatus} />
      </div>
      {job && <p className="truncate text-sm font-semibold text-fg">{job.name}</p>}
      <p className="font-mono text-[11px] text-fg-muted/70">{e.id}</p>
      <p className="text-xs text-fg-muted/60">{new Date(e.startedAt).toLocaleString()}</p>
    </div>
  );
}

export default async function ComparePage({ searchParams }: { searchParams: Promise<{ a?: string; b?: string }> }) {
  if (process.env.NEXT_PHASE === "phase-production-build") return null;
  const { a, b } = await searchParams;
  if (!a || !b) notFound();

  const ea = executionsDao.findById(a);
  const eb = executionsDao.findById(b);
  if (!ea || !eb) notFound();

  const ja = jobsDao.findById(ea.jobId);
  const jb = jobsDao.findById(eb.jobId);
  const la = logsDao.forExecution(a);
  const lb = logsDao.forExecution(b);
  const diff = diffExecutions(ea, eb);

  return (
    <AppShell
      title="Compare executions"
      actions={<LinkButton href={`/executions/${a}`} variant="outline" size="sm">← Back</LinkButton>}
    >
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <CompareSide label="A" e={ea} job={ja} />
          <CompareSide label="B" e={eb} job={jb} />
        </div>

        {/* Metric diff */}
        <div className="rounded-lg border border-border/60 bg-surface p-4">
          <p className="mb-3 text-[10px] uppercase tracking-wider text-fg-muted/60">Metrics</p>
          <table className="w-full text-sm" data-testid="compare-metrics">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-fg-muted/50">
                <th className="pb-2 font-medium">Metric</th>
                <th className="pb-2 text-right font-medium">A</th>
                <th className="pb-2 text-right font-medium">B</th>
                <th className="pb-2 text-right font-medium">Δ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {diff.map((d) => (
                <tr key={d.key}>
                  <td className="py-1.5 font-mono text-xs text-fg-muted/80">{d.key}</td>
                  <td className="py-1.5 text-right tabular-nums text-fg">{fmt(d.a)}</td>
                  <td className="py-1.5 text-right tabular-nums text-fg">{fmt(d.b)}</td>
                  <td className={`py-1.5 text-right tabular-nums font-medium ${deltaTone(d.delta)}`}>
                    {d.delta == null ? "—" : d.delta > 0 ? `+${d.delta}` : String(d.delta)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Logs side by side */}
        <div className="grid gap-4 sm:grid-cols-2">
          {[{ label: "A", logs: la }, { label: "B", logs: lb }].map((side) => (
            <div key={side.label} className="overflow-hidden rounded-lg border border-border/60">
              <div className="border-b border-sidebar-border/40 bg-sidebar-bg px-3 py-2 text-[10px] uppercase tracking-wider text-sidebar-fg-muted/70">
                {side.label} · {side.logs.length} log entries
              </div>
              <div className="max-h-[360px] overflow-auto bg-sidebar-bg p-3 font-mono text-[11px] leading-relaxed">
                {side.logs.length === 0 ? (
                  <span className="text-sidebar-fg-muted/50">no log entries</span>
                ) : (
                  side.logs.map((l) => (
                    <div key={l.id} className="text-sidebar-fg-muted">
                      <span className="text-sidebar-fg-muted/50">[{l.level}]</span> {l.message}
                    </div>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
