"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button, Card, Select, EmptyState } from "@/components/ui/primitives";
import { StatusPill } from "@/components/ui/status-pill";
import { RelativeTime } from "@/components/ui/relative-time";
import { cn } from "@/lib/utils";
import { formatDuration, runPillStatus, runSummary } from "@/lib/activity";

export interface RunRow {
  id: string;
  source: "report" | "automation";
  name: string;
  status: string;
  trigger: string | null;
  mode: "audit" | "enforce" | "rollback" | null;
  startedAt: string;
  durationMs: number | null;
  records: number;
  changes: number | null;
  errorMessage: string | null;
  href: string;
}

const SOURCE_CLS: Record<RunRow["source"], string> = {
  report: "border-border/70 text-fg-muted",
  automation: "border-primary/40 text-primary",
};

const PAGE_SIZE = 50;

/** One table for report executions and automation runs, newest first. */
export function ActivityRuns({ initialSource = "all" }: { initialSource?: "all" | "report" | "automation" }) {
  const [rows, setRows] = useState<RunRow[]>([]);
  const [source, setSource] = useState<string>(initialSource);
  const [outcome, setOutcome] = useState("all");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [total, setTotal] = useState<number | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const fetchPage = useCallback(
    async (cursor: string | null) => {
      const qs = new URLSearchParams({ limit: String(PAGE_SIZE), source, outcome });
      if (cursor) qs.set("cursor", cursor);
      const res = await fetch(`/api/runs?${qs.toString()}`);
      const body = await res.json();
      return body.success
        ? { rows: body.data as RunRow[], total: (body.meta?.total ?? null) as number | null, next: (body.meta?.nextCursor ?? null) as string | null }
        : null;
    },
    [source, outcome],
  );

  useEffect(() => {
    let cancelled = false;
    void fetchPage(null).then((page) => {
      if (cancelled) return;
      if (page) {
        setRows(page.rows);
        setTotal(page.total);
        setNextCursor(page.next);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchPage]);

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    const page = await fetchPage(nextCursor);
    if (page) {
      setRows((prev) => [...prev, ...page.rows]);
      setTotal(page.total);
      setNextCursor(page.next);
    }
    setLoadingMore(false);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={source}
          onChange={(e) => {
            setLoading(true);
            setSource(e.target.value);
          }}
          aria-label="Filter runs by source"
          data-testid="run-source-filter"
          className="h-8 w-40 py-0 text-xs"
        >
          <option value="all">Reports & automations</option>
          <option value="report">Reports</option>
          <option value="automation">Automations</option>
        </Select>
        <Select
          value={outcome}
          onChange={(e) => {
            setLoading(true);
            setOutcome(e.target.value);
          }}
          aria-label="Filter runs by outcome"
          data-testid="run-outcome-filter"
          className="h-8 w-40 py-0 text-xs"
        >
          <option value="all">Any outcome</option>
          <option value="ok">Succeeded</option>
          <option value="attention">Needs attention</option>
          <option value="failed">Failed</option>
        </Select>
        {total !== null && (
          <span className="ml-auto text-[11px] text-fg-muted" data-testid="run-count">
            {rows.length}
            {total !== rows.length ? ` of ${total}` : ""} runs
          </span>
        )}
      </div>

      {!loading && rows.length === 0 ? (
        <EmptyState title="No runs yet" hint="Report jobs and automation policies show up here every time they run." />
      ) : (
        <Card className="overflow-hidden border-border/50">
          <div className="divide-y divide-border/40" data-testid="run-list">
            {loading ? (
              <p className="px-4 py-6 text-xs text-fg-muted">Loading…</p>
            ) : (
              rows.map((r) => (
                <Link
                  key={`${r.source}:${r.id}`}
                  href={r.href}
                  data-testid="run-row"
                  data-source={r.source}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-xs transition-colors hover:bg-surface-2/40"
                >
                  <StatusPill status={runPillStatus(r.status)} className="w-[104px] justify-center" />
                  <span
                    className={cn(
                      "w-[78px] shrink-0 rounded border px-1.5 py-0.5 text-center text-[9px] font-semibold uppercase tracking-wider",
                      SOURCE_CLS[r.source],
                    )}
                  >
                    {r.source === "report" ? "Report" : "Automation"}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium text-fg" title={r.errorMessage ?? undefined}>
                    {r.name}
                    {r.mode && (
                      <span className="ml-2 text-[10px] font-normal capitalize text-fg-muted">{r.mode}</span>
                    )}
                  </span>
                  <span className="w-[150px] text-right font-mono text-[11px] text-fg-muted">{runSummary(r)}</span>
                  <span className="w-[56px] text-right font-mono text-[11px] text-fg-muted">{formatDuration(r.durationMs)}</span>
                  <span className="w-[72px] text-right text-[11px] capitalize text-fg-muted">{r.trigger ?? "—"}</span>
                  <RelativeTime iso={r.startedAt} className="w-[80px] text-right text-[11px] text-fg-muted" />
                </Link>
              ))
            )}
          </div>
          {!loading && nextCursor && (
            <div className="flex justify-center border-t border-border/40 p-3">
              <Button variant="ghost" size="sm" onClick={() => void loadMore()} disabled={loadingMore} data-testid="runs-load-more">
                {loadingMore ? "Loading…" : "Load more"}
              </Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
