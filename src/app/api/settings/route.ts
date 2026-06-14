import { settingsDao } from "@/db/dao/settings";
import { rescheduleAll } from "@/services/scheduler";
import { ok, fail } from "@/lib/api";
import { parseBody, settingsInputSchema } from "@/lib/validation";
import pkg from "../../../../package.json";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return ok({
      ...settingsDao.get(),
      appVersion: pkg.version,
      masterKeyPresent: Boolean(process.env.ARGUS_MASTER_KEY),
    });
  } catch (err) {
    return fail(err);
  }
}

export async function PUT(req: Request) {
  try {
    const patch = await parseBody(req, settingsInputSchema);
    const updated = settingsDao.update(patch);
    if (patch.timezone !== undefined) rescheduleAll(); // ST-4: re-fire jobs in the new zone
    return ok(updated);
  } catch (err) {
    return fail(err);
  }
}
