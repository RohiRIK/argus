import { describe, test, expect } from "bun:test";
import { isMuted, validateWindow, localParts } from "../src/services/report-engine/maintenance";
import type { MaintenanceWindow } from "../src/db/schema";

// 2026-06-29 is a Monday. 03:30 UTC.
const MON_0330Z = new Date("2026-06-29T03:30:00Z");

function recurring(over: Partial<MaintenanceWindow> = {}): MaintenanceWindow {
  return {
    id: "w1", name: "Sat night", kind: "recurring",
    dayOfWeek: 1, startMinute: 180, endMinute: 240, // Mon 03:00–04:00
    startsAt: null, endsAt: null, enabled: true,
    createdAt: "", updatedAt: "", ...over,
  } as MaintenanceWindow;
}
function oneoff(startsAt: string, endsAt: string, over: Partial<MaintenanceWindow> = {}): MaintenanceWindow {
  return {
    id: "w2", name: "Migration", kind: "oneoff",
    dayOfWeek: null, startMinute: null, endMinute: null,
    startsAt, endsAt, enabled: true, createdAt: "", updatedAt: "", ...over,
  } as MaintenanceWindow;
}

describe("isMuted — recurring", () => {
  test("inside the weekly window (UTC) → muted", () => {
    const r = isMuted([recurring()], MON_0330Z, "UTC");
    expect(r.muted).toBe(true);
    expect(r.reason).toBe("Sat night");
  });
  test("outside the minute range → not muted", () => {
    expect(isMuted([recurring({ startMinute: 0, endMinute: 60 })], MON_0330Z, "UTC").muted).toBe(false);
  });
  test("wrong day → not muted", () => {
    expect(isMuted([recurring({ dayOfWeek: 2 })], MON_0330Z, "UTC").muted).toBe(false);
  });
  test("disabled window is ignored", () => {
    expect(isMuted([recurring({ enabled: false })], MON_0330Z, "UTC").muted).toBe(false);
  });
  test("timezone shifts the local clock (03:30Z = Sun 20:30 in LA) → Monday window misses", () => {
    expect(isMuted([recurring()], MON_0330Z, "America/Los_Angeles").muted).toBe(false);
  });
});

describe("isMuted — oneoff", () => {
  test("now inside the absolute range → muted", () => {
    const w = oneoff("2026-06-29T03:00:00Z", "2026-06-29T04:00:00Z");
    expect(isMuted([w], MON_0330Z, "UTC").muted).toBe(true);
  });
  test("now after the range → not muted", () => {
    const w = oneoff("2026-06-29T00:00:00Z", "2026-06-29T01:00:00Z");
    expect(isMuted([w], MON_0330Z, "UTC").muted).toBe(false);
  });
});

describe("localParts", () => {
  test("UTC Monday 03:30 → dow 1, 210 minutes", () => {
    expect(localParts(MON_0330Z, "UTC")).toEqual({ dow: 1, minutes: 210 });
  });
});

describe("validateWindow", () => {
  test("valid recurring → no errors", () => {
    expect(validateWindow(recurring())).toEqual([]);
  });
  test("end before start (overnight wrap) → error", () => {
    expect(validateWindow(recurring({ startMinute: 240, endMinute: 180 })).join(" ")).toMatch(/after startMinute/);
  });
  test("missing name → error", () => {
    expect(validateWindow(recurring({ name: "" })).join(" ")).toMatch(/name/);
  });
  test("oneoff over 30 days → error", () => {
    const errs = validateWindow(oneoff("2026-01-01T00:00:00Z", "2026-03-01T00:00:00Z"));
    expect(errs.join(" ")).toMatch(/30 days/);
  });
  test("oneoff end before start → error", () => {
    const errs = validateWindow(oneoff("2026-06-29T04:00:00Z", "2026-06-29T03:00:00Z"));
    expect(errs.join(" ")).toMatch(/after startsAt/);
  });
});
