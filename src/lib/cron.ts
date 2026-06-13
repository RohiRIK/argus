/**
 * Minimal standard 5-field cron support (minute hour day-of-month month
 * day-of-week). Enough to validate expressions and preview upcoming runs in the
 * UI (PRD §4.1 "live preview of next 5 runs"). node-cron handles the actual
 * firing; this only computes occurrences.
 */

export const SCHEDULE_PRESETS: Record<string, string> = {
  hourly: "0 * * * *",
  daily: "0 8 * * *",
  weekly: "0 8 * * 1", // Monday 08:00
  monthly: "0 8 1 * *", // 1st of month 08:00
  business_days: "0 8 * * 1-5",
  weekends: "0 8 * * 0,6",
};

interface CronFields {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
  domRestricted: boolean;
  dowRestricted: boolean;
}

function parseField(field: string, min: number, max: number): Set<number> {
  const values = new Set<number>();
  for (const part of field.split(",")) {
    const [range, stepStr] = part.split("/");
    const step = stepStr ? Number(stepStr) : 1;
    if (!Number.isInteger(step) || step < 1) throw new Error(`Invalid cron step: ${part}`);

    let lo = min;
    let hi = max;
    if (range !== "*") {
      const [a, b] = range.split("-");
      lo = Number(a);
      hi = b !== undefined ? Number(b) : a !== undefined ? Number(a) : max;
      if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < min || hi > max || lo > hi) {
        throw new Error(`Invalid cron range: ${part}`);
      }
    }
    for (let v = lo; v <= hi; v += step) values.add(v);
  }
  return values;
}

/** Parse + validate a 5-field cron expression. Throws on malformed input. */
export function parseCron(expression: string): CronFields {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`Cron expression must have 5 fields: "${expression}"`);
  return {
    minute: parseField(parts[0], 0, 59),
    hour: parseField(parts[1], 0, 23),
    dom: parseField(parts[2], 1, 31),
    month: parseField(parts[3], 1, 12),
    dow: parseField(parts[4], 0, 6),
    domRestricted: parts[2] !== "*",
    dowRestricted: parts[4] !== "*",
  };
}

export function isValidCron(expression: string): boolean {
  try {
    parseCron(expression);
    return true;
  } catch {
    return false;
  }
}

function matches(fields: CronFields, d: Date): boolean {
  if (!fields.minute.has(d.getMinutes())) return false;
  if (!fields.hour.has(d.getHours())) return false;
  if (!fields.month.has(d.getMonth() + 1)) return false;
  const domOk = fields.dom.has(d.getDate());
  const dowOk = fields.dow.has(d.getDay());
  // Standard cron: when both DOM and DOW are restricted, either may match.
  if (fields.domRestricted && fields.dowRestricted) return domOk || dowOk;
  if (fields.domRestricted) return domOk;
  if (fields.dowRestricted) return dowOk;
  return true;
}

/**
 * Compute the next `count` run times after `from`. Steps minute-by-minute up to
 * a bound (default ~366 days) — fine for preview use.
 */
export function nextRuns(expression: string, count = 5, from: Date = new Date()): Date[] {
  const fields = parseCron(expression);
  const runs: Date[] = [];
  const cursor = new Date(from);
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1); // strictly after `from`

  const maxMinutes = 366 * 24 * 60;
  for (let i = 0; i < maxMinutes && runs.length < count; i++) {
    if (matches(fields, cursor)) runs.push(new Date(cursor));
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  return runs;
}
