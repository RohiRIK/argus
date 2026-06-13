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

export function Metric({ label, value, hint, trend, tone = "default" }: MetricProps) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4 shadow-card">
      <p className="text-xs font-medium text-fg-muted">{label}</p>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span className={cn("text-2xl font-semibold tracking-tight tabular-nums", TONE[tone])}>{value}</span>
        {trend && (
          <span
            className={cn(
              "text-xs font-medium",
              trend.direction === "up" ? "text-danger" : trend.direction === "down" ? "text-success" : "text-fg-muted",
            )}
          >
            {ARROW[trend.direction]} {trend.value}
          </span>
        )}
      </div>
      {hint && <p className="mt-1 text-[11px] text-fg-muted">{hint}</p>}
    </div>
  );
}
