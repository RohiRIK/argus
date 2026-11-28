import { generateText, type LanguageModel } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createAzure } from "@ai-sdk/azure";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { AiProviderError, ValidationError } from "@/lib/errors";
import { aiConfigService } from "./config";
import { aiProviderInfo, type AiProviderId } from "./providers";

/** Everything needed to call one model. */
export interface AiModelSettings {
  provider: AiProviderId;
  model: string;
  baseUrl: string | null;
  apiKey: string | undefined;
}

/** Build a Vercel AI SDK model for these settings. */
export function languageModel(s: AiModelSettings): LanguageModel {
  const apiKey = s.apiKey ?? "";
  switch (s.provider) {
    case "anthropic":
      return createAnthropic({ apiKey })(s.model);
    case "openai":
      return createOpenAI({ apiKey })(s.model);
    case "google":
      return createGoogleGenerativeAI({ apiKey })(s.model);
    case "azure": {
      // The SDK appends /v1 to an ".../openai" base URL and uses ".../openai/v1" as is.
      const endpoint = (s.baseUrl ?? "").replace(/\/+$/u, "");
      const baseURL = /\/openai(\/v1)?$/u.test(endpoint) ? endpoint : `${endpoint}/openai`;
      return createAzure({ apiKey, baseURL })(s.model);
    }
    case "openrouter":
      return createOpenAICompatible({ name: "openrouter", baseURL: "https://openrouter.ai/api/v1", apiKey })(s.model);
    case "ollama":
    case "openai-compatible":
      return createOpenAICompatible({
        name: s.provider,
        baseURL: s.baseUrl ?? aiProviderInfo(s.provider).baseUrl?.defaultValue ?? "",
        ...(apiKey ? { apiKey } : {}),
      })(s.model);
  }
}

/** The saved provider + model with its key, or a ValidationError naming what is missing. */
export function savedModelSettings(): AiModelSettings {
  const cfg = aiConfigService.get();
  if (!cfg.provider || !cfg.model) {
    throw new ValidationError("Choose an AI provider and model in Settings → AI first.");
  }
  return { provider: cfg.provider, model: cfg.model, baseUrl: cfg.baseUrl, apiKey: aiConfigService.apiKey(cfg.provider) };
}

export interface ModelTestResult {
  ok: boolean;
  latencyMs: number;
  reply?: string;
  error?: string;
}

export interface ModelTestDeps {
  generate?: (model: LanguageModel) => Promise<string>;
}

const defaultGenerate = async (model: LanguageModel) => {
  const res = await generateText({
    model,
    prompt: "Reply with the single word OK.",
    maxOutputTokens: 16,
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(30_000),
  });
  return res.text;
};

/** Safe one-line reason from a provider error (no keys, no stack). */
export function providerErrorMessage(err: unknown): string {
  if (err instanceof AiProviderError || err instanceof ValidationError) return err.message;
  const e = err as { statusCode?: number; message?: string; name?: string };
  if (e?.statusCode === 401 || e?.statusCode === 403) return "The provider rejected the API key.";
  if (e?.statusCode === 404) return "The provider does not know this model or deployment.";
  if (e?.statusCode === 429) return "The provider is rate limiting this key, or it has no credit left.";
  if (e?.name === "TimeoutError" || e?.name === "AbortError") return "The provider did not answer within 30 seconds.";
  const msg = typeof e?.message === "string" ? e.message : "The provider call failed.";
  return msg.length > 300 ? `${msg.slice(0, 300)}…` : msg;
}

/** Send one tiny prompt to the model, so the admin knows the setup works end to end. */
export async function testModel(s: AiModelSettings, deps: ModelTestDeps = {}): Promise<ModelTestResult> {
  const started = Date.now();
  try {
    const reply = await (deps.generate ?? defaultGenerate)(languageModel(s));
    return { ok: true, latencyMs: Date.now() - started, reply: reply.trim().slice(0, 80) };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - started, error: providerErrorMessage(err) };
  }
}
