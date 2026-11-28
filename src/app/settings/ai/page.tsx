"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconAlert, IconEye, IconEyeOff, IconRefresh, IconSpark } from "@/components/icons";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Select, Skeleton } from "@/components/ui/primitives";
import { useCurrentUser } from "@/lib/use-current-user";
import { cn } from "@/lib/utils";
import type { AiProviderId, AiProviderInfo } from "@/services/ai/providers";

interface AiView {
  enabled: boolean;
  provider: AiProviderId | null;
  model: string | null;
  baseUrl: string | null;
  notice: { version: number; acceptedAt: string; acceptedBy: string } | null;
  noticeVersion: number;
  noticeCurrent: boolean;
  keysStored: AiProviderId[];
  status: "connected" | "disconnected" | "error";
  lastCheck: string | null;
  lastError: string | null;
  providers: AiProviderInfo[];
}

interface ModelOption {
  id: string;
  label: string;
}

type Msg = { ok: boolean; text: string } | null;

const STATUS_TONE: Record<AiView["status"], string> = {
  connected: "bg-success/10 text-success border-success/20",
  disconnected: "bg-surface-2 text-fg-muted border-border/40",
  error: "bg-danger/10 text-danger border-danger/20",
};

const STATUS_LABEL: Record<AiView["status"], string> = {
  connected: "Tested",
  disconnected: "Not tested",
  error: "Test failed",
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function Notice({ compact }: { compact: boolean }) {
  return (
    <div
      className="flex items-start gap-3 rounded-lg border border-warning/30 border-l-2 border-l-warning bg-warning/5 p-4"
      data-testid="ai-notice"
    >
      <IconAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
      <div className="space-y-1.5">
        <p className="text-sm font-semibold text-fg">AI investigations are experimental</p>
        {compact ? (
          <p className="text-xs leading-relaxed text-fg-muted">
            Tenant data is sent to the AI provider you chose. Findings can be wrong, so review them before you act.
          </p>
        ) : (
          <ul className="list-disc space-y-1 pl-4 text-xs leading-relaxed text-fg-muted">
            <li>
              To answer a question, Argus sends data from your Microsoft 365 tenant (users, sign-ins, devices, report
              results) to the AI provider you choose below. That provider&apos;s terms and data handling apply.
            </li>
            <li>AI findings can be incomplete or wrong. Review them before acting on them.</li>
            <li>
              Agents only read data. A change they suggest runs only after an admin approves it, through the same
              Audit → Enforce flow as any automation.
            </li>
            <li>
              Using this feature is your organization&apos;s responsibility, including checking that it fits your
              privacy and compliance policies. Choose Ollama to keep data on your own server.
            </li>
          </ul>
        )}
      </div>
    </div>
  );
}

export default function AiSettingsPage() {
  const me = useCurrentUser();
  const isAdmin = me?.role === "admin";

  const [view, setView] = useState<AiView | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  // Form state
  const [provider, setProvider] = useState<AiProviderId>("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [models, setModels] = useState<ModelOption[]>([]);
  const [modelFilter, setModelFilter] = useState("");
  const [modelsBusy, setModelsBusy] = useState(false);
  const [modelsMsg, setModelsMsg] = useState<Msg>(null);

  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<Msg>(null);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<Msg>(null);

  const [accept, setAccept] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [toggleMsg, setToggleMsg] = useState<Msg>(null);

  const modelsReq = useRef(0);

  const applyView = useCallback((v: AiView, resetForm: boolean) => {
    setView(v);
    if (resetForm) {
      const p = v.provider ?? "anthropic";
      const info = v.providers.find((x) => x.id === p);
      setProvider(p);
      setModel(v.model ?? "");
      setBaseUrl(v.baseUrl ?? info?.baseUrl?.defaultValue ?? "");
    }
  }, []);

  useEffect(() => {
    void fetch("/api/ai")
      .then((r) => r.json())
      .then((b) => (b.success ? applyView(b.data as AiView, true) : setLoadErr(b.error?.message ?? "Failed to load")))
      .catch(() => setLoadErr("Failed to load"));
  }, [applyView]);

  const info = useMemo(() => view?.providers.find((p) => p.id === provider) ?? null, [view, provider]);
  const keyStored = Boolean(view?.keysStored.includes(provider));
  const saved = Boolean(view?.provider && view.model);
  const dirty =
    !view ||
    view.provider !== provider ||
    (view.model ?? "") !== model ||
    (info?.baseUrl ? (view.baseUrl ?? "") !== baseUrl.trim().replace(/\/+$/u, "") : false) ||
    apiKey.trim() !== "";

  const canList =
    Boolean(info) &&
    info?.modelSource === "list" &&
    (apiKey.trim() !== "" || keyStored || info?.apiKey === "optional") &&
    (!info?.baseUrl?.required || baseUrl.trim() !== "");

  const loadModels = useCallback(async () => {
    if (!info || !canList || !isAdmin) return;
    const seq = ++modelsReq.current;
    setModelsBusy(true);
    setModelsMsg(null);
    try {
      const res = await fetch("/api/ai/models", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider,
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
          ...(info.baseUrl ? { baseUrl: baseUrl.trim() } : {}),
        }),
      });
      const b = await res.json();
      if (seq !== modelsReq.current) return;
      if (b.success) {
        const list = b.data as ModelOption[];
        setModels(list);
        setModelsMsg(list.length ? null : { ok: false, text: "The provider returned no models that can use tools." });
        setModel((m) => (m && list.some((x) => x.id === m) ? m : (list[0]?.id ?? "")));
      } else {
        setModels([]);
        setModelsMsg({ ok: false, text: b.error?.message ?? "Could not load models" });
      }
    } catch {
      if (seq === modelsReq.current) setModelsMsg({ ok: false, text: "Could not load models" });
    } finally {
      if (seq === modelsReq.current) setModelsBusy(false);
    }
  }, [info, canList, isAdmin, provider, apiKey, baseUrl]);

  // Load the model list as soon as there is enough to ask the provider (debounced while typing).
  useEffect(() => {
    if (!canList || !isAdmin) return;
    const t = setTimeout(() => void loadModels(), apiKey || baseUrl ? 600 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, apiKey, baseUrl, keyStored, isAdmin]);

  function pickProvider(p: AiProviderInfo) {
    if (p.id === provider) return;
    setProvider(p.id);
    setApiKey("");
    setShowKey(false);
    setModel(view?.provider === p.id ? (view.model ?? "") : "");
    setBaseUrl(view?.provider === p.id ? (view.baseUrl ?? "") : (p.baseUrl?.defaultValue ?? ""));
    setModelFilter("");
    setModels([]);
    setModelsMsg(null);
    setSaveMsg(null);
    setTestMsg(null);
  }

  async function test() {
    setTesting(true);
    setTestMsg(null);
    try {
      const res = await fetch("/api/ai/test", { method: "POST" });
      const b = await res.json();
      if (b.success && b.data.ok) {
        setTestMsg({ ok: true, text: `The model answered in ${(b.data.latencyMs / 1000).toFixed(1)}s.` });
      } else {
        setTestMsg({ ok: false, text: b.data?.error ?? b.error?.message ?? "Test failed" });
      }
      const r = await (await fetch("/api/ai")).json();
      if (r.success) applyView(r.data as AiView, false);
    } finally {
      setTesting(false);
    }
  }

  async function save() {
    setSaving(true);
    setSaveMsg(null);
    setTestMsg(null);
    try {
      const res = await fetch("/api/ai", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider,
          model: model.trim(),
          ...(info?.baseUrl ? { baseUrl: baseUrl.trim() } : {}),
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        }),
      });
      const b = await res.json();
      if (!b.success) {
        setSaveMsg({ ok: false, text: b.error?.message ?? "Save failed" });
        return;
      }
      applyView(b.data as AiView, true);
      setApiKey("");
      setSaveMsg({ ok: true, text: "Saved." });
    } finally {
      setSaving(false);
    }
    // Saving is the natural moment to prove it works.
    await test();
  }

  async function removeKey() {
    const res = await fetch("/api/ai/key", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider }),
    });
    const b = await res.json();
    if (b.success) applyView(b.data as AiView, false);
  }

  async function setEnabled(enabled: boolean) {
    setToggling(true);
    setToggleMsg(null);
    try {
      const res = await fetch("/api/ai/enable", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled, acceptNotice: accept }),
      });
      const b = await res.json();
      if (b.success) {
        applyView(b.data as AiView, false);
        setAccept(false);
      } else {
        setToggleMsg({ ok: false, text: b.error?.message ?? "Failed" });
      }
    } finally {
      setToggling(false);
    }
  }

  if (loadErr) {
    return <p className="text-sm text-danger">{loadErr}</p>;
  }
  if (!view || !info) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-24" />
        <Skeleton className="h-80" />
      </div>
    );
  }

  const shownModels = modelFilter
    ? models.filter((m) => `${m.id} ${m.label}`.toLowerCase().includes(modelFilter.toLowerCase()))
    : models;
  const canSave = isAdmin && model.trim() !== "" && (keyStored || apiKey.trim() !== "" || info.apiKey === "optional");

  return (
    <div className="space-y-6" data-testid="ai-panel">
      <Notice compact={view.enabled} />

      {!isAdmin && me && (
        <p className="text-xs text-fg-muted" data-testid="ai-readonly">
          Only admins can change AI settings.
        </p>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <IconSpark className="h-4 w-4 text-accent" />
            <CardTitle>Model provider</CardTitle>
          </div>
          {saved && (
            <span
              className={cn(
                "inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                STATUS_TONE[view.status],
              )}
              data-testid="ai-status"
              title={view.lastError ?? undefined}
            >
              {STATUS_LABEL[view.status]}
            </span>
          )}
        </CardHeader>
        <CardContent>
          <fieldset disabled={!isAdmin} className="space-y-5">
            <div>
              <Label>Provider</Label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="ai-providers">
                {view.providers.map((p) => {
                  const selected = p.id === provider;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => pickProvider(p)}
                      data-testid={`ai-provider-${p.id}`}
                      aria-pressed={selected}
                      className={cn(
                        "rounded-lg border px-3 py-2.5 text-left transition-colors duration-150",
                        selected
                          ? "border-primary/60 bg-primary/5 ring-1 ring-primary/30"
                          : "border-border/70 bg-surface hover:bg-surface-2",
                      )}
                    >
                      <span className="flex items-center gap-1.5 text-sm font-medium text-fg">
                        {p.label}
                        {view.keysStored.includes(p.id) && <span className="h-1.5 w-1.5 rounded-full bg-success" title="Key stored" />}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-fg-muted/80">{p.hint}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {info.baseUrl && (
              <div>
                <Label htmlFor="ai-base-url">{info.baseUrl.label}</Label>
                <Input
                  id="ai-base-url"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder={info.baseUrl.placeholder}
                  data-testid="ai-base-url"
                />
              </div>
            )}

            <div>
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="ai-key" className="mb-0">
                  API key {info.apiKey === "optional" && <span className="text-fg-muted/50">(optional)</span>}
                </Label>
                {info.keyUrl && (
                  <a href={info.keyUrl} target="_blank" rel="noreferrer" className="text-[11px] font-medium text-primary hover:underline">
                    Get a key →
                  </a>
                )}
              </div>
              <div className="relative mt-1.5">
                <Input
                  id="ai-key"
                  type={showKey ? "text" : "password"}
                  autoComplete="off"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={keyStored ? "•••••••• stored. Paste a new key to replace it." : (info.keyPlaceholder ?? "")}
                  className="pr-9"
                  data-testid="ai-key"
                />
                {apiKey && (
                  <button
                    type="button"
                    onClick={() => setShowKey((s) => !s)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-fg-muted transition-colors hover:text-fg"
                    aria-label={showKey ? "Hide key" : "Show key"}
                  >
                    {showKey ? <IconEyeOff className="h-4 w-4" /> : <IconEye className="h-4 w-4" />}
                  </button>
                )}
              </div>
              <p className="mt-1 text-[11px] text-fg-muted/60">
                Encrypted in the Argus vault and never shown again.
                {keyStored && isAdmin && (
                  <>
                    {" "}
                    <button type="button" onClick={() => void removeKey()} className="font-medium text-danger hover:underline" data-testid="ai-key-remove">
                      Remove stored key
                    </button>
                  </>
                )}
              </p>
            </div>

            <div>
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="ai-model" className="mb-0">
                  {info.modelSource === "deployment" ? "Deployment name" : "Model"}
                </Label>
                {info.modelSource === "list" && (
                  <button
                    type="button"
                    onClick={() => void loadModels()}
                    disabled={!canList || modelsBusy}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline disabled:opacity-50"
                    data-testid="ai-models-refresh"
                  >
                    <IconRefresh className={cn("h-3 w-3", modelsBusy && "animate-spin")} />
                    Refresh list
                  </button>
                )}
              </div>
              <div className="mt-1.5">
                {info.modelSource === "deployment" ? (
                  <Input
                    id="ai-model"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder="e.g. gpt-4o-prod"
                    data-testid="ai-model"
                  />
                ) : models.length > 0 ? (
                  <div className="space-y-2">
                    {models.length > 12 && (
                      <Input
                        value={modelFilter}
                        onChange={(e) => setModelFilter(e.target.value)}
                        placeholder={`Filter ${models.length} models…`}
                        data-testid="ai-model-filter"
                      />
                    )}
                    <Select id="ai-model" value={model} onChange={(e) => setModel(e.target.value)} data-testid="ai-model">
                      {model && !shownModels.some((m) => m.id === model) && <option value={model}>{model}</option>}
                      {shownModels.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label === m.id ? m.id : `${m.label} (${m.id})`}
                        </option>
                      ))}
                    </Select>
                  </div>
                ) : (
                  <div
                    className="flex h-[38px] items-center rounded-lg border border-dashed border-border/70 px-3 text-xs text-fg-muted"
                    data-testid="ai-model-placeholder"
                  >
                    {modelsBusy
                      ? "Loading models…"
                      : !canList
                        ? info.baseUrl?.required && !baseUrl.trim()
                          ? `Enter the ${info.baseUrl.label.toLowerCase()} to load models.`
                          : "Paste an API key to load the models."
                        : model
                          ? model
                          : "No models loaded."}
                  </div>
                )}
              </div>
              {info.modelSource === "deployment" && (
                <p className="mt-1 text-[11px] text-fg-muted/60">The name of a chat model deployment in your Azure OpenAI resource.</p>
              )}
              {modelsMsg && <p className={cn("mt-1 text-[11px]", modelsMsg.ok ? "text-success" : "text-danger")}>{modelsMsg.text}</p>}
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-border/50 pt-4">
              <Button onClick={() => void save()} disabled={!canSave || saving || !dirty} data-testid="ai-save">
                {saving ? "Saving…" : "Save and test"}
              </Button>
              <Button variant="secondary" onClick={() => void test()} disabled={!saved || dirty || testing} data-testid="ai-test">
                {testing ? "Testing…" : "Test connection"}
              </Button>
              {(testMsg ?? saveMsg) && (
                <span className={cn("text-xs", (testMsg ?? saveMsg)!.ok ? "text-success" : "text-danger")} data-testid="ai-result">
                  {(testMsg ?? saveMsg)!.text}
                </span>
              )}
            </div>
          </fieldset>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>AI investigations</CardTitle>
          <Badge className={view.enabled ? "border-success/20 bg-success/10 text-success" : ""} data-testid="ai-enabled-badge">
            {view.enabled ? "On" : "Off"}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          {view.enabled ? (
            <>
              <p className="text-xs text-fg-muted">
                Turned on
                {view.notice ? ` by ${view.notice.acceptedBy} on ${fmtDate(view.notice.acceptedAt)}` : ""}. Operators and
                admins can now create and run investigations.
              </p>
              {isAdmin && (
                <Button variant="secondary" onClick={() => void setEnabled(false)} disabled={toggling} data-testid="ai-disable">
                  Turn off
                </Button>
              )}
            </>
          ) : (
            <>
              <p className="text-xs leading-relaxed text-fg-muted">
                Investigations are AI agents that run reports and read-only Microsoft Graph queries, then report their
                findings in Argus and by email.
              </p>
              {isAdmin && (
                <>
                  {!view.noticeCurrent && (
                    <label className="flex cursor-pointer items-start gap-2.5">
                      <input
                        type="checkbox"
                        checked={accept}
                        onChange={(e) => setAccept(e.target.checked)}
                        className="mt-0.5 h-4 w-4 accent-accent"
                        data-testid="ai-accept"
                      />
                      <span className="text-sm text-fg">
                        I read the notice above and accept responsibility for using this experimental feature.
                      </span>
                    </label>
                  )}
                  <Button
                    onClick={() => void setEnabled(true)}
                    disabled={toggling || !saved || (!view.noticeCurrent && !accept)}
                    data-testid="ai-enable"
                  >
                    Turn on AI investigations
                  </Button>
                  {!saved && <p className="text-[11px] text-fg-muted/60">Save a provider and model first.</p>}
                </>
              )}
            </>
          )}
          {toggleMsg && <p className="text-xs text-danger">{toggleMsg.text}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
