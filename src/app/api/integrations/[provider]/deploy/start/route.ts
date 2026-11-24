import { z } from "zod";
import { startDeploySession } from "@/services/graph/provisioner";
import { ok, fail } from "@/lib/api";
import { ValidationError } from "@/lib/errors";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  mode: z.enum(["create", "upgrade"]).default("create"),
  appName: z.string().min(1).max(80).optional(),
  mailbox: z.string().email().optional().or(z.literal("")),
  mailboxMode: z.enum(["existing", "create"]).default("existing"),
});

type Ctx = { params: Promise<{ provider: string }> };

/** POST /api/integrations/:provider/deploy/start — begin one-click Azure deployment. */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { provider } = await params;
    if (provider !== "microsoft365") {
      throw new ValidationError("One-click deployment is only supported for microsoft365");
    }
    const raw = await req.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError("Invalid deployment parameters");
    }
    const session = await startDeploySession({
      mode: parsed.data.mode,
      appName: parsed.data.appName,
      mailbox: parsed.data.mailbox || undefined,
      mailboxMode: parsed.data.mailboxMode,
      req,
    });
    return ok(session);
  } catch (err) {
    return fail(err);
  }
}
