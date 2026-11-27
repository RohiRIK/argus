import type { Job } from "@/db/schema";
import { recipientGroupsDao } from "@/db/dao/recipient-groups";
import { settingsDao } from "@/db/dao/settings";
import { integrationsDao } from "@/db/dao/integrations";
import { groupEffectiveEmails } from "@/services/graph/groups";
import { effectiveSender, type CapabilityReport } from "@/services/graph/capabilities";

/**
 * Shared readiness contract (plan H3 + H4). Every path that creates, activates
 * or runs a job asks the same questions here, so catalog quick-enable, the
 * starter pack, clone, the full editor, scheduled runs and Run Now agree.
 */

export type BlockerCode = "no_recipients" | "no_sender" | "no_mail_send";

export interface JobBlocker {
  code: BlockerCode;
  message: string;
  /** Where the operator fixes it. */
  repairHref: string;
}

type JobRecipientsShape = Pick<Job, "recipients" | "recipientGroupIds"> & { deliveryMode?: Job["deliveryMode"] };

/**
 * Addresses a run would email right now, from cached group members (no Graph
 * calls). Mirrors resolveJobRecipients(): job-level lists win; only when both
 * are empty do the global defaults apply.
 */
export function plannedRecipients(job: JobRecipientsShape, settings = settingsDao.get()): string[] {
  const jobScope = job.recipients.length > 0 || job.recipientGroupIds.length > 0;
  const direct = jobScope ? job.recipients : (settings.globalRecipients ?? []);
  const groupIds = jobScope ? job.recipientGroupIds : (settings.globalRecipientGroupIds ?? []);
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (raw: string) => {
    const a = raw.trim();
    if (!a.includes("@") || seen.has(a.toLowerCase())) return;
    seen.add(a.toLowerCase());
    out.push(a);
  };
  direct.forEach(push);
  for (const id of groupIds) {
    const g = recipientGroupsDao.findById(id);
    if (g) groupEffectiveEmails(g).forEach(push);
  }
  return out;
}

/** Configuration blockers that make an email job undeliverable. Compute-only jobs have none. */
export function jobBlockers(job: JobRecipientsShape & { id?: string }, settings = settingsDao.get()): JobBlocker[] {
  if (job.deliveryMode === "none") return [];
  const edit = job.id ? `/jobs/${job.id}/edit` : "/settings/recipients";
  if (plannedRecipients(job, settings).length === 0) {
    return [
      {
        code: "no_recipients",
        message: "No one would receive this report: add recipients or a recipient group, or make the job compute-only.",
        repairHref: edit,
      },
    ];
  }
  return [];
}

/**
 * Activation policy: a job asked to be active but with blockers is saved
 * paused instead, and the blockers are returned so the UI can link to the fix.
 */
export function activationDecision(
  requested: "active" | "disabled",
  job: JobRecipientsShape & { id?: string },
): { status: "active" | "disabled"; blockers: JobBlocker[] } {
  const blockers = jobBlockers(job);
  if (requested === "active" && blockers.length > 0) return { status: "disabled", blockers };
  return { status: requested, blockers };
}

export interface DeliveryPreflight {
  canDeliver: boolean;
  reason?: string;
  blockers: JobBlocker[];
}

/**
 * Can Argus send mail right now? Used identically by scheduled runs and Run Now.
 * Prefers the per-capability result of the last Test Connection; falls back to
 * the stored granted scopes for installs that have not re-tested since H2.
 */
export function deliveryPreflight(settings = settingsDao.get()): DeliveryPreflight {
  const cfg = (integrationsDao.findByProvider("microsoft365")?.config ?? {}) as Record<string, unknown>;
  const capabilities = cfg.capabilities as CapabilityReport | undefined;
  const granted = Array.isArray(cfg.grantedScopes) ? (cfg.grantedScopes as string[]) : [];
  const hasMailSend = capabilities
    ? capabilities.deliver.missing.length === 0 && capabilities.readable
    : settings.permissionStatus === "ok" || granted.includes("Mail.Send");
  const sender = effectiveSender(settings);

  const blockers: JobBlocker[] = [];
  if (!hasMailSend) {
    blockers.push({
      code: "no_mail_send",
      message: "Mail.Send is not verified — run Test Connection or grant consent.",
      repairHref: "/settings/integrations",
    });
  }
  if (!sender.address) {
    blockers.push({
      code: "no_sender",
      message: "No sender address — set a From address in Settings or a mailbox in Integrations.",
      repairHref: "/settings/integrations",
    });
  }
  return { canDeliver: blockers.length === 0, reason: blockers[0]?.message, blockers };
}
