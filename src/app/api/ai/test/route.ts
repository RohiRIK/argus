import { aiConfigService } from "@/services/ai/config";
import { savedModelSettings, testModel } from "@/services/ai/model";
import { ok, fail } from "@/lib/api";

export const dynamic = "force-dynamic";

/** POST /api/ai/test — send one tiny prompt to the saved model. Admin only (proxy). */
export async function POST() {
  try {
    const result = await testModel(savedModelSettings());
    aiConfigService.recordCheck(result.ok, result.error ?? null);
    return ok(result);
  } catch (err) {
    return fail(err);
  }
}
