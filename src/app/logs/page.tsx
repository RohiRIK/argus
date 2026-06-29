"use client";

import { useEffect, useState, useCallback } from "react";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, Select, EmptyState } from "@/components/ui/primitives";

interface LogRow {
  id: string;
  executionId: string;
  level: "info" | "warning" | "error";
  message: string;
  timestamp: string;
}

const LEVEL_COLOR: Record<string, string> = {
  info: "text-info",
  warning: "text-warning",
  error: "text-danger",
};

const LEVEL_BADGE: Record<string, string> = {
  info: "bg-info/10 text-info border-info/15",
  warning: "bg-warning/10 text-warning border-warning/15",
  error: "bg-danger/10 text-danger border-danger/15",
};

export default function LogsPage() {
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [level, setLevel] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const qs = level ? `?level=${level}` : "";
    const res = await fetch(`/api/logs${qs}`);
    const body = await res.json();
    if (body.success) setLogs(body.data);
    setLoading(false);
  }, [level]);

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
              <span className="text-[10px] font-medium uppercase tracking-widest text-sidebar-fg-muted/70">
                Console · {logs.length} entries
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
                      <span className="shrink-0 rounded border px-1 py-0.5 text-[9px] font-semibold uppercase leading-none tracking-wider"
                        style={{
                          borderColor: `hsl(var(--${l.level === "error" ? "danger" : l.level === "warning" ? "warning" : "info"}) / 0.2)`,
                          color: `hsl(var(--${l.level === "error" ? "danger" : l.level === "warning" ? "warning" : "info"}))`,
                        }}
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
            </div>
          </div>
        </Card>
      )}
    </AppShell>
  );
}
