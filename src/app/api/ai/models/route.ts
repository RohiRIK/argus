import { z } from "zod";
import { aiConfigService } from "@/services/ai/config";
import { listModels } from "@/services/ai/models";
import { AI_PROVIDER_IDS } from "@/services/ai/providers";
import { ok, fail } from "@/lib/api";
import { parseBody } from "@/lib/validation";

export const dynamic = "force-dynamic";

const schema = z.object({
  provider: z.enum(AI_PROVIDER_IDS),
  apiKey: z.string().trim().max(1000).optional(),
  baseUrl: z.string().trim().max(500).nullable().optional(),
});

/**
 * POST /api/ai/models — live model list from the provider. Uses the key in the
 * body, or the stored key for that provider. Admin only (proxy).
 */
export async function POST(req: Request) {
  try {
    const body = await parseBody(req, schema);
    const apiKey = body.apiKey || aiConfigService.apiKey(body.provider);
    const models = await listModels({ provider: body.provider, apiKey, baseUrl: body.baseUrl ?? undefined });
    return ok(models, { total: models.length });
  } catch (err) {
    return fail(err);
  }
}
