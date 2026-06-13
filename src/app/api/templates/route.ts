import { templatesDao } from "@/db/dao/templates";
import { ok, fail } from "@/lib/api";
import { parseBody, templateInputSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
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
        reportType: input.reportType ?? "generic",
        isDefault: input.isDefault ?? false,
        language: input.language ?? "en",
      }),
    );
  } catch (err) {
    return fail(err);
  }
}
