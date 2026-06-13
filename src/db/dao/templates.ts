import { eq, and } from "drizzle-orm";
import { getDb } from "../client";
import { templates, type Template } from "../schema";

export const templatesDao = {
  findAll(): Template[] {
    return getDb().select().from(templates).all();
  },

  findById(id: string): Template | undefined {
    return getDb().select().from(templates).where(eq(templates.id, id)).get();
  },

  defaultFor(reportType: string, language: "en" | "he" = "en"): Template | undefined {
    return getDb()
      .select()
      .from(templates)
      .where(and(eq(templates.reportType, reportType), eq(templates.language, language), eq(templates.isDefault, true)))
      .get();
  },

  create(input: Omit<Template, "id" | "textBody"> & { id?: string; textBody?: string | null }): Template {
    return getDb()
      .insert(templates)
      .values({ ...input, id: input.id ?? crypto.randomUUID(), textBody: input.textBody ?? null })
      .returning()
      .get();
  },

  update(id: string, patch: Partial<Omit<Template, "id">>): Template | undefined {
    return getDb().update(templates).set(patch).where(eq(templates.id, id)).returning().get();
  },
};
