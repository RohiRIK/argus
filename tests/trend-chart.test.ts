import { describe, test, expect } from "bun:test";
import { plotPoints } from "../src/components/ui/trend-chart";

describe("plotPoints", () => {
  test("empty series → no coords", () => {
    expect(plotPoints([])).toEqual([]);
  });

  test("single point sits mid-width", () => {
    const [p] = plotPoints([5], 600, 120, 12);
    expect(p.x).toBe(300);
    expect(Number.isNaN(p.y)).toBe(false);
  });

  test("flat positive series → equal finite y (level vs 0 baseline), no NaN", () => {
    const coords = plotPoints([3, 3, 3], 600, 120, 12);
    const ys = new Set(coords.map((c) => c.y));
    expect(ys.size).toBe(1); // all the same height
    expect(coords.every((c) => Number.isFinite(c.x) && Number.isFinite(c.y))).toBe(true);
  });

  test("all-zero series → centered vertically, no divide-by-zero", () => {
    const coords = plotPoints([0, 0, 0], 600, 120, 12);
    expect(coords.every((c) => c.y === 60)).toBe(true);
  });

  test("ascending series → x increases, higher value sits higher (smaller y)", () => {
    const coords = plotPoints([0, 5, 10], 600, 120, 12);
    expect(coords[0].x).toBeLessThan(coords[1].x);
    expect(coords[1].x).toBeLessThan(coords[2].x);
    // baseline anchored at 0: max value is at the top (min y), 0 at the bottom (max y)
    expect(coords[2].y).toBeLessThan(coords[0].y);
  });

  test("coords stay within the viewBox padding bounds", () => {
    const coords = plotPoints([2, 8, 4, 9, 1], 600, 120, 12);
    for (const c of coords) {
      expect(c.x).toBeGreaterThanOrEqual(12);
      expect(c.x).toBeLessThanOrEqual(588);
      expect(c.y).toBeGreaterThanOrEqual(12);
      expect(c.y).toBeLessThanOrEqual(108);
    }
  });
});
