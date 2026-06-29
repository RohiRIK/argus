"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface Column<T> {
  key: string;
  header: string;
  /** Sortable when a `sortValue` is provided. */
  sortValue?: (row: T) => string | number;
  align?: "left" | "right";
  /** Cell renderer. */
  cell: (row: T) => React.ReactNode;
  className?: string;
  headerClassName?: string;
}

export type SortDir = "asc" | "desc";

/**
 * Generic, accessible data table grounded in NN/G data-table guidance:
 * human-readable first column, sortable headers (with `aria-sort`), zebra rows,
 * hover-highlight, sticky header, right-aligned numerics, keyboard-focusable rows.
 * Operator look: soft radius, hairline borders, subtle surface — no heavy chrome.
 *
 * State (sort) is co-located here. Rows scroll horizontally on narrow viewports.
 */
export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  initialSort,
  onRowActivate,
  emptyState,
  className,
}: {
  columns: Column<T>[];
  rows: T[];
  getRowKey: (row: T) => string;
  initialSort?: { key: string; dir: SortDir };
  /** Fired on row click and Enter/Space when focused. */
  onRowActivate?: (row: T) => void;
  /** Rendered in place of the body when there are no rows. */
  emptyState?: React.ReactNode;
  className?: string;
}) {
  const [sort, setSort] = React.useState<{ key: string; dir: SortDir } | null>(
    initialSort ?? null,
  );

  const sorted = React.useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return rows;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = col.sortValue!(a);
      const bv = col.sortValue!(b);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }, [rows, sort, columns]);

  function toggleSort(key: string) {
    setSort((prev) => {
      if (prev?.key !== key) return { key, dir: "asc" };
      if (prev.dir === "asc") return { key, dir: "desc" };
      return null; // third click clears
    });
  }

  return (
    <div
      className={cn("overflow-x-auto rounded-lg border border-border/70", className)}
      data-testid="data-table"
    >
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 z-10">
          <tr className="bg-surface-2/70 backdrop-blur-sm">
            {columns.map((col) => {
              const sortable = Boolean(col.sortValue);
              const active = sort?.key === col.key;
              const ariaSort = active ? (sort!.dir === "asc" ? "ascending" : "descending") : "none";
              return (
                <th
                  key={col.key}
                  aria-sort={sortable ? ariaSort : undefined}
                  className={cn(
                    "border-b border-border/70 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-fg-muted",
                    col.align === "right" ? "text-right" : "text-left",
                    col.headerClassName,
                  )}
                >
                  {sortable ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(col.key)}
                      data-testid={`sort-${col.key}`}
                      className={cn(
                        "inline-flex items-center gap-1 transition-colors hover:text-fg",
                        active && "text-fg",
                        col.align === "right" && "flex-row-reverse",
                      )}
                    >
                      {col.header}
                      <span aria-hidden className="text-[9px] leading-none">
                        {active ? (sort!.dir === "asc" ? "▲" : "▼") : "↕"}
                      </span>
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="p-0">
                {emptyState}
              </td>
            </tr>
          ) : (
            sorted.map((row) => {
              const interactive = Boolean(onRowActivate);
              return (
                <tr
                  key={getRowKey(row)}
                  data-testid="data-row"
                  tabIndex={interactive ? 0 : undefined}
                  onClick={interactive ? () => onRowActivate!(row) : undefined}
                  onKeyDown={
                    interactive
                      ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onRowActivate!(row);
                          }
                        }
                      : undefined
                  }
                  className={cn(
                    "border-b border-border/40 odd:bg-transparent even:bg-surface-2/20 transition-colors hover:bg-surface-2/50 focus-visible:outline-none focus-visible:bg-surface-2/60",
                    interactive && "cursor-pointer",
                  )}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={cn(
                        "px-4 py-3 align-middle",
                        col.align === "right" && "text-right tabular-nums",
                        col.className,
                      )}
                    >
                      {col.cell(row)}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
