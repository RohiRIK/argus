import { expect, test, describe } from "bun:test";
import { csvEscape, toCsv, executionCsvRows, executionToCsv, type ExportableExecution } from "../src/lib/export";

describe("csvEscape", () => {
  test("leaves plain values unquoted", () => {
    expect(csvEscape("hello")).toBe("hello");
    expect(csvEscape(42)).toBe("42");
    expect(csvEscape(true)).toBe("true");
  });
  test("quotes commas, quotes, newlines; doubles embedded quotes", () => {
    expect(csvEscape("a,b")).toBe('"a,b"');
    expect(csvEscape('she said "hi"')).toBe('"she said ""hi"""');
    expect(csvEscape("line1\nline2")).toBe('"line1\nline2"');
  });
  test("null/undefined become empty", () => {
    expect(csvEscape(null)).toBe("");
    expect(csvEscape(undefined)).toBe("");
  });
});

describe("toCsv", () => {
  test("joins cells with comma and rows with CRLF", () => {
    expect(toCsv([["a", "b"], [1, 2]])).toBe("a,b\r\n1,2");
  });
});

const exec: ExportableExecution = {
  id: "abcdef12-3456-7890",
  jobId: "job-1",
  status: "success",
  startedAt: "2026-06-15T00:00:00.000Z",
  endedAt: "2026-06-15T00:00:01.000Z",
  recordsProcessed: 5,
  graphApiLatencyMs: 123,
  emailSent: true,
  baselineSnapshot: { signins: 5, anomalies: 1 },
};

describe("executionCsvRows / executionToCsv", () => {
  test("emits a key,value header and run summary", () => {
    const rows = executionCsvRows(exec);
    expect(rows[0]).toEqual(["key", "value"]);
    const map = new Map(rows.slice(1).map((r) => [r[0], r[1]]));
    expect(map.get("status")).toBe("success");
    expect(map.get("recordsProcessed")).toBe(5);
    expect(map.get("emailSent")).toBe(true);
  });
  test("includes each baseline-snapshot metric prefixed metric:", () => {
    const rows = executionCsvRows(exec);
    const keys = rows.map((r) => r[0]);
    expect(keys).toContain("metric:signins");
    expect(keys).toContain("metric:anomalies");
  });
  test("omits optional empty fields and handles no snapshot", () => {
    const rows = executionCsvRows({ ...exec, baselineSnapshot: null, suppressionReason: null, errorMessage: null });
    const keys = rows.map((r) => r[0]);
    expect(keys).not.toContain("suppressionReason");
    expect(keys.some((k) => String(k).startsWith("metric:"))).toBe(false);
  });
  test("executionToCsv produces CRLF-joined text starting with the header", () => {
    expect(executionToCsv(exec).startsWith("key,value\r\n")).toBe(true);
  });
});
