/**
 * Human-readable schedule helpers for the job UI (UX-PS spec). Resolves a job's
 * preset/cron selection to a cron expression and a plain-English summary so the
 * Dashboard cards and creation form can show "Every weekday at 9:00 AM" instead
 * of raw cron. Pure functions — safe to import in client components.
 */

import { SCHEDULE_PRESETS, isValidCron } from "./cron";

export type ScheduleType = "preset" | "cron";

const PRESET_LABELS: Record<string, string> = {
  hourly: "Every hour",
  daily: "Every day at 8:00 AM",
  weekly: "Every Monday at 8:00 AM",
  monthly: "On the 1st of each month at 8:00 AM",
  business_days: "Every weekday at 8:00 AM",
  weekends: "Every weekend at 8:00 AM",
};

/** Ordered preset keys for select/segmented controls. */
export const PRESET_KEYS = Object.keys(SCHEDULE_PRESETS);

/** Resolve a schedule selection to a 5-field cron expression, or null if invalid. */
export function resolveScheduleCron(
  scheduleType: ScheduleType,
  schedulePreset: string | null | undefined,
  cronExpression: string | null | undefined,
): string | null {
  if (scheduleType === "preset") {
    return schedulePreset ? SCHEDULE_PRESETS[schedulePreset] ?? null : null;
  }
  return cronExpression && isValidCron(cronExpression) ? cronExpression : null;
}

const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function describeCron(expr: string): string {
  // Reuse a preset phrase when the cron matches a known preset value.
  for (const [key, value] of Object.entries(SCHEDULE_PRESETS)) {
    if (value === expr) return PRESET_LABELS[key];
  }
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return "Custom schedule";
  const [min, hour, dom, , dow] = parts;
  const at =
    /^\d+$/.test(min) && /^\d+$/.test(hour)
      ? ` at ${formatTime(Number(hour), Number(min))}`
      : "";
  if (dow !== "*" && /^\d$/.test(dow)) return `Every ${DOW[Number(dow)]}${at}`;
  if (dom !== "*" && /^\d+$/.test(dom)) return `On day ${dom} of each month${at}`;
  if (dom === "*" && dow === "*" && /^\d+$/.test(hour)) return `Every day${at}`;
  return `Custom schedule${at}`;
}

function formatTime(hour: number, minute: number): string {
  const period = hour < 12 ? "AM" : "PM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${String(minute).padStart(2, "0")} ${period}`;
}

/** Plain-English summary of a job's schedule for cards and the creation form. */
export function describeSchedule(
  scheduleType: ScheduleType,
  schedulePreset: string | null | undefined,
  cronExpression: string | null | undefined,
): string {
  if (scheduleType === "preset") {
    return schedulePreset ? PRESET_LABELS[schedulePreset] ?? schedulePreset : "No schedule";
  }
  if (!cronExpression) return "No schedule";
  return isValidCron(cronExpression) ? describeCron(cronExpression) : "Invalid cron expression";
}
