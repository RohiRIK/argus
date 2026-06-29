import type { MaintenanceWindow } from "@/db/schema";

/**
 * Maintenance-window evaluation (spec-alerting). Pure + server-free so it can be
 * shared by the executor, API validation, and tests. Recurring windows are weekly
 * (dayOfWeek + minute range) evaluated in the tenant's configured timezone; one-off
 * windows are absolute UTC ranges.
 */

export const MAX_RECURRING_MINUTES = 24 * 60; // a recurring window may not exceed 24h
export const MAX_ONEOFF_DAYS = 30; // a one-off window may not exceed 30 days

const SHORT_DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Day-of-week (0=Sun) and minutes-from-midnight for `now` in the given IANA timezone. */
export function localParts(now: Date, timezone: string): { dow: number; minutes: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const dow = SHORT_DOW[get("weekday")] ?? 0;
  // "24" can appear at midnight in some runtimes — normalize to 0.
  const hour = Number(get("hour")) % 24;
  const minutes = hour * 60 + Number(get("minute"));
  return { dow, minutes };
}

function inRecurringWindow(w: MaintenanceWindow, now: Date, timezone: string): boolean {
  if (w.dayOfWeek == null || w.startMinute == null || w.endMinute == null) return false;
  const { dow, minutes } = localParts(now, timezone);
  return dow === w.dayOfWeek && minutes >= w.startMinute && minutes < w.endMinute;
}

function inOneoffWindow(w: MaintenanceWindow, now: Date): boolean {
  if (!w.startsAt || !w.endsAt) return false;
  const t = now.getTime();
  return t >= Date.parse(w.startsAt) && t < Date.parse(w.endsAt);
}

export interface MuteResult {
  muted: boolean;
  /** Name of the first active window (for the suppression reason/log). */
  reason?: string;
}

/** Whether `now` falls inside any enabled maintenance window. */
export function isMuted(windows: MaintenanceWindow[], now: Date, timezone: string): MuteResult {
  for (const w of windows) {
    if (!w.enabled) continue;
    const active = w.kind === "recurring" ? inRecurringWindow(w, now, timezone) : inOneoffWindow(w, now);
    if (active) return { muted: true, reason: w.name };
  }
  return { muted: false };
}

/**
 * Validate a window before persisting (S1/S3 — capped length, no wrap, valid shape).
 * Returns a list of human-readable errors; empty = valid.
 */
export function validateWindow(w: Partial<MaintenanceWindow>): string[] {
  const errs: string[] = [];
  if (!w.name?.trim()) errs.push("name is required");
  if (w.kind === "recurring") {
    if (w.dayOfWeek == null || w.dayOfWeek < 0 || w.dayOfWeek > 6) errs.push("dayOfWeek must be 0–6");
    if (w.startMinute == null || w.startMinute < 0 || w.startMinute >= 1440) errs.push("startMinute must be 0–1439");
    if (w.endMinute == null || w.endMinute <= 0 || w.endMinute > 1440) errs.push("endMinute must be 1–1440");
    if (w.startMinute != null && w.endMinute != null) {
      if (w.endMinute <= w.startMinute) errs.push("endMinute must be after startMinute (no overnight wrap in v1)");
      else if (w.endMinute - w.startMinute > MAX_RECURRING_MINUTES) errs.push(`recurring window may not exceed ${MAX_RECURRING_MINUTES} minutes`);
    }
  } else if (w.kind === "oneoff") {
    const s = w.startsAt ? Date.parse(w.startsAt) : NaN;
    const e = w.endsAt ? Date.parse(w.endsAt) : NaN;
    if (Number.isNaN(s)) errs.push("startsAt must be a valid ISO timestamp");
    if (Number.isNaN(e)) errs.push("endsAt must be a valid ISO timestamp");
    if (!Number.isNaN(s) && !Number.isNaN(e)) {
      if (e <= s) errs.push("endsAt must be after startsAt");
      else if (e - s > MAX_ONEOFF_DAYS * 86_400_000) errs.push(`one-off window may not exceed ${MAX_ONEOFF_DAYS} days`);
    }
  } else {
    errs.push("kind must be 'recurring' or 'oneoff'");
  }
  return errs;
}
