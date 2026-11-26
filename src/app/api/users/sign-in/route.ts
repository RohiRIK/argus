import { z } from "zod";
import { ok, fail } from "@/lib/api";
import { parseBody } from "@/lib/validation";
import { settingsDao } from "@/db/dao/settings";
import { auditDao } from "@/db/dao/audit";
import type { EntraSignInConfig } from "@/db/schema";
import { signInAvailability } from "@/services/auth/entra";
import { actorFrom } from "@/services/automations/safety";
import { getPublicOrigin } from "@/lib/request-origin";
import { SIGNIN_CALLBACK_PATH } from "@/lib/auth/paths";

export const dynamic = "force-dynamic";

const group = z.object({ id: z.string().uuid(), name: z.string().min(1).max(256) }).nullable().optional();

const schema = z.object({
  enabled: z.boolean(),
  groups: z.object({ admin: group, operator: group, viewer: group }),
});

function view(req: Request) {
  return {
    config: settingsDao.get().entraSignIn,
    ...signInAvailability(),
    redirectUri: `${getPublicOrigin(req)}${SIGNIN_CALLBACK_PATH}`,
  };
}

/** GET /api/users/sign-in — Microsoft sign-in settings + whether the button is live. Admin only. */
export async function GET(req: Request) {
  try {
    return ok(view(req));
  } catch (err) {
    return fail(err);
  }
}

/** PUT /api/users/sign-in — turn Microsoft sign-in on/off and map Entra groups to roles. Admin only. */
export async function PUT(req: Request) {
  try {
    const input = await parseBody(req, schema);
    const groups: EntraSignInConfig["groups"] = {};
    for (const r of ["admin", "operator", "viewer"] as const) {
      const g = input.groups[r];
      if (g) groups[r] = { id: g.id, name: g.name };
    }
    settingsDao.update({ entraSignIn: { enabled: input.enabled, groups } });
    auditDao.record({
      action: "auth.sign_in_config",
      outcome: "success",
      detail: { actor: actorFrom(req) },
    });
    return ok(view(req));
  } catch (err) {
    return fail(err);
  }
}
