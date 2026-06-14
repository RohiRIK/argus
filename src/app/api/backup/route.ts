import { exportBackup, importBackup } from "@/services/backup";
import { ok, fail } from "@/lib/api";
import { ValidationError } from "@/lib/errors";

export const dynamic = "force-dynamic";

/** GET /api/backup — download jobs + templates + non-secret settings (no vault). */
export async function GET() {
  try {
    return ok(exportBackup());
  } catch (err) {
    return fail(err);
  }
}

/** POST /api/backup/import — restore from a backup payload (transactional-validate first). */
export async function POST(req: Request) {
  try {
    let payload: unknown;
    try {
      payload = await req.json();
    } catch {
      throw new ValidationError("Backup body must be valid JSON");
    }
    return ok({ imported: importBackup(payload) });
  } catch (err) {
    return fail(err);
  }
}
