import { jobsDao } from "@/db/dao/jobs";
import { templatesDao } from "@/db/dao/templates";
import { settingsDao } from "@/db/dao/settings";
import { addOrReplaceJob } from "@/services/scheduler";
import { ValidationError } from "@/lib/errors";
import type { Job, Template } from "@/db/schema";

/** Portable config snapshot — jobs + templates + non-secret settings. NEVER includes vault credentials or the master key (BK-1). */
export interface BackupPayload {
  version: 1;
  exportedAt: string;
  jobs: Job[];
  templates: Template[];
  settings: {
    globalRecipients: string[];
    adminContacts: string[];
    language: "en" | "he";
    timezone: string;
    retentionDays: number;
    fromAddress: string | null;
    replyTo: string | null;
  };
}

export function exportBackup(): BackupPayload {
  const s = settingsDao.get();
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    jobs: jobsDao.findAll(),
    templates: templatesDao.findAll(),
    settings: {
      globalRecipients: s.globalRecipients,
      adminContacts: s.adminContacts,
      language: s.language,
      timezone: s.timezone,
      retentionDays: s.retentionDays,
      fromAddress: s.fromAddress,
      replyTo: s.replyTo,
    },
  };
}

/** Validate the shape up front so a malformed payload writes nothing (BK-4). */
function assertValid(p: unknown): asserts p is BackupPayload {
  const b = p as Partial<BackupPayload>;
  if (!b || b.version !== 1) throw new ValidationError("Unsupported or missing backup version");
  if (!Array.isArray(b.jobs) || !Array.isArray(b.templates)) throw new ValidationError("Backup must include jobs[] and templates[]");
  if (b.jobs.some((j) => !j?.id) || b.templates.some((t) => !t?.id)) throw new ValidationError("Every job and template needs an id");
}

export function importBackup(payload: unknown): { jobs: number; templates: number } {
  assertValid(payload);
  // Templates first — jobs reference templateId.
  let templates = 0;
  for (const t of payload.templates) {
    if (templatesDao.findById(t.id)) templatesDao.update(t.id, t);
    else templatesDao.create(t);
    templates++;
  }
  let jobs = 0;
  for (const j of payload.jobs) {
    if (jobsDao.findById(j.id)) jobsDao.update(j.id, j);
    else jobsDao.create(j);
    addOrReplaceJob(j.id); // BK-3: re-register active jobs with the scheduler
    jobs++;
  }
  settingsDao.update(payload.settings);
  return { jobs, templates };
}
