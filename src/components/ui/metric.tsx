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

const TONE_BG: Record<NonNullable<MetricProps["tone"]>, string> = {
  default: "bg-primary/5",
  success: "bg-success/5",
  warning: "bg-warning/5",
  danger: "bg-danger/5",
  info: "bg-info/5",
};

const TONE_GLOW: Record<NonNullable<MetricProps["tone"]>, string> = {
  default: "shadow-glow-primary",
  success: "",
  warning: "",
  danger: "",
  info: "",
};

const ARROW = { up: "▲", down: "▼", flat: "■" } as const;

export function Metric({ label, value, hint, trend, tone = "default" }: MetricProps) {
  return (
    <div
      className={cn(
        "group relative rounded-xl border border-border/60 bg-surface p-4 shadow-sm",
        "transition-all duration-200 hover:shadow-elevated hover:border-border/80",
      )}
    >
      {/* Top accent line */}
      <span className={cn(
        "absolute top-0 left-3 right-3 h-0.5 rounded-full opacity-80",
        TONE_BG[tone],
      )} />

      <p className="text-[11px] font-medium uppercase tracking-wider text-fg-muted/80">
        {label}
      </p>
      <div className="mt-2 flex items-baseline gap-2.5">
        <span
          className={cn(
            "text-3xl font-semibold tracking-tight tabular-nums",
            TONE[tone],
          )}
        >
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
      {hint && (
        <p className="mt-1.5 text-[11px] text-fg-muted/70 leading-relaxed">
          {hint}
        </p>
      )}
    </div>
  );
}
