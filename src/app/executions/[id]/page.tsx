import Link from "next/link";
import { notFound } from "next/navigation";
import { executionsDao, logsDao } from "@/db/dao/executions";
import { StatusBadge } from "@/components/status-badge";

export const dynamic = "force-dynamic";

const LEVEL_COLOR: Record<string, string> = {
  info: "text-status-suppressed",
  warning: "text-status-warning",
  error: "text-status-failed",
};

export default function ExecutionPage({ params }: { params: { id: string } }) {
  if (process.env.NEXT_PHASE === "phase-production-build") return null;

  const execution = executionsDao.findById(params.id);
  if (!execution) notFound();
  const logs = logsDao.forExecution(params.id);

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <Link href="/dashboard" className="text-xs underline underline-offset-4 opacity-70">
            ← Dashboard
          </Link>
          <h1 className="mt-1 font-mono text-lg">Execution {execution.id.slice(0, 8)}</h1>
        </div>
        <StatusBadge status={execution.status} />
      </header>

      <dl className="mb-6 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <Stat label="Started" value={new Date(execution.startedAt).toLocaleString()} />
        <Stat label="Records" value={String(execution.recordsProcessed)} />
        <Stat label="Graph latency" value={`${execution.graphApiLatencyMs} ms`} />
        <Stat label="Email sent" value={execution.emailSent ? "yes" : "no"} />
      </dl>

      {execution.suppressionReason && (
        <p className="mb-4 rounded-md bg-status-suppressed/10 p-3 text-sm">
          <strong>Suppressed:</strong> {execution.suppressionReason}
        </p>
      )}
      {execution.errorMessage && (
        <p className="mb-4 rounded-md bg-status-failed/10 p-3 text-sm">
          <strong>Error:</strong> {execution.errorMessage}
        </p>
      )}

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-medium">Console</h2>
        <div className="rounded-lg bg-[hsl(222_47%_7%)] p-4 font-mono text-xs leading-relaxed text-slate-200">
          {logs.length === 0 ? (
            <span className="opacity-50">no log entries</span>
          ) : (
            logs.map((l) => (
              <div key={l.id}>
                <span className="opacity-40">{new Date(l.timestamp).toLocaleTimeString()} </span>
                <span className={`${LEVEL_COLOR[l.level] ?? ""} uppercase`}>[{l.level}]</span> {l.message}
              </div>
            ))
          )}
        </div>
      </section>

      {execution.outputHtml && (
        <a
          href={`/api/executions/${execution.id}/preview`}
          target="_blank"
          rel="noreferrer"
          className="text-xs underline underline-offset-4"
        >
          View generated report ↗
        </a>
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[hsl(var(--border))] p-2">
      <dt className="opacity-50">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
