import type { ReportDefinition } from "@/services/reports/types";

export type FlatRow = Record<string, string | number>;

export interface KeyedRow {
  key: string;
  row: FlatRow;
}

export interface RowDiff {
  /** Row keys present now but absent in the prior run. */
  added: string[];
  /** Row keys present in the prior run but absent now. */
  removed: string[];
  /** Count of keys present in both runs. */
  unchanged: number;
  /** The flat rows behind `added`, for "what changed" rendering. */
  addedRows: FlatRow[];
}

/**
 * Deterministic identity for a row when a report defines no `rowKey`. Hashes the
 * row's key/value pairs in a stable order. Brittle to cosmetic formatting changes
 * in `summarize` — reports that need durable identity should implement `rowKey`.
 */
export function fallbackKey(row: FlatRow): string {
  const stable = Object.keys(row)
    .sort()
    .map((k) => `${k}=${row[k]}`)
    .join("|");
  let hash = 5381;
  for (let i = 0; i < stable.length; i++) hash = ((hash << 5) + hash + stable.charCodeAt(i)) | 0;
  return `h${(hash >>> 0).toString(36)}`;
}

/**
 * Map a report's flat `summary.rows` to keyed rows using its `rowKey` resolver,
 * falling back to a value hash. De-duplicates by key (last write wins) so the
 * snapshot has one row per identity.
 */
export function toKeyedRows(report: Pick<ReportDefinition, "rowKey">, rows: FlatRow[]): KeyedRow[] {
  const byKey = new Map<string, FlatRow>();
  for (const row of rows) {
    const key = report.rowKey ? report.rowKey(row) : fallbackKey(row);
    byKey.set(key, row);
  }
  return [...byKey.entries()].map(([key, row]) => ({ key, row }));
}

/**
 * Compare the current run's keyed rows against the prior run's key set. First run
 * (empty prior set) reports every current row as added.
 */
export function diffRows(current: KeyedRow[], priorKeys: Set<string>): RowDiff {
  const currentKeys = new Set(current.map((r) => r.key));
  const added: string[] = [];
  const addedRows: FlatRow[] = [];
  let unchanged = 0;
  for (const { key, row } of current) {
    if (priorKeys.has(key)) unchanged++;
    else {
      added.push(key);
      addedRows.push(row);
    }
  }
  const removed = [...priorKeys].filter((k) => !currentKeys.has(k));
  return { added, removed, unchanged, addedRows };
}
