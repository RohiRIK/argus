import { asc, eq, inArray } from "drizzle-orm";
import { getDb } from "../client";
import { recipientGroups, type RecipientGroup, type NewRecipientGroup } from "../schema";
import { jobsDao } from "./jobs";
import { settingsDao } from "./settings";

const nowIso = () => new Date().toISOString();

export const recipientGroupsDao = {
  findAll(): RecipientGroup[] {
    return getDb().select().from(recipientGroups).orderBy(asc(recipientGroups.name)).all();
  },

  findById(id: string): RecipientGroup | undefined {
    return getDb().select().from(recipientGroups).where(eq(recipientGroups.id, id)).get();
  },

  findByIds(ids: string[]): RecipientGroup[] {
    if (ids.length === 0) return [];
    return getDb().select().from(recipientGroups).where(inArray(recipientGroups.id, ids)).all();
  },

  findByName(name: string): RecipientGroup | undefined {
    return getDb().select().from(recipientGroups).where(eq(recipientGroups.name, name)).get();
  },

  findByEntraId(entraGroupId: string): RecipientGroup | undefined {
    return getDb()
      .select()
      .from(recipientGroups)
      .where(eq(recipientGroups.entraGroupId, entraGroupId))
      .get();
  },

  create(
    input: Omit<NewRecipientGroup, "id" | "createdAt" | "updatedAt"> & { id?: string },
  ): RecipientGroup {
    const row: NewRecipientGroup = {
      ...input,
      id: input.id ?? crypto.randomUUID(),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    return getDb().insert(recipientGroups).values(row).returning().get();
  },

  update(
    id: string,
    patch: Partial<Omit<NewRecipientGroup, "id" | "createdAt">>,
  ): RecipientGroup | undefined {
    return getDb()
      .update(recipientGroups)
      .set({ ...patch, updatedAt: nowIso() })
      .where(eq(recipientGroups.id, id))
      .returning()
      .get();
  },

  /**
   * Delete a group and strip its id from any referencing jobs and global settings
   * inside one transaction so no dangling group ids remain.
   */
  delete(id: string): void {
    getDb().transaction((tx) => {
      tx.delete(recipientGroups).where(eq(recipientGroups.id, id)).run();

      for (const job of jobsDao.findAll()) {
        if (job.recipientGroupIds.includes(id)) {
          jobsDao.update(job.id, {
            recipientGroupIds: job.recipientGroupIds.filter((gid) => gid !== id),
          });
        }
      }

      const s = settingsDao.get();
      if (s.globalRecipientGroupIds.includes(id)) {
        settingsDao.update({
          globalRecipientGroupIds: s.globalRecipientGroupIds.filter((gid) => gid !== id),
        });
      }
    });
  },
};
