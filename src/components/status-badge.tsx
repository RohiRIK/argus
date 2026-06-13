import { cn } from "@/lib/utils";

type Status = "success" | "warning" | "failed" | "disabled" | "suppressed";

const STYLES: Record<Status, { dot: string; label: string; text: string }> = {
  success: { dot: "bg-status-success", label: "Success", text: "text-status-success" },
  warning: { dot: "bg-status-warning", label: "Warning", text: "text-status-warning" },
  failed: { dot: "bg-status-failed", label: "Failed", text: "text-status-failed" },
  disabled: { dot: "bg-status-disabled", label: "Disabled", text: "text-status-disabled" },
  suppressed: { dot: "bg-status-suppressed", label: "Suppressed", text: "text-status-suppressed" },
};

/** Scannable status indicator — icon shape + label, not just a colored dot (PRD §9). */
export function StatusBadge({ status }: { status: Status }) {
  const s = STYLES[status];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium">
      <span className={cn("h-2 w-2 rounded-full ring-2 ring-offset-1 ring-current", s.dot, s.text)} />
      <span className={s.text}>{s.label}</span>
    </span>
  );
}
