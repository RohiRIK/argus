import { jobsDao } from "@/db/dao/jobs";
import { recipientGroupsDao } from "@/db/dao/recipient-groups";
import { activationDecision } from "@/services/job-readiness";
import { addOrReplaceJob } from "@/services/scheduler";
import { ok, fail } from "@/lib/api";
import type { ConditionalRules } from "@/db/schema";

export const dynamic = "force-dynamic";

const STARTER_JOBS: Array<{
  name: string;
  description: string;
  reportType: string;
  scheduleType: "preset";
  schedulePreset: string;
  conditionalRules: ConditionalRules;
  tags: string[];
  defaultGroupName: string;
}> = [
  {
    name: "Risky Users (Daily)",
    description: "Alert when any Entra ID user enters atRisk or confirmedCompromised state.",
    reportType: "risky-users",
    scheduleType: "preset",
    schedulePreset: "daily",
    conditionalRules: { mode: "new_items" },
    tags: ["identity", "security", "starter"],
    defaultGroupName: "Argus - Security Alerts",
  },
  {
    name: "MFA Registration Coverage (Weekly)",
    description: "Weekly audit of users without strong MFA authentication methods registered.",
    reportType: "mfa-registration",
    scheduleType: "preset",
    schedulePreset: "weekly",
    conditionalRules: { mode: "always" },
    tags: ["identity", "starter"],
    defaultGroupName: "Argus - Identity & Access",
  },
  {
    name: "App Secrets & Certs Expiring (Weekly)",
    description: "Detect Entra ID application credentials expiring within 30 days.",
    reportType: "app-secrets-expiry",
    scheduleType: "preset",
    schedulePreset: "weekly",
    conditionalRules: { mode: "count_gt", threshold: 0 },
    tags: ["security", "starter"],
    defaultGroupName: "Argus - Security Alerts",
  },
  {
    name: "License Utilization (Weekly)",
    description: "Track Microsoft 365 seat utilization and unused paid licenses.",
    reportType: "license-utilization",
    scheduleType: "preset",
    schedulePreset: "weekly",
    conditionalRules: { mode: "always" },
    tags: ["infrastructure", "starter"],
    defaultGroupName: "Argus - M365 Operations",
  },
];

/** POST /api/onboarding/starter-pack — idempotently create 4 recommended baseline jobs. */
export async function POST() {
  try {
    const existingTypes = new Set(jobsDao.findAll().map((j) => j.reportType));
    const created = [];
    for (const spec of STARTER_JOBS) {
      if (existingTypes.has(spec.reportType)) continue;
      const { defaultGroupName, ...jobSpec } = spec;
      const group = recipientGroupsDao.findByName(defaultGroupName);
      const recipientGroupIds = group ? [group.id] : [];
      const decision = activationDecision("active", { recipients: [], recipientGroupIds, deliveryMode: "email" });
      const job = jobsDao.create({
        ...jobSpec,
        params: {},
        recipients: [],
        recipientGroupIds,
        status: decision.status,
      });
      addOrReplaceJob(job.id);
      created.push({ ...job, blockers: decision.blockers.map((b) => ({ ...b, repairHref: `/jobs/${job.id}/edit` })) });
    }
    return ok({
      createdCount: created.length,
      pausedCount: created.filter((j) => j.status !== "active").length,
      skippedCount: STARTER_JOBS.length - created.length,
      jobs: created,
    });
  } catch (err) {
    return fail(err);
  }
}
