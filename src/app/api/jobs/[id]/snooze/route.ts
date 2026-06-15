import { z } from "zod";
import { jobsDao } from "@/db/dao/jobs";
import { ok, fail } from "@/lib/api";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { computeSnoozeUntil } from "@/lib/snooze";

export const dynamic = "force-dynamic";

const snoozeSchema = z.object({
  amount: z.number().positive().max(365),
  unit: z.enum(["hours", "days"]),
});

type Ctx = { params: Promise<{ id: string }> };

/** POST /api/jobs/:id/snooze — pause scheduled fires for N hours/days (auto-resumes). */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    if (!jobsDao.findById(id)) throw new NotFoundError(`Job ${id} not found`);
    const parsed = snoozeSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new ValidationError("Provide a positive amount and unit (hours|days).");
    const until = computeSnoozeUntil(new Date(), parsed.data.amount, parsed.data.unit);
    return ok(jobsDao.snooze(id, until));
  } catch (err) {
    return fail(err);
  }
}

/** DELETE /api/jobs/:id/snooze — clear the snooze and resume immediately. */
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    if (!jobsDao.findById(id)) throw new NotFoundError(`Job ${id} not found`);
    return ok(jobsDao.unsnooze(id));
  } catch (err) {
    return fail(err);
  }
}
