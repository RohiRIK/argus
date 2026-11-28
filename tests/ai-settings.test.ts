import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "argus-ai-"));
process.env.ARGUS_DB_PATH = join(dir, "test.db");
process.env.ARGUS_MASTER_KEY = "1".repeat(64);

const aiRoute = await import("../src/app/api/ai/route");
const enableRoute = await import("../src/app/api/ai/enable/route");
const keyRoute = await import("../src/app/api/ai/key/route");
const { listModels } = await import("../src/services/ai/models");
const { testModel, languageModel } = await import("../src/services/ai/model");
const { aiConfigService } = await import("../src/services/ai/config");
const { vaultService } = await import("../src/services/vault/vault");
const { auditDao } = await import("../src/db/dao/audit");
const { requiredRole } = await import("../src/lib/auth/roles");
const { runMigrations } = await import("../src/db/migrate");
const { closeDb } = await import("../src/db/client");

beforeAll(() => runMigrations());
afterAll(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

const req = (method: string, body?: unknown) =>
  new Request("http://t/api/ai", {
    method,
    headers: { "content-type": "application/json", "x-argus-user": "alice" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

function fakeFetch(routes: Record<string, { status?: number; body: unknown }>) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const impl = async (url: string, init?: RequestInit) => {
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    const hit = Object.entries(routes).find(([prefix]) => url.startsWith(prefix));
    if (!hit) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(hit[1].body), { status: hit[1].status ?? 200 });
  };
  return { impl, calls };
}

describe("AI provider settings API", () => {
  test("starts off with no provider and never returns keys", async () => {
    const b = await (await aiRoute.GET()).json();
    expect(b.success).toBe(true);
    expect(b.data.enabled).toBe(false);
    expect(b.data.provider).toBeNull();
    expect(b.data.providers.length).toBeGreaterThan(5);
  });

  test("a key is required for hosted providers", async () => {
    const res = await aiRoute.PUT(req("PUT", { provider: "anthropic", model: "claude-x" }));
    expect(res.status).toBe(400);
  });

  test("saves provider, model and key into the vault (masked)", async () => {
    const res = await aiRoute.PUT(req("PUT", { provider: "anthropic", model: "claude-x", apiKey: "sk-ant-secret-123" }));
    const b = await res.json();
    expect(b.success).toBe(true);
    expect(b.data.provider).toBe("anthropic");
    expect(b.data.model).toBe("claude-x");
    expect(b.data.keysStored).toEqual(["anthropic"]);
    expect(JSON.stringify(b.data)).not.toContain("sk-ant-secret-123");
    expect(vaultService.get("ai_key_anthropic")).toBe("sk-ant-secret-123");
    expect(vaultService.list().find((e) => e.key === "ai_key_anthropic")?.masked).toBe("••••••••");
    expect(auditDao.listForProvider("ai").some((a) => a.action === "ai.provider_saved")).toBe(true);

    // Saving again without a key keeps the stored key.
    await aiRoute.PUT(req("PUT", { provider: "anthropic", model: "claude-y" }));
    expect(aiConfigService.apiKey("anthropic")).toBe("sk-ant-secret-123");
  });

  test("Ollama needs no key and gets its default URL", async () => {
    const b = await (await aiRoute.PUT(req("PUT", { provider: "ollama", model: "llama3.1" }))).json();
    expect(b.success).toBe(true);
    expect(b.data.baseUrl).toBe("http://localhost:11434/v1");
  });

  test("rejects a bad base URL", async () => {
    const res = await aiRoute.PUT(req("PUT", { provider: "openai-compatible", model: "m", baseUrl: "ftp://x" }));
    expect(res.status).toBe(400);
  });

  test("turning on requires accepting the notice, and is audited", async () => {
    const denied = await enableRoute.POST(req("POST", { enabled: true }));
    expect(denied.status).toBe(400);

    const on = await (await enableRoute.POST(req("POST", { enabled: true, acceptNotice: true }))).json();
    expect(on.data.enabled).toBe(true);
    expect(on.data.noticeCurrent).toBe(true);
    expect(on.data.notice.acceptedBy).toBe("alice");

    const off = await (await enableRoute.POST(req("POST", { enabled: false }))).json();
    expect(off.data.enabled).toBe(false);
    // Already accepted: turning back on needs no second acceptance.
    const again = await (await enableRoute.POST(req("POST", { enabled: true }))).json();
    expect(again.data.enabled).toBe(true);

    const actions = auditDao.listForProvider("ai").map((a) => a.action);
    expect(actions).toContain("ai.enabled");
    expect(actions).toContain("ai.disabled");
  });

  test("removes a stored key", async () => {
    const b = await (await keyRoute.DELETE(req("DELETE", { provider: "anthropic" }))).json();
    expect(b.data.keysStored).toEqual([]);
    expect(vaultService.has("ai_key_anthropic")).toBe(false);
  });

  test("writes are admin-only, reads are open to viewers", () => {
    expect(requiredRole("GET", "/api/ai")).toBe("viewer");
    for (const p of ["/api/ai", "/api/ai/models", "/api/ai/test", "/api/ai/enable", "/api/ai/key"]) {
      expect(requiredRole("POST", p)).toBe("admin");
      expect(requiredRole("PUT", p)).toBe("admin");
      expect(requiredRole("DELETE", p)).toBe("admin");
    }
  });
});

describe("listModels", () => {
  test("Anthropic: sends the key header and keeps the provider's order", async () => {
    const f = fakeFetch({
      "https://api.anthropic.com/v1/models": {
        body: { data: [{ id: "claude-new", display_name: "Claude New" }, { id: "claude-old", display_name: "Claude Old" }] },
      },
    });
    const list = await listModels({ provider: "anthropic", apiKey: "k" }, f.impl);
    expect(list).toEqual([
      { id: "claude-new", label: "Claude New" },
      { id: "claude-old", label: "Claude Old" },
    ]);
    expect(f.calls[0].headers["x-api-key"]).toBe("k");
  });

  test("OpenAI: keeps chat models only, newest first", async () => {
    const f = fakeFetch({
      "https://api.openai.com/v1/models": {
        body: {
          data: [
            { id: "gpt-4o", created: 1 },
            { id: "text-embedding-3-small", created: 5 },
            { id: "o3", created: 3 },
            { id: "whisper-1", created: 4 },
            { id: "gpt-4o-mini-tts", created: 6 },
          ],
        },
      },
    });
    const ids = (await listModels({ provider: "openai", apiKey: "k" }, f.impl)).map((m) => m.id);
    expect(ids).toEqual(["o3", "gpt-4o"]);
  });

  test("Google: only Gemini models that generate content", async () => {
    const f = fakeFetch({
      "https://generativelanguage.googleapis.com/": {
        body: {
          models: [
            { name: "models/gemini-a", displayName: "Gemini A", supportedGenerationMethods: ["generateContent"] },
            { name: "models/embedding-001", supportedGenerationMethods: ["embedContent"] },
          ],
        },
      },
    });
    expect(await listModels({ provider: "google", apiKey: "k" }, f.impl)).toEqual([{ id: "gemini-a", label: "Gemini A" }]);
  });

  test("OpenRouter: checks the key and keeps models that support tools", async () => {
    const f = fakeFetch({
      "https://openrouter.ai/api/v1/key": { body: { data: {} } },
      "https://openrouter.ai/api/v1/models": {
        body: {
          data: [
            { id: "a/tools", name: "Tools", supported_parameters: ["tools"] },
            { id: "b/plain", name: "Plain", supported_parameters: [] },
          ],
        },
      },
    });
    expect(await listModels({ provider: "openrouter", apiKey: "k" }, f.impl)).toEqual([{ id: "a/tools", label: "Tools" }]);
  });

  test("Ollama: lists from the server URL without a key", async () => {
    const f = fakeFetch({ "http://box:11434/v1/models": { body: { data: [{ id: "qwen3" }, { id: "llama3.1" }] } } });
    const list = await listModels({ provider: "ollama", baseUrl: "http://box:11434/v1/" }, f.impl);
    expect(list.map((m) => m.id)).toEqual(["llama3.1", "qwen3"]);
    expect(f.calls[0].headers.authorization).toBeUndefined();
  });

  test("a rejected key becomes a clear AiProviderError", async () => {
    const f = fakeFetch({ "https://api.openai.com/": { status: 401, body: {} } });
    await expect(listModels({ provider: "openai", apiKey: "bad" }, f.impl)).rejects.toThrow("rejected the API key");
  });

  test("an unreachable server becomes a clear AiProviderError", async () => {
    const impl = async () => {
      throw new TypeError("fetch failed");
    };
    await expect(listModels({ provider: "ollama", baseUrl: "http://nowhere:1/v1" }, impl)).rejects.toThrow("Could not reach");
  });

  test("a missing key fails before any request", async () => {
    const f = fakeFetch({});
    await expect(listModels({ provider: "anthropic" }, f.impl)).rejects.toThrow("API key");
    expect(f.calls.length).toBe(0);
  });
});

describe("model adapters", () => {
  test("every provider builds an AI SDK model", () => {
    for (const provider of ["anthropic", "openai", "google", "azure", "openrouter", "ollama", "openai-compatible"] as const) {
      const m = languageModel({ provider, model: "m", baseUrl: "https://x.example.com/v1", apiKey: "k" });
      expect(typeof m === "object" && m !== null).toBe(true);
    }
  });

  test("testModel reports success and safe failures", async () => {
    const s = { provider: "anthropic" as const, model: "m", baseUrl: null, apiKey: "k" };
    const good = await testModel(s, { generate: async () => "OK" });
    expect(good).toMatchObject({ ok: true, reply: "OK" });

    const bad = await testModel(s, {
      generate: async () => {
        throw Object.assign(new Error("Unauthorized: key sk-ant-123"), { statusCode: 401 });
      },
    });
    expect(bad.ok).toBe(false);
    expect(bad.error).toBe("The provider rejected the API key.");
  });
});
