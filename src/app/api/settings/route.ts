import { settingsDao } from "@/db/dao/settings";
import { ok, fail } from "@/lib/api";
import { parseBody, settingsInputSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return ok(settingsDao.get());
  } catch (err) {
    return fail(err);
  }
}

export async function PUT(req: Request) {
  try {
    const patch = await parseBody(req, settingsInputSchema);
    return ok(settingsDao.update(patch));
  } catch (err) {
    return fail(err);
  }
}
