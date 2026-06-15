/**
 * Pure snooze helpers. A snoozed job stays "active" but the scheduler skips its
 * fires until `snoozedUntil` (an ISO-8601 instant) passes — then it auto-resumes.
 */

export type SnoozeUnit = "hours" | "days";

const MS = { hours: 3_600_000, days: 86_400_000 } as const;

/** Compute the wake instant from now + a positive duration. Returns ISO-8601 UTC. */
export function computeSnoozeUntil(now: Date, amount: number, unit: SnoozeUnit): string {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Snooze amount must be a positive number.");
  return new Date(now.getTime() + amount * MS[unit]).toISOString();
}

/** Whether the job is currently snoozed (wake instant is in the future). */
export function isSnoozed(snoozedUntil: string | null | undefined, now: Date = new Date()): boolean {
  if (!snoozedUntil) return false;
  const until = Date.parse(snoozedUntil);
  return Number.isFinite(until) && until > now.getTime();
}
