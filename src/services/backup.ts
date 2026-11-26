import { getDb } from "@/db/client";
import { jobsDao } from "@/db/dao/jobs";
import { templatesDao } from "@/db/dao/templates";
import { settingsDao } from "@/db/dao/settings";
import { maintenanceWindowsDao } from "@/db/dao/maintenance-windows";
import { recipientGroupsDao } from "@/db/dao/recipient-groups";
import { integrationsDao } from "@/db/dao/integrations";
import { addOrReplaceJob, removeJob, rescheduleAll } from "@/services/scheduler";
import { ValidationError } from "@/lib/errors";
import type { Job, MaintenanceWindow, RecipientGroup, Settings, Template } from "@/db/schema";

/** Portable config snapshot — jobs + templates + maintenance windows + recipient groups + non-secret settings. NEVER includes vault credentials or the master key (BK-1). */
export interface BackupPayload {
  version: 1;
  exportedAt: string;
  jobs: Job[];
  templates: Template[];
  maintenanceWindows?: MaintenanceWindow[];
  recipientGroups?: RecipientGroup[];
  settings: {
    globalRecipients: string[];
    globalRecipientGroupIds?: string[];
    adminContacts: string[];
    language: "en" | "he";
    timezone: string;
    retentionDays: number;
    fromAddress: string | null;
    replyTo: string | null;
    organizationDisplayName?: string | null;
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
    recipientGroups: recipientGroupsDao.findAll(),
    settings: {
      globalRecipients: s.globalRecipients,
      globalRecipientGroupIds: s.globalRecipientGroupIds,
      adminContacts: s.adminContacts,
      language: s.language,
      timezone: s.timezone,
      retentionDays: s.retentionDays,
      fromAddress: s.fromAddress,
      replyTo: s.replyTo,
      organizationDisplayName: s.organizationDisplayName ?? null,
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
  if (b.recipientGroups !== undefined) {
    if (!Array.isArray(b.recipientGroups)) throw new ValidationError("recipientGroups must be an array");
    if (b.recipientGroups.some((g) => !g?.id)) throw new ValidationError("Every recipient group needs an id");
  }
  if (b.settings !== undefined && (b.settings === null || typeof b.settings !== "object" || Array.isArray(b.settings))) {
    throw new ValidationError("settings must be an object");
  }
}

/** Settings keys a bundle may carry. Anything else (masterKeyHash, permission state, …) is ignored. */
const IMPORTABLE_SETTINGS = [
  "globalRecipients",
  "globalRecipientGroupIds",
  "adminContacts",
  "language",
  "timezone",
  "retentionDays",
  "fromAddress",
  "replyTo",
  "organizationDisplayName",
  "alertThreshold",
  "suppressEmptyReports",
] as const satisfies readonly (keyof BackupPayload["settings"])[];

type ImportableSettingKey = (typeof IMPORTABLE_SETTINGS)[number];
export type SettingsPatch = Partial<Pick<Settings, ImportableSettingKey>>;

function isEmptyValue(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);
}

/**
 * The settings patch an import would apply. Only whitelisted keys the bundle explicitly
 * carries are applied, and a bundle's empty/null value never clears a value the target
 * already has (H6) — e.g. a bundle exported before a from-address was configured must not
 * wipe the target's from-address. Unchanged keys are omitted.
 */
export function settingsPatchFor(bundle: Partial<BackupPayload["settings"]> | undefined, current: Settings): SettingsPatch {
  const patch: Record<string, unknown> = {};
  if (!bundle || typeof bundle !== "object") return patch;
  for (const key of IMPORTABLE_SETTINGS) {
    if (!Object.prototype.hasOwnProperty.call(bundle, key)) continue;
    const next = bundle[key];
    if (next === undefined) continue;
    const cur = current[key];
    if (isEmptyValue(next) && !isEmptyValue(cur)) continue;
    if (JSON.stringify(next) === JSON.stringify(cur)) continue;
    patch[key] = next;
  }
  return patch as SettingsPatch;
}

export interface ImportPreviewItem {
  id: string;
  name: string;
  action: "create" | "update";
}

export interface ImportPreviewJob extends ImportPreviewItem {
  reportType: string;
  /** True when the job carries a schedule (preset or cron) that would fire once activated. */
  scheduled: boolean;
  /** Status in the bundle. */
  bundleStatus: Job["status"];
  /** Status the job will have after import (always "disabled" unless `activate` is set). */
  importedStatus: Job["status"];
}

export interface ImportMissingReference {
  /** Job id (or "settings" for global recipient groups) that holds the dangling reference. */
  ownerId: string;
  ownerName: string;
  kind: "template" | "recipientGroup";
  refId: string;
}

export interface ImportPreview {
  exportedAt: string | null;
  jobs: { create: number; update: number; scheduled: number; items: ImportPreviewJob[] };
  templates: { create: number; update: number; items: ImportPreviewItem[] };
  recipientGroups: { create: number; update: number; items: ImportPreviewItem[] };
  maintenanceWindows: { create: number; update: number; items: ImportPreviewItem[] };
  /** Settings keys the import would change on the target (values stay out of the preview). */
  settingsChanges: string[];
  /** References satisfied by neither the bundle nor the target DB. Missing templates block the import. */
  missingReferences: ImportMissingReference[];
  /** Read-only target context — never includes credentials. */
  integration: { provider: "microsoft365"; status: "connected" | "disconnected" | "error"; connected: boolean };
  /** Whether jobs would be activated (explicit opt-in only). */
  activate: boolean;
}

function summarize<T extends { id: string; name?: string }>(rows: T[], exists: (id: string) => boolean) {
  const items: ImportPreviewItem[] = rows.map((r) => ({ id: r.id, name: r.name ?? r.id, action: exists(r.id) ? "update" : "create" }));
  return {
    create: items.filter((i) => i.action === "create").length,
    update: items.filter((i) => i.action === "update").length,
    items,
  };
}

function hasSchedule(j: Job): boolean {
  return j.scheduleType === "cron" ? !!j.cronExpression : !!j.schedulePreset;
}

function importedStatus(j: Job, activate: boolean): Job["status"] {
  return activate && j.status !== "disabled" ? "active" : "disabled";
}

function findMissingReferences(p: BackupPayload): ImportMissingReference[] {
  const bundleTemplates = new Set(p.templates.map((t) => t.id));
  const bundleGroups = new Set((p.recipientGroups ?? []).map((g) => g.id));
  const templateExists = (id: string) => bundleTemplates.has(id) || !!templatesDao.findById(id);
  const groupExists = (id: string) => bundleGroups.has(id) || !!recipientGroupsDao.findById(id);
  const missing: ImportMissingReference[] = [];
  for (const j of p.jobs) {
    if (j.templateId && !templateExists(j.templateId)) {
      missing.push({ ownerId: j.id, ownerName: j.name, kind: "template", refId: j.templateId });
    }
    for (const g of Array.isArray(j.recipientGroupIds) ? j.recipientGroupIds : []) {
      if (!groupExists(g)) missing.push({ ownerId: j.id, ownerName: j.name, kind: "recipientGroup", refId: g });
    }
  }
  const globalGroups = p.settings?.globalRecipientGroupIds;
  for (const g of Array.isArray(globalGroups) ? globalGroups : []) {
    if (!groupExists(g)) missing.push({ ownerId: "settings", ownerName: "Global recipients", kind: "recipientGroup", refId: g });
  }
  return missing;
}

/** Dry run (H6): validate the bundle and describe what an import would do. Writes nothing. */
export function previewImport(payload: unknown, opts: { activate?: boolean } = {}): ImportPreview {
  assertValid(payload);
  const activate = opts.activate === true;
  const jobs = summarize(payload.jobs, (id) => !!jobsDao.findById(id));
  const jobItems: ImportPreviewJob[] = payload.jobs.map((j, i) => ({
    ...jobs.items[i],
    reportType: j.reportType,
    scheduled: hasSchedule(j),
    bundleStatus: j.status === "disabled" ? "disabled" : "active",
    importedStatus: importedStatus(j, activate),
  }));
  const status = integrationsDao.findByProvider("microsoft365")?.status ?? "disconnected";
  return {
    exportedAt: typeof payload.exportedAt === "string" ? payload.exportedAt : null,
    jobs: { create: jobs.create, update: jobs.update, scheduled: jobItems.filter((j) => j.scheduled).length, items: jobItems },
    templates: summarize(payload.templates, (id) => !!templatesDao.findById(id)),
    recipientGroups: summarize(payload.recipientGroups ?? [], (id) => !!recipientGroupsDao.findById(id)),
    maintenanceWindows: summarize(payload.maintenanceWindows ?? [], (id) => !!maintenanceWindowsDao.findById(id)),
    settingsChanges: Object.keys(settingsPatchFor(payload.settings, settingsDao.get())),
    missingReferences: findMissingReferences(payload),
    integration: { provider: "microsoft365", status, connected: status === "connected" },
    activate,
  };
}

/** Scheduler hooks used after an import commits (overridable for tests). */
export interface BackupDeps {
  addOrReplaceJob: (id: string) => boolean;
  removeJob: (id: string) => void;
  rescheduleAll: () => unknown;
}

const defaultDeps: BackupDeps = { addOrReplaceJob, removeJob, rescheduleAll };

export interface ImportCounts {
  jobs: number;
  templates: number;
  maintenanceWindows: number;
  recipientGroups: number;
  /** Jobs the import left paused (all of them unless `activate` was requested). */
  pausedJobs: number;
}

/**
 * Restore a config bundle. Every imported job lands `disabled` (paused) unless
 * `opts.activate` is explicitly true — a config bundle is not a vault backup, and
 * an import must never silently start sending reports on a new target (H6). The
 * import never triggers a run or a dispatch.
 */
export function importBackup(
  payload: unknown,
  opts: { activate?: boolean } = {},
  deps: BackupDeps = defaultDeps,
): ImportCounts {
  assertValid(payload);
  const activate = opts.activate === true;

  // A dangling templateId would fail the FK mid-transaction; reject up front with a clear message.
  const missingTemplates = findMissingReferences(payload).filter((m) => m.kind === "template");
  if (missingTemplates.length) {
    throw new ValidationError(
      `Backup references missing template(s): ${[...new Set(missingTemplates.map((m) => m.refId))].join(", ")}`,
    );
  }

  const before = settingsDao.get();
  const settingsPatch = settingsPatchFor(payload.settings, before);

  const counts = getDb().transaction(() => {
    // Templates first — jobs reference templateId.
    let templates = 0;
    for (const t of payload.templates) {
      if (templatesDao.findById(t.id)) templatesDao.update(t.id, t);
      else templatesDao.create(t);
      templates++;
    }
    let recipientGroups = 0;
    for (const g of payload.recipientGroups ?? []) {
      if (recipientGroupsDao.findById(g.id)) recipientGroupsDao.update(g.id, g);
      else recipientGroupsDao.create(g);
      recipientGroups++;
    }
    let jobs = 0;
    let pausedJobs = 0;
    for (const j of payload.jobs) {
      const row = { ...j, status: importedStatus(j, activate) };
      if (row.status === "disabled") pausedJobs++;
      if (jobsDao.findById(j.id)) jobsDao.update(j.id, row);
      else jobsDao.create(row);
      jobs++;
    }
    let windows = 0;
    for (const w of payload.maintenanceWindows ?? []) {
      if (maintenanceWindowsDao.findById(w.id)) maintenanceWindowsDao.update(w.id, w);
      else maintenanceWindowsDao.create(w);
      windows++;
    }
    if (Object.keys(settingsPatch).length) settingsDao.update(settingsPatch);
    return { jobs, templates, maintenanceWindows: windows, recipientGroups, pausedJobs };
  });

  // Scheduler sync after commit so failed imports never mutate live timers.
  // Paused jobs only drop a live timer an overwritten job may have had; imported
  // jobs are registered only with the explicit `activate` opt-in.
  for (const j of payload.jobs) {
    if (importedStatus(j, activate) === "active") deps.addOrReplaceJob(j.id);
    else deps.removeJob(j.id);
  }
  // A timezone change re-times the target's existing active jobs (imported ones stay paused).
  if (settingsPatch.timezone !== undefined) deps.rescheduleAll();
  return counts;
}
