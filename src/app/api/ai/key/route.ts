import { z } from "zod";
import { aiConfigService } from "@/services/ai/config";
import { AI_PROVIDER_IDS, AI_PROVIDERS } from "@/services/ai/providers";
import { ok, fail } from "@/lib/api";
import { parseBody } from "@/lib/validation";
import { USER_HEADER } from "@/lib/auth/access";

export const dynamic = "force-dynamic";

const schema = z.object({ provider: z.enum(AI_PROVIDER_IDS) });

/** DELETE /api/ai/key — forget the stored API key of one provider. Admin only (proxy). */
export async function DELETE(req: Request) {
  try {
    const { provider } = await parseBody(req, schema);
    aiConfigService.removeKey(provider, req.headers.get(USER_HEADER) ?? "unknown");
    return ok({ ...aiConfigService.view(), providers: AI_PROVIDERS });
  } catch (err) {
    return fail(err);
  }
}
