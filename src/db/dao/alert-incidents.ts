import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "../client";
import { alertIncidents, type AlertIncident } from "../schema";

const nowIso = () => new Date().toISOString();

export const alertIncidentsDao = {
  openForJob(jobId: string): AlertIncident | undefined {
    return getDb()
      .select()
      .from(alertIncidents)
      .where(and(eq(alertIncidents.jobId, jobId), isNull(alertIncidents.closedAt)))
      .orderBy(desc(alertIncidents.openedAt))
      .limit(1)
      .get();
  },

  /** Most recent incident for a job that actually notified someone (for the cooldown). */
  lastNotified(jobId: string): AlertIncident | undefined {
    return getDb()
      .select()
      .from(alertIncidents)
      .where(and(eq(alertIncidents.jobId, jobId), eq(alertIncidents.notifyStatus, "accepted")))
      .orderBy(desc(alertIncidents.lastAttemptAt))
      .limit(1)
      .get();
  },

  open(input: { jobId: string; failureCount: number; lastExecutionId: string; openedAt?: string }): AlertIncident {
    return getDb()
      .insert(alertIncidents)
      .values({ id: crypto.randomUUID(), openedAt: input.openedAt ?? nowIso(), ...input })
      .returning()
      .get();
  },

  update(id: string, patch: Partial<Omit<AlertIncident, "id" | "jobId">>): AlertIncident | undefined {
    return getDb().update(alertIncidents).set(patch).where(eq(alertIncidents.id, id)).returning().get();
  },

  close(jobId: string, closedAt: string = nowIso()): AlertIncident | undefined {
    const open = this.openForJob(jobId);
    if (!open) return undefined;
    return this.update(open.id, { closedAt });
  },

  recent(limit = 50): AlertIncident[] {
    return getDb().select().from(alertIncidents).orderBy(desc(alertIncidents.openedAt)).limit(limit).all();
  },
};
