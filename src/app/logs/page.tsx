"use client";

import { useEffect, useState, useCallback } from "react";
import { AppShell } from "@/components/app-shell";
import { Button, Card, Select, EmptyState } from "@/components/ui/primitives";

interface LogRow {
  id: string;
  executionId: string;
  level: "info" | "warning" | "error";
  message: string;
  timestamp: string;
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

const PAGE_SIZE = 200;

export default function LogsPage() {
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [level, setLevel] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [total, setTotal] = useState<number | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const fetchPage = useCallback(
    async (cursor: string | null) => {
      const qs = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (level) qs.set("level", level);
      if (cursor) qs.set("cursor", cursor);
      const res = await fetch(`/api/logs?${qs.toString()}`);
      const body = await res.json();
      return body.success ? { rows: body.data as LogRow[], meta: (body.meta ?? {}) as LogsMeta } : null;
    },
    [level],
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
        <Select value={level} onChange={(e) => setLevel(e.target.value)} className="h-8 w-32 text-xs">
          <option value="">All levels</option>
          <option value="info">Info</option>
          <option value="warning">Warning</option>
          <option value="error">Error</option>
        </Select>
      }
    >
      {!loading && logs.length === 0 ? (
        <EmptyState title="No log entries" hint="Logs appear here after jobs execute." />
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
                      key={l.id}
                      href={`/executions/${l.executionId}`}
                      className="group flex items-start gap-3 rounded-md px-2 py-1 transition-colors hover:bg-white/[0.03]"
                    >
                      <span
                        className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase leading-none tracking-wider ${LEVEL_BADGE[l.level]}`}
                      >
                        {l.level}
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
