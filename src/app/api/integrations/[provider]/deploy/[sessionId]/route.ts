import { pollDeploySession } from "@/services/graph/provisioner";
import { pollAutomationDeploySession } from "@/services/graph/automation-provisioner";
import { AUTOMATION_PROVIDER } from "@/services/graph/automation-client";
import { ok, fail } from "@/lib/api";
import { ValidationError } from "@/lib/errors";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ provider: string; sessionId: string }> };

/** GET /api/integrations/:provider/deploy/:sessionId — poll device-code login + provisioning steps. */
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const { provider, sessionId } = await params;
    if (provider === AUTOMATION_PROVIDER) {
      return ok(await pollAutomationDeploySession(sessionId));
    }
    if (provider !== "microsoft365") {
      throw new ValidationError(
        "One-click deployment is only supported for microsoft365 and microsoft365-automation",
      );
    }
    const snapshot = await pollDeploySession(sessionId);
    return ok(snapshot);
  } catch (err) {
    return fail(err);
  }
}
