import { z } from "zod";
import { aiConfigService } from "@/services/ai/config";
import { AI_PROVIDER_IDS, AI_PROVIDERS } from "@/services/ai/providers";
import { ok, fail } from "@/lib/api";
import { parseBody } from "@/lib/validation";
import { USER_HEADER } from "@/lib/auth/access";

export const dynamic = "force-dynamic";

const saveSchema = z.object({
  provider: z.enum(AI_PROVIDER_IDS),
  model: z.string().trim().min(1, "Choose a model").max(200),
  baseUrl: z.string().trim().max(500).nullable().optional(),
  apiKey: z.string().trim().max(1000).optional(),
});

/** GET /api/ai — AI investigations settings (never returns keys) and the provider catalog. */
export async function GET() {
  try {
    return ok({ ...aiConfigService.view(), providers: AI_PROVIDERS });
  } catch (err) {
    return fail(err);
  }
}

/** PUT /api/ai — save provider, model and (optionally) a new API key. Admin only (proxy). */
export async function PUT(req: Request) {
  try {
    const body = await parseBody(req, saveSchema);
    aiConfigService.saveProvider(body, req.headers.get(USER_HEADER) ?? "unknown");
    return ok({ ...aiConfigService.view(), providers: AI_PROVIDERS });
  } catch (err) {
    return fail(err);
  }
}
