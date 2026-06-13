import { cn } from "@/lib/utils";

export type JobStatus = "success" | "warning" | "failed" | "disabled" | "suppressed";

const STYLES: Record<JobStatus, { label: string; cls: string; glyph: string }> = {
  success: { label: "Success", cls: "bg-success/10 text-success ring-success/20", glyph: "✓" },
  warning: { label: "Warning", cls: "bg-warning/10 text-warning ring-warning/20", glyph: "!" },
  failed: { label: "Failed", cls: "bg-danger/10 text-danger ring-danger/20", glyph: "✕" },
  disabled: { label: "Disabled", cls: "bg-fg-muted/10 text-fg-muted ring-fg-muted/20", glyph: "—" },
  suppressed: { label: "Suppressed", cls: "bg-info/10 text-info ring-info/20", glyph: "◐" },
};

/** Scannable status pill — tinted background + glyph + label, not just a dot (PRD §9). */
export function StatusPill({ status, className }: { status: JobStatus; className?: string }) {
  const s = STYLES[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
        s.cls,
        className,
      )}
    >
      <span aria-hidden className="font-mono text-[10px]">{s.glyph}</span>
      {s.label}
    </span>
  );
}
