import { eq } from "drizzle-orm";
import { getDb } from "../client";
import { integrations, type Integration } from "../schema";

const nowIso = () => new Date().toISOString();

export const integrationsDao = {
  findAll(): Integration[] {
    return getDb().select().from(integrations).all();
  },

  findByProvider(provider: string): Integration | undefined {
    return getDb().select().from(integrations).where(eq(integrations.provider, provider)).get();
  },

  /** Create or update an integration keyed by provider. */
  upsert(provider: string, patch: Partial<Omit<Integration, "id" | "provider" | "createdAt">>): Integration {
    const db = getDb();
    const existing = this.findByProvider(provider);
    if (existing) {
      return db
        .update(integrations)
        .set({ ...patch, updatedAt: nowIso() })
        .where(eq(integrations.provider, provider))
        .returning()
        .get();
    }
    return db
      .insert(integrations)
      .values({
        id: crypto.randomUUID(),
        provider,
        name: patch.name ?? provider,
        status: patch.status ?? "disconnected",
        config: patch.config ?? {},
        lastHealthCheck: patch.lastHealthCheck ?? null,
        errorMessage: patch.errorMessage ?? null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      })
      .returning()
      .get();
  },
};
