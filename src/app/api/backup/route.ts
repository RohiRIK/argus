import { exportBackup, importBackup, previewImport } from "@/services/backup";
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

function flag(v: string | null): boolean {
  return v === "1" || v === "true";
}

/**
 * POST /api/backup — restore from a backup payload (validated before any write).
 *   ?mode=preview  dry run: returns what would be created/updated, schedules,
 *                  missing references and the target's integration status. Writes nothing.
 *   ?activate=true opt in to keeping bundle-active jobs active. Default: every
 *                  imported job lands paused (`status: "disabled"`) and nothing is scheduled.
 */
export async function POST(req: Request) {
  try {
    const params = new URL(req.url).searchParams;
    const mode = params.get("mode") ?? "import";
    if (mode !== "import" && mode !== "preview") throw new ValidationError("mode must be 'import' or 'preview'");
    const activate = flag(params.get("activate"));
    let payload: unknown;
    try {
      payload = await req.json();
    } catch {
      throw new ValidationError("Backup body must be valid JSON");
    }
    if (mode === "preview") return ok({ preview: previewImport(payload, { activate }) });
    return ok({ imported: importBackup(payload, { activate }) });
  } catch (err) {
    return fail(err);
  }
}
