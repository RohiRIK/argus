import { eq } from "drizzle-orm";
import { getDb } from "../client";
import { settings, type Settings } from "../schema";

const SINGLETON = "singleton";

export const settingsDao = {
  /** Return the singleton settings row, creating it with defaults if absent. */
  get(): Settings {
    const db = getDb();
    const existing = db.select().from(settings).where(eq(settings.id, SINGLETON)).get();
    if (existing) return existing;
    return db.insert(settings).values({ id: SINGLETON }).returning().get();
  },

  update(patch: Partial<Omit<Settings, "id">>): Settings {
    const db = getDb();
    this.get(); // ensure row exists
    return db.update(settings).set(patch).where(eq(settings.id, SINGLETON)).returning().get();
  },
};
