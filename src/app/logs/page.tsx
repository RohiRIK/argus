"use client";

import { useEffect, useState, useCallback } from "react";
import { AppShell } from "@/components/app-shell";
import { Button, Card, Select, EmptyState } from "@/components/ui/primitives";

interface LogRow {
  id: string;
  source: "report" | "automation";
  executionId: string | null;
  runId: string | null;
  level: "info" | "warning" | "error";
  message: string;
  timestamp: string;
  href: string | null;
}

interface LogsMeta {
  total?: number;
  hasMore?: boolean;
  nextCursor?: string | null;
}

const LEVEL_BADGE: Record<LogRow["level"], string> = {
  info: "border-info/30 text-info",
  warning: "border-warning/30 text-warning",
  error: "border-danger/30 text-danger",
};

const SOURCE_TAG: Record<LogRow["source"], { label: string; cls: string }> = {
  report: { label: "Report", cls: "border-sidebar-border/70 text-sidebar-fg-muted/80" },
  automation: { label: "Automation", cls: "border-primary/40 text-primary" },
};

const PAGE_SIZE = 200;

export default function LogsPage() {
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [level, setLevel] = useState("");
  const [source, setSource] = useState("all");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [total, setTotal] = useState<number | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const fetchPage = useCallback(
    async (cursor: string | null) => {
      const qs = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (level) qs.set("level", level);
      if (source !== "all") qs.set("source", source);
      if (cursor) qs.set("cursor", cursor);
      const res = await fetch(`/api/logs?${qs.toString()}`);
      const body = await res.json();
      return body.success ? { rows: body.data as LogRow[], meta: (body.meta ?? {}) as LogsMeta } : null;
    },
    [level, source],
  );

  const load = useCallback(async () => {
    setLoading(true);
    const page = await fetchPage(null);
    if (page) {
      setLogs(page.rows);
      setTotal(page.meta.total ?? null);
      setNextCursor(page.meta.nextCursor ?? null);
    }
    setLoading(false);
  }, [fetchPage]);

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    const page = await fetchPage(nextCursor);
    if (page) {
      setLogs((prev) => [...prev, ...page.rows]);
      setTotal(page.meta.total ?? null);
      setNextCursor(page.meta.nextCursor ?? null);
    }
    setLoadingMore(false);
  }

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <AppShell
      title="Logs"
      actions={
        <div className="flex items-center gap-2">
          <Select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            aria-label="Filter by source"
            data-testid="log-source-filter"
            className="h-8 w-36 text-xs"
          >
            <option value="all">All sources</option>
            <option value="report">Reports</option>
            <option value="automation">Automations</option>
          </Select>
          <Select value={level} onChange={(e) => setLevel(e.target.value)} aria-label="Filter by level" className="h-8 w-32 text-xs">
            <option value="">All levels</option>
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="error">Error</option>
          </Select>
        </div>
      }
    >
      {!loading && logs.length === 0 ? (
        <EmptyState title="No log entries" hint="Logs appear here after report jobs and automation policies run." />
      ) : (
        <Card className="overflow-hidden border-border/40">
          <div className="max-h-[72vh] overflow-auto">
            {/* Minimal console header — warm carbon recess (theme-stable) */}
            <div className="sticky top-0 z-10 border-b border-sidebar-border/40 bg-sidebar-bg px-4 py-2.5">
              <span className="text-[10px] font-medium uppercase tracking-widest text-sidebar-fg-muted/70" data-testid="log-count">
                Console · {logs.length}
                {total !== null && total !== logs.length ? ` of ${total}` : ""} entries
              </span>
            </div>
            {/* Log entries */}
            <div data-testid="log-console" className="bg-sidebar-bg p-4 font-mono text-xs leading-relaxed">
              {loading ? (
                <span className="text-sidebar-fg-muted/50">loading…</span>
              ) : (
                <div className="space-y-0.5">
                  {logs.map((l) => (
                    <a
                      key={`${l.source}:${l.id}`}
                      href={l.href ?? undefined}
                      data-testid="log-line"
                      data-source={l.source}
                      className="group flex items-start gap-3 rounded-md px-2 py-1 transition-colors hover:bg-white/[0.03]"
                    >
                      <span
                        className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase leading-none tracking-wider ${LEVEL_BADGE[l.level]}`}
                      >
                        {l.level}
                      </span>
                      <span
                        data-testid="log-source-tag"
                        className={`w-[74px] shrink-0 rounded border px-1.5 py-0.5 text-center text-[9px] font-semibold uppercase leading-none tracking-wider ${SOURCE_TAG[l.source].cls}`}
                      >
                        {SOURCE_TAG[l.source].label}
                      </span>
                      <span className="shrink-0 text-sidebar-fg-muted/40 tabular-nums">
                        {new Date(l.timestamp).toLocaleString()}
                      </span>
                      <span className="text-sidebar-fg-muted/70 group-hover:text-sidebar-fg transition-colors">
                        {l.message}
                      </span>
                    </a>
                  ))}
                </div>
              )}
              {!loading && nextCursor && (
                <div className="mt-3 flex justify-center">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="border border-sidebar-border/60 font-sans text-sidebar-fg-muted hover:bg-white/[0.04] hover:text-sidebar-fg"
                    onClick={() => void loadMore()}
                    disabled={loadingMore}
                    data-testid="logs-load-more"
                  >
                    {loadingMore ? "Loading…" : "Load more"}
                  </Button>
                </div>
              )}
            </div>
          </div>
        </Card>
      )}
    </AppShell>
  );
}
