import { cn } from "@/lib/utils";

export type JobStatus = "success" | "warning" | "failed" | "disabled" | "suppressed";

/** Single source of truth for status → label / pill classes / glyph / dot color.
 *  Reused by StatusPill, the dashboard overview strip, and any status surface. */
export const STATUS_META: Record<
  JobStatus,
  { label: string; cls: string; glyph: string; dot: string }
> = {
  success: {
    label: "Success",
    cls: "bg-success/8 text-success border-success/15",
    glyph: "✓",
    dot: "bg-success",
  },
  warning: {
    label: "Warning",
    cls: "bg-warning/8 text-warning border-warning/15",
    glyph: "!",
    dot: "bg-warning",
  },
  failed: {
    label: "Failed",
    cls: "bg-danger/8 text-danger border-danger/15",
    glyph: "✕",
    dot: "bg-danger",
  },
  disabled: {
    label: "Disabled",
    cls: "bg-fg-muted/8 text-fg-muted border-fg-muted/15",
    glyph: "—",
    dot: "bg-fg-muted",
  },
  suppressed: {
    label: "Suppressed",
    cls: "bg-info/8 text-info border-info/15",
    glyph: "◐",
    dot: "bg-info",
  },
};

export function StatusPill({ status, className }: { status: JobStatus; className?: string }) {
  const s = STATUS_META[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-semibold",
        "transition-all duration-200",
        s.cls,
        className,
      )}
    >
      <span aria-hidden className="font-mono text-[10px]">{s.glyph}</span>
      {s.label}
    </span>
  );
}
