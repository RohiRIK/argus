/**
 * Pure CSV/export helpers. RFC-4180-ish: quote cells containing a comma,
 * quote, CR or LF; double embedded quotes; join rows with CRLF.
 */

export function csvEscape(value: string | number | boolean | null | undefined): string {
  const s = value == null ? "" : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: (string | number | boolean | null | undefined)[][]): string {
  return rows.map((r) => r.map(csvEscape).join(",")).join("\r\n");
}

/** Minimal shape of an execution needed to build its export. */
export interface ExportableExecution {
  id: string;
  jobId: string;
  status: string;
  startedAt: string;
  endedAt?: string | null;
  recordsProcessed: number;
  graphApiLatencyMs: number;
  emailSent: boolean;
  suppressionReason?: string | null;
  errorMessage?: string | null;
  baselineSnapshot?: Record<string, number> | null;
}

/**
 * Build the rows for an execution CSV: a `key,value` summary of the run plus
 * every persisted baseline-snapshot metric (the structured data we store).
 */
export function executionCsvRows(e: ExportableExecution): (string | number | boolean)[][] {
  const rows: (string | number | boolean)[][] = [["key", "value"]];
  rows.push(["executionId", e.id]);
  rows.push(["jobId", e.jobId]);
  rows.push(["status", e.status]);
  rows.push(["startedAt", e.startedAt]);
  rows.push(["endedAt", e.endedAt ?? ""]);
  rows.push(["recordsProcessed", e.recordsProcessed]);
  rows.push(["graphApiLatencyMs", e.graphApiLatencyMs]);
  rows.push(["emailSent", e.emailSent]);
  if (e.suppressionReason) rows.push(["suppressionReason", e.suppressionReason]);
  if (e.errorMessage) rows.push(["errorMessage", e.errorMessage]);
  for (const [metric, value] of Object.entries(e.baselineSnapshot ?? {})) {
    rows.push([`metric:${metric}`, value]);
  }
  return rows;
}

export function executionToCsv(e: ExportableExecution): string {
  return toCsv(executionCsvRows(e));
}
