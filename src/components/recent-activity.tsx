import Link from "next/link";
import { Card } from "@/components/ui/primitives";
import { StatusPill } from "@/components/ui/status-pill";
import { RelativeTime } from "@/components/ui/relative-time";
import { runPillStatus, runSummary } from "@/lib/activity";
import { executionHref, automationRunHref } from "@/lib/work-items";
import type { ActivityRun } from "@/db/dao/activity-runs";

/** Dashboard card: the latest report and automation runs in one list. */
export function RecentActivity({ runs }: { runs: ActivityRun[] }) {
  if (runs.length === 0) return null;
  return (
    <Card className="mt-6 overflow-hidden border-border/50" data-testid="recent-activity">
      <div className="flex items-center justify-between border-b border-border/40 px-4 py-2.5">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Recent activity</h2>
        <Link href="/activity" className="text-[11px] font-medium text-primary hover:underline">
          All activity →
        </Link>
      </div>
      <ul className="divide-y divide-border/40">
        {runs.map((r) => (
          <li key={`${r.source}:${r.id}`}>
            <Link
              href={r.source === "report" ? executionHref(r.id) : automationRunHref(r.id)}
              data-testid="recent-activity-row"
              data-source={r.source}
              className="flex items-center gap-3 px-4 py-2 text-xs transition-colors hover:bg-surface-2/40"
            >
              <StatusPill status={runPillStatus(r.status)} className="w-[104px] justify-center" />
              <span className="w-[70px] shrink-0 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
                {r.source === "report" ? "Report" : "Automation"}
              </span>
              <span className="min-w-0 flex-1 truncate font-medium text-fg">{r.name}</span>
              <span className="hidden font-mono text-[11px] text-fg-muted sm:inline">{runSummary(r)}</span>
              <RelativeTime iso={r.startedAt} className="w-[72px] text-right text-[11px] text-fg-muted" />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
