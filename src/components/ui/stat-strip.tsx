"use client";

import { cn } from "@/lib/utils";

export interface Stat {
  /** Stable key, also used as the filter value when the cell is actionable. */
  key: string;
  label: string;
  value: number | string;
  /** Optional status-dot color class (e.g. "bg-danger") shown before the value. */
  dot?: string;
  /** When true the value reads in the accent/danger tone to draw the eye (triage). */
  emphasize?: boolean;
}

/**
 * Horizontal, hairline-divided overview row. Each cell can be a button that the
 * parent uses as a filter shortcut — clicking "Failing" filters to failing.
 * Reads as one quiet instrument panel, not a grid of cards (Operator DNA).
 */
export function StatStrip({
  stats,
  activeKey,
  onSelect,
  className,
}: {
  stats: Stat[];
  activeKey?: string | null;
  onSelect?: (key: string) => void;
  className?: string;
}) {
  return (
    <div
      data-testid="stat-strip"
      className={cn(
        "grid grid-cols-2 divide-x divide-y divide-border/60 border border-border/60 sm:grid-cols-3 sm:divide-y-0 lg:grid-cols-5",
        className,
      )}
    >
      {stats.map((s) => {
        const actionable = Boolean(onSelect);
        const active = activeKey === s.key;
        const Cell = actionable ? "button" : "div";
        return (
          <Cell
            key={s.key}
            type={actionable ? "button" : undefined}
            onClick={actionable ? () => onSelect!(s.key) : undefined}
            data-testid={`stat-${s.key}`}
            aria-pressed={actionable ? active : undefined}
            className={cn(
              "flex flex-col gap-1.5 px-4 py-3 text-left transition-colors",
              actionable && "hover:bg-surface-2/50",
              active && "bg-surface-2",
            )}
          >
            <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
              {s.dot && <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} />}
              {s.label}
            </span>
            <span
              className={cn(
                "text-2xl font-light tabular-nums tracking-tight",
                s.emphasize && Number(s.value) > 0 ? "text-danger" : "text-fg",
              )}
            >
              {s.value}
            </span>
          </Cell>
        );
      })}
    </div>
  );
}
