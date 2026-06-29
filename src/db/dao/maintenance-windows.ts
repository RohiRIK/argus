import { eq } from "drizzle-orm";
import { getDb } from "../client";
import { maintenanceWindows, type MaintenanceWindow, type NewMaintenanceWindow } from "../schema";
import { auditDao } from "./audit";
import { validateWindow } from "@/services/report-engine/maintenance";
import { ValidationError } from "@/lib/errors";

const nowIso = () => new Date().toISOString();

function assertValid(w: Partial<MaintenanceWindow>): void {
  const errs = validateWindow(w);
  if (errs.length) throw new ValidationError(`Invalid maintenance window: ${errs.join("; ")}`);
}

/** Maintenance windows (spec-alerting). Mutations are audited (S1). */
export const maintenanceWindowsDao = {
  list(): MaintenanceWindow[] {
    return getDb().select().from(maintenanceWindows).all();
  },

  listEnabled(): MaintenanceWindow[] {
    return getDb().select().from(maintenanceWindows).where(eq(maintenanceWindows.enabled, true)).all();
  },

  findById(id: string): MaintenanceWindow | undefined {
    return getDb().select().from(maintenanceWindows).where(eq(maintenanceWindows.id, id)).get();
  },

  create(input: Omit<NewMaintenanceWindow, "id" | "createdAt" | "updatedAt"> & { id?: string }): MaintenanceWindow {
    assertValid(input);
    const row: NewMaintenanceWindow = { ...input, id: input.id ?? crypto.randomUUID(), createdAt: nowIso(), updatedAt: nowIso() };
    const created = getDb().insert(maintenanceWindows).values(row).returning().get();
    auditDao.record({
      action: "maintenance_window.create",
      outcome: "success",
      detail: { id: created.id, name: created.name, kind: created.kind },
    });
    return created;
  },

  update(id: string, patch: Partial<Omit<NewMaintenanceWindow, "id" | "createdAt">>): MaintenanceWindow | undefined {
    const current = this.findById(id);
    if (!current) return undefined;
    assertValid({ ...current, ...patch });
    const updated = getDb()
      .update(maintenanceWindows)
      .set({ ...patch, updatedAt: nowIso() })
      .where(eq(maintenanceWindows.id, id))
      .returning()
      .get();
    auditDao.record({ action: "maintenance_window.update", outcome: "success", detail: { id, patch } });
    return updated;
  },

  delete(id: string): void {
    getDb().delete(maintenanceWindows).where(eq(maintenanceWindows.id, id)).run();
    auditDao.record({ action: "maintenance_window.delete", outcome: "success", detail: { id } });
  },
};
