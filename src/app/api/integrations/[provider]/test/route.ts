import { testConnection } from "@/services/graph/connection-test";
import {
  AUTOMATION_PROVIDER,
  testAutomationConnection,
} from "@/services/graph/automation-client";
import { ok, fail } from "@/lib/api";
import { ValidationError } from "@/lib/errors";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ provider: string }> };

/** POST /api/integrations/:provider/test — live Entra auth + permission check for either M365 integration. */
export async function POST(_req: Request, { params }: Ctx) {
  try {
    const { provider } = await params;
    if (provider === AUTOMATION_PROVIDER) {
      return ok(await testAutomationConnection());
    }
    if (provider === "microsoft365") {
      return ok(await testConnection());
    }
    throw new ValidationError("Connection test is only supported for microsoft365 and microsoft365-automation");
  } catch (err) {
    return fail(err);
  }
}
