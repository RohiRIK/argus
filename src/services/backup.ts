import { getDb } from "@/db/client";
import { jobsDao } from "@/db/dao/jobs";
import { templatesDao } from "@/db/dao/templates";
import { settingsDao } from "@/db/dao/settings";
import { maintenanceWindowsDao } from "@/db/dao/maintenance-windows";
import { addOrReplaceJob, rescheduleAll } from "@/services/scheduler";
import { ValidationError } from "@/lib/errors";
import type { Job, MaintenanceWindow, Template } from "@/db/schema";

/** Portable config snapshot — jobs + templates + maintenance windows + non-secret settings. NEVER includes vault credentials or the master key (BK-1). */
export interface BackupPayload {
  version: 1;
  exportedAt: string;
  jobs: Job[];
  templates: Template[];
  maintenanceWindows?: MaintenanceWindow[];
  settings: {
    globalRecipients: string[];
    adminContacts: string[];
    language: "en" | "he";
    timezone: string;
    retentionDays: number;
    fromAddress: string | null;
    replyTo: string | null;
    alertThreshold?: number;
    suppressEmptyReports?: boolean;
  };
}

export function exportBackup(): BackupPayload {
  const s = settingsDao.get();
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    jobs: jobsDao.findAll(),
    templates: templatesDao.findAll(),
    maintenanceWindows: maintenanceWindowsDao.list(),
    settings: {
      globalRecipients: s.globalRecipients,
      adminContacts: s.adminContacts,
      language: s.language,
      timezone: s.timezone,
      retentionDays: s.retentionDays,
      fromAddress: s.fromAddress,
      replyTo: s.replyTo,
      alertThreshold: s.alertThreshold,
      suppressEmptyReports: s.suppressEmptyReports,
    },
  };
}

/** Validate the shape up front so a malformed payload writes nothing (BK-4). */
function assertValid(p: unknown): asserts p is BackupPayload {
  const b = p as Partial<BackupPayload>;
  if (!b || b.version !== 1) throw new ValidationError("Unsupported or missing backup version");
  if (!Array.isArray(b.jobs) || !Array.isArray(b.templates)) throw new ValidationError("Backup must include jobs[] and templates[]");
  if (b.jobs.some((j) => !j?.id) || b.templates.some((t) => !t?.id)) throw new ValidationError("Every job and template needs an id");
  if (b.maintenanceWindows !== undefined) {
    if (!Array.isArray(b.maintenanceWindows)) throw new ValidationError("maintenanceWindows must be an array");
    if (b.maintenanceWindows.some((w) => !w?.id)) throw new ValidationError("Every maintenance window needs an id");
  }
}

export function importBackup(payload: unknown): { jobs: number; templates: number; maintenanceWindows: number } {
  assertValid(payload);

  const counts = getDb().transaction(() => {
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
      jobs++;
    }
    let windows = 0;
    for (const w of payload.maintenanceWindows ?? []) {
      if (maintenanceWindowsDao.findById(w.id)) maintenanceWindowsDao.update(w.id, w);
      else maintenanceWindowsDao.create(w);
      windows++;
    }
    if (payload.settings) {
      settingsDao.update(payload.settings);
    }
    return { jobs, templates, maintenanceWindows: windows };
  });

  // Re-register scheduler tasks after commit so failed imports never mutate live timers.
  if (payload.settings?.timezone !== undefined) {
    rescheduleAll();
  } else {
    for (const j of payload.jobs) addOrReplaceJob(j.id);
  }
  return counts;
}
