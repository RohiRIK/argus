import { NextResponse } from "next/server";
import { z } from "zod";
import { jobsDao } from "@/db/dao/jobs";
import { recipientGroupsDao } from "@/db/dao/recipient-groups";
import { getReport } from "@/services/reports/registry";
import { addOrReplaceJob } from "@/services/scheduler";
import { fail } from "@/lib/api";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { parseBody } from "@/lib/validation";

export const dynamic = "force-dynamic";

const schema = z.object({
  reportType: z.string().min(1),
});

/** POST /api/catalog/quick-enable — create a scheduled job using plugin defaults. */
export async function POST(req: Request) {
  try {
    const { reportType } = await parseBody(req, schema);
    const report = getReport(reportType);
    if (!report) {
      throw new NotFoundError(`Report type "${reportType}" not found in catalog`);
    }
    if (report.id === "manual-graph-query") {
      throw new ValidationError("Manual Graph Query requires a custom Graph endpoint — use Customize job.");
    }

    const group = report.recommendedGroup
      ? recipientGroupsDao.findByName(report.recommendedGroup)
      : undefined;

    const job = jobsDao.create({
      name: report.name,
      description: report.description,
      reportType: report.id,
      params: {},
      scheduleType: "preset",
      schedulePreset: report.recommendedSchedule ?? "weekly",
      conditionalRules: report.category === "security" ? { mode: "new_items" } : { mode: "always" },
      recipients: [],
      recipientGroupIds: group ? [group.id] : [],
      tags: [...(report.tags ?? [report.category])],
      status: "active",
    });

    addOrReplaceJob(job.id);
    return NextResponse.json({ success: true, data: job }, { status: 201 });
  } catch (err) {
    return fail(err);
  }
}
