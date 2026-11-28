import { AiProviderError, ValidationError } from "@/lib/errors";
import { aiProviderInfo, type AiProviderId } from "./providers";

/**
 * Live model lists from each provider's own API, so the admin picks a model
 * from a dropdown instead of typing an id. Listing also proves the key works.
 */

export interface AiModelOption {
  id: string;
  label: string;
}

export interface ListModelsInput {
  provider: AiProviderId;
  apiKey?: string;
  baseUrl?: string;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const TIMEOUT_MS = 15_000;

/** OpenAI's list includes embeddings, audio, image and moderation models; keep the ones that chat with tools. */
const OPENAI_NON_CHAT = /(embedding|whisper|tts|dall-e|davinci|babbage|moderation|image|audio|realtime|transcribe|search|computer-use|codex-mini|sora)/iu;
const OPENAI_CHAT = /^(gpt-|o\d|chatgpt-)/iu;

export function normalizeBaseUrl(url: string | undefined): string | undefined {
  const t = url?.trim();
  if (!t) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(t);
  } catch {
    throw new ValidationError("Enter a full URL, for example https://host/v1", { baseUrl: "Invalid URL" });
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new ValidationError("The URL must start with http:// or https://", { baseUrl: "Invalid URL" });
  }
  return t.replace(/\/+$/u, "");
}

async function getJson(fetchImpl: FetchLike, url: string, headers: Record<string, string>, who: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    throw new AiProviderError(`Could not reach ${who}. Check the URL and that Argus can reach it.`, { cause: err });
  }
  if (res.status === 401 || res.status === 403) {
    throw new AiProviderError(`${who} rejected the API key.`);
  }
  if (!res.ok) {
    throw new AiProviderError(`${who} returned HTTP ${res.status} while listing models.`);
  }
  try {
    return await res.json();
  } catch (err) {
    throw new AiProviderError(`${who} did not return a model list.`, { cause: err });
  }
}

function arr(v: unknown, key: string): Record<string, unknown>[] {
  const x = (v as Record<string, unknown> | null)?.[key];
  return Array.isArray(x) ? (x as Record<string, unknown>[]) : [];
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

export async function listModels(input: ListModelsInput, fetchImpl: FetchLike = fetch): Promise<AiModelOption[]> {
  const info = aiProviderInfo(input.provider);
  const key = input.apiKey?.trim() ?? "";
  if (info.apiKey === "required" && !key) {
    throw new ValidationError(`Enter the ${info.label} API key first.`, { apiKey: "Required" });
  }
  const baseUrl = normalizeBaseUrl(input.baseUrl) ?? info.baseUrl?.defaultValue;
  if (info.baseUrl?.required && !baseUrl) {
    throw new ValidationError(`Enter the ${info.baseUrl.label.toLowerCase()} first.`, { baseUrl: "Required" });
  }

  switch (input.provider) {
    case "anthropic": {
      const body = await getJson(
        fetchImpl,
        "https://api.anthropic.com/v1/models?limit=1000",
        { "x-api-key": key, "anthropic-version": "2023-06-01" },
        info.label,
      );
      return arr(body, "data")
        .map((m) => ({ id: str(m.id), label: str(m.display_name) || str(m.id) }))
        .filter((m) => m.id);
    }
    case "openai": {
      const body = await getJson(fetchImpl, "https://api.openai.com/v1/models", { authorization: `Bearer ${key}` }, info.label);
      return arr(body, "data")
        .filter((m) => OPENAI_CHAT.test(str(m.id)) && !OPENAI_NON_CHAT.test(str(m.id)))
        .sort((a, b) => Number(b.created ?? 0) - Number(a.created ?? 0))
        .map((m) => ({ id: str(m.id), label: str(m.id) }));
    }
    case "google": {
      const body = await getJson(
        fetchImpl,
        "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000",
        { "x-goog-api-key": key },
        info.label,
      );
      return arr(body, "models")
        .filter((m) => {
          const methods = Array.isArray(m.supportedGenerationMethods) ? (m.supportedGenerationMethods as string[]) : [];
          return methods.includes("generateContent") && str(m.name).includes("gemini");
        })
        .map((m) => {
          const id = str(m.name).replace(/^models\//u, "");
          return { id, label: str(m.displayName) || id };
        })
        .reverse();
    }
    case "openrouter": {
      // The model list is public, so check the key separately.
      await getJson(fetchImpl, "https://openrouter.ai/api/v1/key", { authorization: `Bearer ${key}` }, info.label);
      const body = await getJson(fetchImpl, "https://openrouter.ai/api/v1/models", { authorization: `Bearer ${key}` }, info.label);
      return arr(body, "data")
        .filter((m) => Array.isArray(m.supported_parameters) && (m.supported_parameters as string[]).includes("tools"))
        .map((m) => ({ id: str(m.id), label: str(m.name) || str(m.id) }))
        .filter((m) => m.id);
    }
    case "ollama":
    case "openai-compatible": {
      const headers: Record<string, string> = key ? { authorization: `Bearer ${key}` } : {};
      const body = await getJson(fetchImpl, `${baseUrl}/models`, headers, info.label);
      return arr(body, "data")
        .map((m) => ({ id: str(m.id), label: str(m.id) }))
        .filter((m) => m.id)
        .sort((a, b) => a.id.localeCompare(b.id));
    }
    case "azure":
      // Azure calls a deployment the admin created; there is no portable way to list them with a data-plane key.
      return [];
  }
}
