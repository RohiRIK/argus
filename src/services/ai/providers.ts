/**
 * AI model providers Argus can use for investigations.
 *
 * Client-safe: no SDK imports here, so the settings page can render the same list.
 * The runtime adapters live in `model.ts` (Vercel AI SDK) and `models.ts` (model listing).
 */

export const AI_PROVIDER_IDS = [
  "anthropic",
  "openai",
  "google",
  "azure",
  "openrouter",
  "ollama",
  "openai-compatible",
] as const;

export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

export interface AiProviderInfo {
  id: AiProviderId;
  label: string;
  hint: string;
  /** "required": must have a key; "optional": local servers usually run without one. */
  apiKey: "required" | "optional";
  keyPlaceholder?: string;
  /** Where to create a key, shown next to the field. */
  keyUrl?: string;
  /** Base URL / endpoint field, when the provider needs one. */
  baseUrl?: { label: string; placeholder: string; defaultValue?: string; required: boolean };
  /** "list": models are loaded from the provider; "deployment": the admin types an Azure deployment name. */
  modelSource: "list" | "deployment";
}

export const AI_PROVIDERS: readonly AiProviderInfo[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    hint: "Claude models",
    apiKey: "required",
    keyPlaceholder: "sk-ant-…",
    keyUrl: "https://console.anthropic.com/settings/keys",
    modelSource: "list",
  },
  {
    id: "openai",
    label: "OpenAI",
    hint: "GPT and o-series models",
    apiKey: "required",
    keyPlaceholder: "sk-…",
    keyUrl: "https://platform.openai.com/api-keys",
    modelSource: "list",
  },
  {
    id: "google",
    label: "Google Gemini",
    hint: "Gemini models",
    apiKey: "required",
    keyPlaceholder: "AIza…",
    keyUrl: "https://aistudio.google.com/apikey",
    modelSource: "list",
  },
  {
    id: "azure",
    label: "Azure OpenAI",
    hint: "Your own Azure deployment",
    apiKey: "required",
    keyPlaceholder: "Azure OpenAI key",
    baseUrl: {
      label: "Endpoint",
      placeholder: "https://my-resource.openai.azure.com",
      required: true,
    },
    modelSource: "deployment",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    hint: "Hundreds of models, one key",
    apiKey: "required",
    keyPlaceholder: "sk-or-…",
    keyUrl: "https://openrouter.ai/keys",
    modelSource: "list",
  },
  {
    id: "ollama",
    label: "Ollama",
    hint: "Local models, data stays on your server",
    apiKey: "optional",
    baseUrl: {
      label: "Server URL",
      placeholder: "http://localhost:11434/v1",
      defaultValue: "http://localhost:11434/v1",
      required: true,
    },
    modelSource: "list",
  },
  {
    id: "openai-compatible",
    label: "OpenAI-compatible",
    hint: "LM Studio, vLLM, LiteLLM and other gateways",
    apiKey: "optional",
    baseUrl: {
      label: "Base URL",
      placeholder: "https://gateway.example.com/v1",
      required: true,
    },
    modelSource: "list",
  },
];

export function isAiProviderId(v: unknown): v is AiProviderId {
  return typeof v === "string" && (AI_PROVIDER_IDS as readonly string[]).includes(v);
}

export function aiProviderInfo(id: AiProviderId): AiProviderInfo {
  const info = AI_PROVIDERS.find((p) => p.id === id);
  if (!info) throw new Error(`Unknown AI provider ${id}`);
  return info;
}

/** Bumped when the experimental-feature notice changes, so admins accept the new text. */
export const AI_NOTICE_VERSION = 1;
