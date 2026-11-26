import { templatesDao, ensureSharedTemplate } from "@/db/dao/templates";
import { ok, fail } from "@/lib/api";
import { parseBody, templateInputSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    ensureSharedTemplate();
    return ok(templatesDao.findAll());
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: Request) {
  try {
    const input = await parseBody(req, templateInputSchema);
    return ok(
      templatesDao.create({
        name: input.name,
        subject: input.subject,
        htmlBody: input.htmlBody,
        textBody: input.textBody && input.textBody.trim() !== "" ? input.textBody : null,
        reportType: input.reportType ?? "generic",
        // Guardrail: API-created templates are always custom clones, never shadow defaults.
        isDefault: false,
        language: input.language ?? "en",
        // API-created templates are operator-owned; seed never upgrades them.
        managed: false,
      }),
    );
  } catch (err) {
    return fail(err);
  }
}
