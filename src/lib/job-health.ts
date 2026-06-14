/**
 * Client-side job health + sparkline helpers (UX-H / UX-HL). Health is derived
 * from the last 3 execution outcomes; the sparkline colours the last N runs.
 * Pure functions — computed in the browser from the dashboard payload.
 */

export type Health = "healthy" | "warning" | "critical" | "unknown";

/** `statuses` newest-first. Healthy: last 3 ok · Warning: 1/3 failed · Critical: 2+/3 or last failed · Unknown: <3 runs. */
export function computeHealth(statuses: string[]): Health {
  if (statuses.length < 3) return "unknown";
  const last3 = statuses.slice(0, 3);
  const fails = last3.filter((s) => s === "failed").length;
  if (last3[0] === "failed" || fails >= 2) return "critical";
  if (fails === 1) return "warning";
  return "healthy";
}

export const HEALTH_META: Record<Health, { label: string; tone: string }> = {
  healthy: { label: "Healthy", tone: "bg-success/10 text-success border-success/20" },
  warning: { label: "Warning", tone: "bg-warning/10 text-warning border-warning/20" },
  critical: { label: "Critical", tone: "bg-danger/10 text-danger border-danger/20" },
  unknown: { label: "No data", tone: "bg-surface-2 text-fg-muted border-border/40" },
};

/** Tailwind background class for a single execution outcome dot in the sparkline. */
export function sparkColor(status: string): string {
  switch (status) {
    case "success":
      return "bg-success";
    case "suppressed":
    case "warning":
      return "bg-warning";
    case "failed":
      return "bg-danger";
    default:
      return "bg-fg-muted/40";
  }
}
