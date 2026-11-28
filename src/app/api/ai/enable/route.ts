import { z } from "zod";
import { aiConfigService } from "@/services/ai/config";
import { AI_PROVIDERS } from "@/services/ai/providers";
import { ok, fail } from "@/lib/api";
import { parseBody } from "@/lib/validation";
import { USER_HEADER } from "@/lib/auth/access";

export const dynamic = "force-dynamic";

const schema = z.object({
  enabled: z.boolean(),
  acceptNotice: z.boolean().optional(),
});

/** POST /api/ai/enable — turn AI investigations on (accepting the notice) or off. Admin only (proxy). */
export async function POST(req: Request) {
  try {
    const body = await parseBody(req, schema);
    aiConfigService.setEnabled(body.enabled, body.acceptNotice === true, req.headers.get(USER_HEADER) ?? "unknown");
    return ok({ ...aiConfigService.view(), providers: AI_PROVIDERS });
  } catch (err) {
    return fail(err);
  }
}
