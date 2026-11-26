import { z } from "zod";
import { provisionAutomationParam } from "@/services/automations/provision";
import { parseBody } from "@/lib/validation";
import { ok, fail } from "@/lib/api";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  automationType: z.string().min(1),
  paramKey: z.string().min(1),
});

/** POST /api/automations/provision — create (or reuse) the tenant object a catalog param needs. */
export async function POST(req: Request) {
  try {
    const { automationType, paramKey } = await parseBody(req, bodySchema);
    return ok(await provisionAutomationParam(automationType, paramKey));
  } catch (err) {
    return fail(err);
  }
}
