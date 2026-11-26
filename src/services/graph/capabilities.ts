import { integrationsDao } from "@/db/dao/integrations";
import { settingsDao } from "@/db/dao/settings";
import { vaultService } from "@/services/vault/vault";
import { listReports } from "@/services/reports/registry";
import { ValidationError } from "@/lib/errors";

/**
 * Capability model (plan H2). Argus asks Microsoft Graph for three independent
 * things, and readiness is judged per capability:
 *
 *  - read:            every report's `requiredPermissions` (always requested)
 *  - deliver:         `Mail.Send` from one effective sender (always requested)
 *  - directoryWrite:  `Group.ReadWrite.All` to create/manage Entra groups —
 *                     OPT-IN only; off by default for new and existing installs.
 *
 * Revoking a grant already given in Entra is the operator's call; turning the
 * option off only stops Argus from requesting and using it.
 */

export const DELIVERY_SCOPES = ["Mail.Send"] as const;
export const DIRECTORY_WRITE_SCOPES = ["Group.ReadWrite.All"] as const;

export type CapabilityId = "read" | "deliver" | "directoryWrite";

/** Application permissions the reports need (placeholders like "(depends on …)" skipped). */
export function readScopes(): string[] {
  const set = new Set<string>();
  for (const r of listReports()) {
    for (const p of r.requiredPermissions) if (!p.startsWith("(")) set.add(p);
  }
  for (const s of [...DELIVERY_SCOPES, ...DIRECTORY_WRITE_SCOPES]) set.delete(s);
  return [...set].sort();
}

/** Grouped scopes for explaining consent before it is requested. */
export function scopeGroups(directoryWrites: boolean): Record<CapabilityId, string[]> {
  return {
    read: readScopes(),
    deliver: [...DELIVERY_SCOPES],
    directoryWrite: directoryWrites ? [...DIRECTORY_WRITE_SCOPES] : [],
  };
}

/** Pure: the full set of application permissions to request. */
export function scopesFor(opts: { directoryWrites: boolean }): string[] {
  const g = scopeGroups(opts.directoryWrites);
  return [...new Set([...g.read, ...g.deliver, ...g.directoryWrite])].sort();
}

/** Has the operator opted in to Entra group writes? Stored on the M365 integration config. */
export function directoryWritesEnabled(): boolean {
  const cfg = (integrationsDao.findByProvider("microsoft365")?.config ?? {}) as Record<string, unknown>;
  return cfg.directoryWrites === true;
}

export function setDirectoryWrites(enabled: boolean): void {
  const existing = integrationsDao.findByProvider("microsoft365");
  const cfg = (existing?.config ?? {}) as Record<string, unknown>;
  integrationsDao.upsert("microsoft365", {
    name: existing?.name ?? "Microsoft 365",
    status: existing?.status ?? "disconnected",
    config: { ...cfg, directoryWrites: enabled },
  });
}

/** Throw a clear, actionable error when a directory write is attempted without opt-in. */
export function assertDirectoryWrites(action: string, enabled: boolean = directoryWritesEnabled()): void {
  if (!enabled) {
    throw new ValidationError(
      `Directory writes are off — Argus will not ${action}. Turn on "Manage Entra groups" in Settings → Integrations (requests Group.ReadWrite.All) and grant consent, or use a local recipient group.`,
    );
  }
}

export interface EffectiveSender {
  address: string | null;
  source: "settings" | "vault" | "none";
}

/**
 * The one sender address used for delivery: Settings "From address" first,
 * then the vault mailbox. Executor, test-send and the connection test all use
 * this so they verify the same identity that actually sends.
 */
export function effectiveSender(
  settings: { fromAddress?: string | null } = settingsDao.get(),
  vaultMailbox: string | null | undefined = vaultService.get("mailbox"),
): EffectiveSender {
  const fromSettings = settings.fromAddress?.trim();
  if (fromSettings) return { address: fromSettings, source: "settings" };
  const fromVault = vaultMailbox?.trim();
  if (fromVault) return { address: fromVault, source: "vault" };
  return { address: null, source: "none" };
}

export interface CapabilityState {
  ok: boolean;
  missing: string[];
}

export interface CapabilityReport {
  /** null = granted permissions could not be read (consent pending), so readiness is unknown. */
  readable: boolean;
  read: CapabilityState;
  deliver: CapabilityState & { sender: EffectiveSender };
  directoryWrite: CapabilityState & { enabled: boolean };
}

/** Pure readiness per capability from the granted application permissions. */
export function evaluateCapabilities(input: {
  granted: string[] | null;
  directoryWrites: boolean;
  sender: EffectiveSender;
}): CapabilityReport {
  const groups = scopeGroups(input.directoryWrites);
  const g = new Set(input.granted ?? []);
  const missing = (scopes: string[]) => (input.granted === null ? scopes : scopes.filter((s) => !g.has(s)));
  const read = missing(groups.read);
  const deliver = missing(groups.deliver);
  const dir = missing(groups.directoryWrite);
  return {
    readable: input.granted !== null,
    read: { ok: input.granted !== null && read.length === 0, missing: read },
    deliver: {
      ok: input.granted !== null && deliver.length === 0 && Boolean(input.sender.address),
      missing: deliver,
      sender: input.sender,
    },
    directoryWrite: {
      enabled: input.directoryWrites,
      ok: input.directoryWrites ? input.granted !== null && dir.length === 0 : true,
      missing: dir,
    },
  };
}
