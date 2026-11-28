import { integrationsDao } from "@/db/dao/integrations";
import { auditDao } from "@/db/dao/audit";
import { vaultService } from "@/services/vault/vault";
import { ValidationError } from "@/lib/errors";
import { AI_NOTICE_VERSION, aiProviderInfo, isAiProviderId, type AiProviderId } from "./providers";
import { normalizeBaseUrl } from "./models";

/**
 * AI investigations settings. Non-secret settings live on the `ai` integration
 * row; API keys live in the vault, one per provider (`ai_key_<provider>`), so
 * switching providers back and forth keeps each key.
 *
 * The feature is off until an admin accepts the experimental notice and turns it on.
 */

export const AI_INTEGRATION = "ai";

export interface AiNoticeAcceptance {
  version: number;
  acceptedAt: string;
  acceptedBy: string;
}

export interface AiConfig {
  enabled: boolean;
  provider: AiProviderId | null;
  model: string | null;
  baseUrl: string | null;
  notice: AiNoticeAcceptance | null;
}

export interface AiConfigView extends AiConfig {
  noticeVersion: number;
  /** Whether the accepted notice is the current one. */
  noticeCurrent: boolean;
  /** Providers that have a stored key (keys themselves are never returned). */
  keysStored: AiProviderId[];
  status: "connected" | "disconnected" | "error";
  lastCheck: string | null;
  lastError: string | null;
}

export const aiKeyName = (provider: AiProviderId) => `ai_key_${provider}`;

function row() {
  return (
    integrationsDao.findByProvider(AI_INTEGRATION) ??
    integrationsDao.upsert(AI_INTEGRATION, { name: "AI model provider", status: "disconnected" })
  );
}

function readConfig(raw: Record<string, unknown>): AiConfig {
  const n = raw.notice as Partial<AiNoticeAcceptance> | undefined;
  return {
    enabled: raw.enabled === true,
    provider: isAiProviderId(raw.provider) ? raw.provider : null,
    model: typeof raw.model === "string" && raw.model ? raw.model : null,
    baseUrl: typeof raw.baseUrl === "string" && raw.baseUrl ? raw.baseUrl : null,
    notice:
      n && typeof n.version === "number" && typeof n.acceptedAt === "string"
        ? { version: n.version, acceptedAt: n.acceptedAt, acceptedBy: String(n.acceptedBy ?? "unknown") }
        : null,
  };
}

function writeConfig(cfg: AiConfig, patch: Parameters<typeof integrationsDao.upsert>[1] = {}) {
  integrationsDao.upsert(AI_INTEGRATION, { ...patch, config: { ...cfg } });
}

export interface SaveProviderInput {
  provider: AiProviderId;
  model: string;
  baseUrl?: string | null;
  /** A new key; omitted keeps the stored one. */
  apiKey?: string;
}

export const aiConfigService = {
  get(): AiConfig {
    return readConfig(row().config);
  },

  view(): AiConfigView {
    const r = row();
    const cfg = readConfig(r.config);
    return {
      ...cfg,
      noticeVersion: AI_NOTICE_VERSION,
      noticeCurrent: cfg.notice?.version === AI_NOTICE_VERSION,
      keysStored: (["anthropic", "openai", "google", "azure", "openrouter", "ollama", "openai-compatible"] as const).filter((p) =>
        vaultService.has(aiKeyName(p)),
      ),
      status: r.status,
      lastCheck: r.lastHealthCheck,
      lastError: r.errorMessage,
    };
  },

  apiKey(provider: AiProviderId): string | undefined {
    return vaultService.get(aiKeyName(provider));
  },

  saveProvider(input: SaveProviderInput, actor: string): AiConfig {
    const info = aiProviderInfo(input.provider);
    const baseUrl = normalizeBaseUrl(input.baseUrl ?? undefined) ?? info.baseUrl?.defaultValue ?? null;
    if (info.baseUrl?.required && !baseUrl) {
      throw new ValidationError(`${info.baseUrl.label} is required for ${info.label}.`, { baseUrl: "Required" });
    }
    const key = input.apiKey?.trim();
    if (key) vaultService.set(aiKeyName(input.provider), key);
    if (info.apiKey === "required" && !vaultService.has(aiKeyName(input.provider))) {
      throw new ValidationError(`Enter the ${info.label} API key.`, { apiKey: "Required" });
    }
    const model = input.model.trim();
    if (!model) throw new ValidationError("Choose a model.", { model: "Required" });

    const prev = this.get();
    const next: AiConfig = { ...prev, provider: input.provider, model, baseUrl: info.baseUrl ? baseUrl : null };
    const changed = prev.provider !== next.provider || prev.model !== next.model || prev.baseUrl !== next.baseUrl;
    // A new provider, model or key has not been tested yet.
    writeConfig(next, changed || key ? { status: "disconnected", errorMessage: null } : {});
    auditDao.record({
      action: "ai.provider_saved",
      provider: AI_INTEGRATION,
      outcome: "success",
      detail: { actor, provider: next.provider, model: next.model, keyChanged: Boolean(key) },
    });
    return next;
  },

  removeKey(provider: AiProviderId, actor: string): void {
    vaultService.remove(aiKeyName(provider));
    auditDao.record({ action: "ai.key_removed", provider: AI_INTEGRATION, outcome: "success", detail: { actor, provider } });
  },

  /** Turn investigations on (requires accepting the current notice) or off. */
  setEnabled(enabled: boolean, acceptNotice: boolean, actor: string): AiConfig {
    const prev = this.get();
    let notice = prev.notice;
    if (enabled) {
      if (!prev.provider || !prev.model) {
        throw new ValidationError("Save an AI provider and model before turning on AI investigations.");
      }
      if (notice?.version !== AI_NOTICE_VERSION) {
        if (!acceptNotice) {
          throw new ValidationError("Read and accept the notice before turning on AI investigations.", {
            acceptNotice: "Required",
          });
        }
        notice = { version: AI_NOTICE_VERSION, acceptedAt: new Date().toISOString(), acceptedBy: actor };
      }
    }
    const next: AiConfig = { ...prev, enabled, notice };
    writeConfig(next);
    auditDao.record({
      action: enabled ? "ai.enabled" : "ai.disabled",
      provider: AI_INTEGRATION,
      outcome: "success",
      detail: { actor, noticeVersion: notice?.version ?? null },
    });
    return next;
  },

  recordCheck(ok: boolean, error: string | null): void {
    integrationsDao.upsert(AI_INTEGRATION, {
      status: ok ? "connected" : "error",
      errorMessage: ok ? null : error,
      lastHealthCheck: new Date().toISOString(),
    });
  },
};
