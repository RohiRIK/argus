import { eq } from "drizzle-orm";
import { getDb } from "../client";
import { webhooks, type Webhook, type NewWebhook } from "../schema";
import type { WebhookTarget } from "@/services/dispatch/webhook";

const nowIso = () => new Date().toISOString();

export const webhooksDao = {
  forIntegration(integrationId: string): Webhook[] {
    return getDb().select().from(webhooks).where(eq(webhooks.integrationId, integrationId)).all();
  },

  findById(id: string): Webhook | undefined {
    return getDb().select().from(webhooks).where(eq(webhooks.id, id)).get();
  },

  create(input: Omit<NewWebhook, "id" | "createdAt" | "updatedAt"> & { id?: string }): Webhook {
    return getDb()
      .insert(webhooks)
      .values({ ...input, id: input.id ?? crypto.randomUUID(), createdAt: nowIso(), updatedAt: nowIso() })
      .returning()
      .get();
  },

  update(id: string, patch: Partial<NewWebhook>): Webhook | undefined {
    return getDb()
      .update(webhooks)
      .set({ ...patch, updatedAt: nowIso() })
      .where(eq(webhooks.id, id))
      .returning()
      .get();
  },

  delete(id: string): void {
    getDb().delete(webhooks).where(eq(webhooks.id, id)).run();
  },

  recordDelivery(id: string, status: "success" | "failed"): void {
    getDb()
      .update(webhooks)
      .set({ lastDeliveryStatus: status, lastDeliveryAt: nowIso() })
      .where(eq(webhooks.id, id))
      .run();
  },

  /** All enabled webhooks across integrations, as dispatcher targets. */
  enabledTargets(): WebhookTarget[] {
    return getDb()
      .select()
      .from(webhooks)
      .where(eq(webhooks.enabled, true))
      .all()
      .map((w) => ({
        id: w.id,
        name: w.name,
        url: w.url,
        secret: w.secret,
        enabled: w.enabled,
        includeFullHtml: w.includeFullHtml,
      }));
  },
};
