import type { JobStatus } from "@/components/ui/status-pill";

/** Fields of an activity run that the shared formatters need. */
export interface RunLike {
  source: "report" | "automation";
  mode: "audit" | "enforce" | "rollback" | null;
  records: number;
  changes: number | null;
}

const PILL_STATUSES: readonly JobStatus[] = ["success", "warning", "failed", "suppressed", "interrupted", "halted"];

/** Map either source's run status onto the shared pill vocabulary. */
export function runPillStatus(status: string): JobStatus {
  if (status === "drift_detected") return "drift";
  return (PILL_STATUSES as readonly string[]).includes(status) ? (status as JobStatus) : "warning";
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** "128 rows" for reports; "40 checked · 3 planned" / "· 3 changed" for automations. */
export function runSummary(r: RunLike): string {
  if (r.source === "report") return `${r.records} row${r.records === 1 ? "" : "s"}`;
  const n = r.changes ?? 0;
  return `${r.records} checked · ${n} ${r.mode === "audit" ? "planned" : "changed"}`;
}
