import { describe, test, expect } from "bun:test";
import { diffRows, toKeyedRows, fallbackKey, type KeyedRow } from "../src/services/report-engine/diff";

const keyed = (...keys: string[]): KeyedRow[] => keys.map((k) => ({ key: k, row: { id: k } }));

describe("diffRows", () => {
  test("first run (empty prior) → every row added", () => {
    const d = diffRows(keyed("a", "b", "c"), new Set());
    expect(d.added.sort()).toEqual(["a", "b", "c"]);
    expect(d.removed).toEqual([]);
    expect(d.unchanged).toBe(0);
    expect(d.addedRows).toHaveLength(3);
  });

  test("identical run → nothing added or removed", () => {
    const d = diffRows(keyed("a", "b"), new Set(["a", "b"]));
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
    expect(d.unchanged).toBe(2);
  });

  // The regression: 1 identity leaves and 1 arrives. Count is unchanged (2→2),
  // but this is a genuine new item. The old count-delta logic reported 0 new.
  test("swap case (1 in + 1 out) → added=1, removed=1, count unchanged", () => {
    const d = diffRows(keyed("b", "c"), new Set(["a", "b"]));
    expect(d.added).toEqual(["c"]);
    expect(d.removed).toEqual(["a"]);
    expect(d.unchanged).toBe(1);
    expect(d.addedRows[0]).toEqual({ id: "c" });
  });
});

describe("toKeyedRows", () => {
  test("uses report.rowKey when present", () => {
    const report = { rowKey: (r: Record<string, string | number>) => `u:${r.user}` };
    const out = toKeyedRows(report, [{ user: "x" }, { user: "y" }]);
    expect(out.map((k) => k.key).sort()).toEqual(["u:x", "u:y"]);
  });

  test("dedupes by key (last write wins)", () => {
    const report = { rowKey: (r: Record<string, string | number>) => `u:${r.user}` };
    const out = toKeyedRows(report, [{ user: "x", v: 1 }, { user: "x", v: 2 }]);
    expect(out).toHaveLength(1);
    expect(out[0].row.v).toBe(2);
  });

  test("falls back to a stable value hash when no rowKey", () => {
    const out = toKeyedRows({}, [{ a: "1", b: "2" }]);
    // Same values (any key order) → same key; different values → different key.
    expect(out[0].key).toBe(fallbackKey({ b: "2", a: "1" }));
    expect(fallbackKey({ a: "1" })).not.toBe(fallbackKey({ a: "2" }));
  });
});
