"use client";

import { cn } from "@/lib/utils";

interface MetricProps {
  label: string;
  value: string | number;
  hint?: string;
  trend?: { direction: "up" | "down" | "flat"; value: string };
  tone?: "default" | "success" | "warning" | "danger" | "info";
}

const TONE: Record<NonNullable<MetricProps["tone"]>, string> = {
  default: "text-fg",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  info: "text-info",
};

const ARROW = { up: "▲", down: "▼", flat: "■" } as const;

// Flat editorial stat cell — no card chrome, shadow, radius, or hover elevation.
// Large light numeral, tiny uppercase label below. Parents arrange these into a
// hairline-divided stat strip (dashboard) or use one inline (execution detail).
export function Metric({ label, value, hint, trend, tone = "default" }: MetricProps) {
  return (
    <div className="px-4 py-3">
      <div className="flex items-baseline gap-2.5">
        <span className={cn("text-4xl font-light tracking-tight tabular-nums", TONE[tone])}>
          {value}
        </span>
        {trend && (
          <span
            className={cn(
              "text-xs font-medium",
              trend.direction === "up"
                ? "text-danger"
                : trend.direction === "down"
                  ? "text-success"
                  : "text-fg-muted",
            )}
          >
            {ARROW[trend.direction]} {trend.value}
          </span>
        )}
      </div>
      <p className="mt-2 text-[10px] font-medium uppercase tracking-widest text-fg-muted">
        {label}
      </p>
      {hint && <p className="mt-1 text-[11px] leading-relaxed text-fg-muted/70">{hint}</p>}
    </div>
  );
}
