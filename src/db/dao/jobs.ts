import { eq, desc } from "drizzle-orm";
import { getDb } from "../client";
import { jobs, type Job, type NewJob } from "../schema";

const nowIso = () => new Date().toISOString();

export const jobsDao = {
  findAll(): Job[] {
    return getDb().select().from(jobs).orderBy(desc(jobs.createdAt)).all();
  },

  findById(id: string): Job | undefined {
    return getDb().select().from(jobs).where(eq(jobs.id, id)).get();
  },

  create(input: Omit<NewJob, "id" | "createdAt" | "updatedAt"> & { id?: string }): Job {
    const row: NewJob = {
      ...input,
      id: input.id ?? crypto.randomUUID(),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    return getDb().insert(jobs).values(row).returning().get();
  },

  update(id: string, patch: Partial<Omit<NewJob, "id" | "createdAt">>): Job | undefined {
    return getDb()
      .update(jobs)
      .set({ ...patch, updatedAt: nowIso() })
      .where(eq(jobs.id, id))
      .returning()
      .get();
  },

  delete(id: string): void {
    // Cascades to executions → logs and baselines via FK ON DELETE CASCADE.
    getDb().delete(jobs).where(eq(jobs.id, id)).run();
  },

  active(): Job[] {
    return getDb().select().from(jobs).where(eq(jobs.status, "active")).all();
  },

  /** Snooze a job until an ISO instant (scheduler skips fires until then). */
  snooze(id: string, untilIso: string): Job | undefined {
    return this.update(id, { snoozedUntil: untilIso });
  },

  /** Clear any snooze so the job resumes scheduled runs immediately. */
  unsnooze(id: string): Job | undefined {
    return this.update(id, { snoozedUntil: null });
  },
};
