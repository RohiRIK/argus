"use client";

import { Suspense, useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { IconSave } from "@/components/icons";
import { AppShell } from "@/components/app-shell";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Input,
  Textarea,
  Label,
  Badge,
  Segmented,
  EmptyState,
  Skeleton,
} from "@/components/ui/primitives";
import { extractVariables } from "@/services/report-engine/template";

interface Template {
  id: string;
  name: string;
  reportType: string;
  subject: string;
  htmlBody: string;
  textBody: string | null;
  isDefault: boolean;
  language: "en" | "he";
}

interface TemplateVersion {
  id: string;
  version: number;
  subject: string;
  htmlBody: string;
  textBody: string | null;
  createdAt: string;
}

type Mode = "html" | "text";

const CORE_VARS = [
  "categoryLabel",
  "reportName",
  "organization_name",
  "count",
  "executiveSummary",
  "trendArrow",
  "trendPercent",
  "trendDirection",
  "baselineAvg",
  "timestamp",
  "executionId",
] as const;

const HTML_ONLY_VARS = ["anomalyBanner", "detailsTable"] as const;

const KNOWN_VARS = new Set<string>([
  ...CORE_VARS,
  ...HTML_ONLY_VARS,
  "tenantName",
  "totalSignIns",
  "failedSignIns",
  "legacyAuthSignIns",
  "distinctCountries",
  "topRiskUsers",
]);

function hasUnclosedBraces(s: string): boolean {
  const opens = (s.match(/\{\{/g) ?? []).length;
  const closes = (s.match(/\}\}/g) ?? []).length;
  return opens !== closes;
}

function TemplatesEditor() {
  const reportParam = useSearchParams().get("report");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selected, setSelected] = useState<Template | null>(null);
  const [filter, setFilter] = useState("");
  const [mode, setMode] = useState<Mode>("html");

  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [html, setHtml] = useState("");
  const [text, setText] = useState("");
  const [language, setLanguage] = useState<"en" | "he">("en");

  const [preview, setPreview] = useState("");
  const [previewSubject, setPreviewSubject] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);

  const [versions, setVersions] = useState<TemplateVersion[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [inspectVersionId, setInspectVersionId] = useState<string | null>(null);
  const [confirmRevertId, setConfirmRevertId] = useState<string | null>(null);
  const [reverting, setReverting] = useState<string | null>(null);
  const [pendingPick, setPendingPick] = useState<Template | null>(null);

  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const previewSeq = useRef(0);
  const previewAbort = useRef<AbortController | null>(null);
  const focusedField = useRef<"subject" | "body">("body");
  const subjectRef = useRef<HTMLInputElement>(null);
  const htmlRef = useRef<HTMLTextAreaElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const isDirty = useMemo(() => {
    if (!selected) return false;
    return (
      name !== selected.name ||
      subject !== selected.subject ||
      html !== selected.htmlBody ||
      text !== (selected.textBody ?? "") ||
      language !== selected.language
    );
  }, [selected, name, subject, html, text, language]);

  const unknownVars = useMemo(() => {
    const activeBody = mode === "html" ? html : text;
    const used = new Set([...extractVariables(subject), ...extractVariables(activeBody)]);
    return [...used].filter((v) => !KNOWN_VARS.has(v));
  }, [mode, subject, html, text]);

  const syntaxWarning = useMemo(() => {
    const activeBody = mode === "html" ? html : text;
    if (hasUnclosedBraces(subject) || hasUnclosedBraces(activeBody)) {
      return "Unclosed {{variable}} braces detected.";
    }
    return null;
  }, [mode, subject, html, text]);

  const loadVersions = useCallback(async (templateId: string) => {
    const res = await fetch(`/api/templates/${templateId}/versions`);
    const body = await res.json();
    setVersions(body.success ? body.data : []);
  }, []);

  const applySelected = useCallback(
    (t: Template) => {
      setSelected(t);
      setName(t.name);
      setSubject(t.subject);
      setHtml(t.htmlBody);
      setText(t.textBody ?? "");
      setLanguage(t.language);
      setMsg(null);
      setFieldErrors({});
      setPendingPick(null);
      setInspectVersionId(null);
      setConfirmRevertId(null);
      void loadVersions(t.id);
    },
    [loadVersions],
  );

  const requestPick = useCallback(
    (t: Template) => {
      if (selected?.id === t.id) return;
      if (isDirty) {
        setPendingPick(t);
        return;
      }
      applySelected(t);
    },
    [selected?.id, isDirty, applySelected],
  );

  const load = useCallback(
    async (preselectReport?: string | null) => {
      const res = await fetch("/api/templates");
      const body = await res.json();
      if (!body.success) return;
      const list: Template[] = body.data;
      setTemplates(list);
      setLoaded(true);
      const match = preselectReport
        ? list.find((t) => t.reportType === preselectReport && t.isDefault) ??
          list.find((t) => t.reportType === preselectReport)
        : undefined;
      const next = match ?? list[0];
      if (next) applySelected(next);
    },
    [applySelected],
  );

  useEffect(() => {
    void load(reportParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportParam]);

  useEffect(() => {
    if (!isDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty]);

  const renderPreview = useCallback(async () => {
    if (!selected) return;
    previewAbort.current?.abort();
    const ctrl = new AbortController();
    previewAbort.current = ctrl;
    const seq = ++previewSeq.current;
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const res = await fetch("/api/templates/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify(
          mode === "html"
            ? { mode, htmlBody: html, subject, reportType: selected.reportType }
            : { mode, textBody: text, subject, reportType: selected.reportType },
        ),
      });
      const data = await res.json();
      if (seq !== previewSeq.current) return;
      if (!res.ok || !data.success) {
        setPreviewError(data.error?.message ?? `Preview failed (${res.status})`);
      } else {
        setPreview(mode === "html" ? data.data.html : data.data.text);
        setPreviewSubject(data.data.subject ?? "");
      }
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      if (seq === previewSeq.current) {
        setPreviewError(err instanceof Error ? err.message : "Preview request failed");
      }
    } finally {
      if (seq === previewSeq.current) setPreviewLoading(false);
    }
  }, [mode, html, text, subject, selected]);

  useEffect(() => {
    if (!selected) return;
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void renderPreview(), 250);
    return () => clearTimeout(debounce.current);
  }, [renderPreview, selected]);

  const validateFields = useCallback((): Record<string, string> => {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = "Template name is required";
    if (!subject.trim()) errs.subject = "Subject cannot be blank";
    else if (/[\r\n]/.test(subject)) errs.subject = "Subject must be a single line";
    if (!html.trim()) errs.htmlBody = "HTML body cannot be blank";
    return errs;
  }, [name, subject, html]);

  const save = useCallback(async () => {
    if (!selected || saving) return;
    const errs = validateFields();
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      setMsg("Error: Fix validation errors before saving.");
      return;
    }
    setSaving(true);
    setMsg(null);
    setFieldErrors({});
    try {
      const res = await fetch(`/api/templates/${selected.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          subject,
          htmlBody: html,
          textBody: text,
          language,
        }),
      });
      const data = await res.json();
      if (data.success) {
        const updated: Template = data.data;
        setSelected(updated);
        setTemplates((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
        setMsg("Saved.");
        void loadVersions(updated.id);
      } else {
        if (data.error?.fields) setFieldErrors(data.error.fields);
        setMsg(`Error: ${data.error?.message ?? "Save failed"}`);
      }
    } catch (err) {
      setMsg(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  }, [selected, saving, validateFields, name, subject, html, text, language, loadVersions]);

  // Cmd/Ctrl+S keyboard shortcut to save.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (isDirty && !saving) void save();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isDirty, saving, save]);

  async function cloneSelected() {
    if (!selected || cloning) return;
    setCloning(true);
    setMsg(null);
    try {
      const res = await fetch("/api/templates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: `${name.trim() || selected.name} (copy)`,
          reportType: selected.reportType,
          subject,
          htmlBody: html,
          textBody: text,
          isDefault: false,
          language,
        }),
      });
      const data = await res.json();
      if (data.success) {
        const created: Template = data.data;
        setTemplates((prev) => [...prev, created]);
        applySelected(created);
        setMsg("Cloned template.");
      } else {
        setMsg(`Error: ${data.error?.message ?? "Clone failed"}`);
      }
    } finally {
      setCloning(false);
    }
  }

  async function deleteSelected() {
    if (!selected || selected.isDefault || deleting) return;
    setDeleting(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/templates/${selected.id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        const remaining = templates.filter((t) => t.id !== selected.id);
        setTemplates(remaining);
        if (remaining[0]) applySelected(remaining[0]);
      } else {
        setMsg(`Error: ${data.error?.message ?? "Delete failed"}`);
      }
    } finally {
      setDeleting(false);
    }
  }

  async function revert(versionId: string) {
    if (!selected) return;
    setReverting(versionId);
    setMsg(null);
    try {
      const res = await fetch(`/api/templates/${selected.id}/versions/${versionId}/revert`, { method: "POST" });
      const data = await res.json();
      if (data.success) {
        const t: Template = data.data;
        setTemplates((prev) => prev.map((x) => (x.id === t.id ? t : x)));
        applySelected(t);
        setMsg(`Reverted to v${versions.find((v) => v.id === versionId)?.version ?? "?"}.`);
      } else {
        setMsg(`Error: ${data.error?.message}`);
      }
    } finally {
      setReverting(null);
      setConfirmRevertId(null);
    }
  }

  function insertVar(variable: string) {
    const token = `{{${variable}}}`;
    const target = focusedField.current === "subject" ? subjectRef.current : mode === "html" ? htmlRef.current : textRef.current;
    const setter = focusedField.current === "subject" ? setSubject : mode === "html" ? setHtml : setText;
    const current = focusedField.current === "subject" ? subject : mode === "html" ? html : text;
    if (target && typeof target.selectionStart === "number" && typeof target.selectionEnd === "number") {
      const start = target.selectionStart;
      const end = target.selectionEnd;
      const next = `${current.slice(0, start)}${token}${current.slice(end)}`;
      setter(next);
      requestAnimationFrame(() => {
        target.focus();
        target.setSelectionRange(start + token.length, start + token.length);
      });
      return;
    }
    setter(`${current}${token}`);
  }

  const visibleTemplates = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter((t) => t.name.toLowerCase().includes(q) || t.reportType.toLowerCase().includes(q));
  }, [templates, filter]);

  const availableVars = mode === "html" ? [...CORE_VARS, ...HTML_ONLY_VARS] : [...CORE_VARS];
  const inspectedVersion = versions.find((v) => v.id === inspectVersionId) ?? null;

  if (loaded && templates.length === 0) {
    return <EmptyState title="No templates" hint="Default templates are seeded per report on first run." />;
  }
  if (!loaded) {
    return (
      <div className="grid gap-4 lg:grid-cols-[240px_1fr_1fr]">
        <Skeleton className="h-64" /><Skeleton className="h-96" /><Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[240px_1fr_1fr]">
      {/* Template list sidebar */}
      <Card className="h-fit">
        <div className="border-b border-border/50 p-2.5">
          <Input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter templates…"
            className="h-8 text-xs"
            data-testid="template-search"
          />
        </div>
        <CardContent className="max-h-[68vh] space-y-0.5 overflow-auto p-2">
          {visibleTemplates.map((t) => {
            const active = selected?.id === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => requestPick(t)}
                data-testid={t.isDefault ? `template-item-${t.reportType}` : `template-item-${t.id}`}
                className={`w-full rounded-md px-2.5 py-2 text-left text-xs transition-colors ${
                  active
                    ? "bg-primary/10 text-primary"
                    : "text-fg-muted hover:bg-surface-2 hover:text-fg"
                }`}
              >
                <div className="flex items-center justify-between gap-1.5">
                  <span className="truncate font-medium">{t.name}</span>
                  {active && isDirty && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" title="Unsaved changes" />}
                </div>
                <div className="mt-1 flex items-center gap-1.5">
                  <span className="truncate font-mono text-[10px] text-fg-muted/70">{t.reportType}</span>
                  {t.isDefault && <Badge className="text-success/80">default</Badge>}
                </div>
              </button>
            );
          })}
        </CardContent>
      </Card>

      {/* Editor panel */}
      <Card>
        <CardHeader>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <CardTitle>Editor</CardTitle>
              {isDirty && <Badge className="border-warning/40 bg-warning/10 text-warning">Unsaved</Badge>}
            </div>
            {selected && <p className="mt-0.5 truncate text-xs text-fg-muted/70">{selected.reportType}</p>}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void cloneSelected()} disabled={!selected || cloning} data-testid="clone-template">
              {cloning ? "Cloning…" : "Clone"}
            </Button>
            {selected && !selected.isDefault && (
              <Button variant="ghost" size="sm" onClick={() => void deleteSelected()} disabled={deleting} data-testid="delete-template">
                Delete
              </Button>
            )}
            <Segmented<Mode>
              value={mode}
              onChange={setMode}
              options={[{ value: "html", label: "HTML" }, { value: "text", label: "Text" }]}
            />
          </div>
        </CardHeader>

        {pendingPick && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-warning/30 bg-warning/10 px-5 py-2.5 text-xs">
            <span className="text-fg">Discard unsaved edits before switching to &ldquo;{pendingPick.name}&rdquo;?</span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setPendingPick(null)}>Keep editing</Button>
              <Button variant="danger" size="sm" onClick={() => applySelected(pendingPick)}>Discard &amp; switch</Button>
            </div>
          </div>
        )}

        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_110px]">
            <div>
              <Label>Template name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => setFieldErrors(validateFields())}
                className="text-xs"
                data-testid="template-name"
              />
              {fieldErrors.name && <p className="mt-1 text-[11px] text-danger">{fieldErrors.name}</p>}
            </div>
            <div>
              <Label>Language</Label>
              <Segmented<"en" | "he">
                value={language}
                onChange={setLanguage}
                options={[{ value: "en", label: "EN" }, { value: "he", label: "HE" }]}
              />
            </div>
          </div>

          <div>
            <Label>Subject</Label>
            <Input
              ref={subjectRef}
              value={subject}
              onFocus={() => { focusedField.current = "subject"; }}
              onBlur={() => setFieldErrors(validateFields())}
              onChange={(e) => setSubject(e.target.value)}
              className="font-mono text-xs"
              data-testid="template-subject"
            />
            {fieldErrors.subject && <p className="mt-1 text-[11px] text-danger">{fieldErrors.subject}</p>}
          </div>

          <div>
            <Label>{mode === "html" ? "HTML body" : "Plain-text body"}</Label>
            {mode === "html" ? (
              <Textarea
                ref={htmlRef}
                value={html}
                onFocus={() => { focusedField.current = "body"; }}
                onBlur={() => setFieldErrors(validateFields())}
                onChange={(e) => setHtml(e.target.value)}
                className="min-h-[340px]"
                data-testid="editor-html"
              />
            ) : (
              <Textarea
                ref={textRef}
                value={text}
                onFocus={() => { focusedField.current = "body"; }}
                onChange={(e) => setText(e.target.value)}
                className="min-h-[340px]"
                data-testid="editor-text"
                placeholder="Plain-text alternative…"
              />
            )}
            {fieldErrors.htmlBody && <p className="mt-1 text-[11px] text-danger">{fieldErrors.htmlBody}</p>}
            {syntaxWarning && <p className="mt-1 text-[11px] text-warning">{syntaxWarning}</p>}
            {unknownVars.length > 0 && (
              <p className="mt-1 text-[11px] text-fg-muted">
                Custom tokens (populated only if emitted by report): {unknownVars.map((v) => `{{${v}}}`).join(", ")}
              </p>
            )}
          </div>

          <div>
            <Label>Insert variable <span className="text-fg-muted/60">(at cursor)</span></Label>
            <div className="flex flex-wrap gap-1.5">
              {availableVars.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => insertVar(v)}
                  data-testid={`var-chip-${v}`}
                  className="rounded-md border border-border/60 bg-surface-2 px-2 py-1 font-mono text-[10px] text-fg-muted transition-colors hover:border-border hover:text-fg"
                >
                  {`{{${v}}}`}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button onClick={() => void save()} disabled={saving} data-testid="save-template">
              <IconSave className="h-3.5 w-3.5" /> {saving ? "Saving…" : "Save template"}
            </Button>
            <span className="text-[11px] text-fg-muted/60">⌘S / Ctrl+S</span>
            {msg && (
              <span className={`text-xs ${msg.startsWith("Error") ? "text-danger" : "text-fg-muted"}`} data-testid="template-save-msg">
                {msg}
              </span>
            )}
          </div>

          {/* Version history (progressive disclosure) */}
          <div className="border-t border-border/50 pt-3" data-testid="version-history">
            <button
              type="button"
              onClick={() => setShowHistory((s) => !s)}
              className="flex w-full items-center justify-between text-xs font-medium text-fg-muted hover:text-fg"
            >
              <span>Version history ({versions.length})</span>
              <span>{showHistory ? "−" : "+"}</span>
            </button>
            {showHistory && (
              <div className="mt-2.5 space-y-2">
                {versions.length === 0 ? (
                  <p className="text-xs text-fg-muted/60">No previous versions yet — saving content changes creates a snapshot.</p>
                ) : (
                  <ul className="max-h-56 divide-y divide-border/40 overflow-auto rounded-lg border border-border/50">
                    {versions.map((v) => (
                      <li key={v.id} className="space-y-2 px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <span className="font-mono text-[11px] text-fg">v{v.version}</span>
                            <span className="ml-2 truncate text-[11px] text-fg-muted/80">{v.subject}</span>
                            <span className="ml-2 text-[10px] text-fg-muted/50">{new Date(v.createdAt).toLocaleString()}</span>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setInspectVersionId((id) => (id === v.id ? null : v.id))}
                            >
                              {inspectVersionId === v.id ? "Hide" : "Inspect"}
                            </Button>
                            {confirmRevertId === v.id ? (
                              <>
                                <Button
                                  variant="danger"
                                  size="sm"
                                  disabled={reverting !== null}
                                  data-testid={`revert-${v.version}`}
                                  onClick={() => void revert(v.id)}
                                >
                                  {reverting === v.id ? "Reverting…" : "Confirm"}
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => setConfirmRevertId(null)}>Cancel</Button>
                              </>
                            ) : (
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={reverting !== null}
                                data-testid={`revert-${v.version}`}
                                onClick={() => setConfirmRevertId(v.id)}
                              >
                                Revert
                              </Button>
                            )}
                          </div>
                        </div>
                        {inspectedVersion?.id === v.id && (
                          <pre className="max-h-36 overflow-auto rounded-md border border-border/40 bg-surface-2/60 p-2 font-mono text-[11px] text-fg-muted">
                            {mode === "html" ? v.htmlBody : v.textBody ?? "(empty plain-text body)"}
                          </pre>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Preview panel */}
      <Card>
        <CardHeader>
          <CardTitle>Live preview</CardTitle>
          <span className="text-[10px] uppercase tracking-wider text-fg-muted/60">
            {previewLoading ? "rendering…" : `${mode} · sample data`}
          </span>
        </CardHeader>
        <div className="border-b border-border/50 bg-surface-2/40 px-4 py-2 text-xs">
          <span className="text-fg-muted">Subject: </span>
          <span className="font-mono text-fg" data-testid="preview-subject">{previewSubject || "—"}</span>
        </div>
        {previewError && (
          <div className="border-b border-danger/30 bg-danger/10 px-4 py-2 text-xs text-danger" data-testid="preview-error">
            {previewError}
          </div>
        )}
        <CardContent className="p-0">
          {mode === "html" ? (
            <iframe
              title="preview"
              sandbox=""
              srcDoc={preview}
              className="h-[520px] w-full rounded-b-lg border-0 bg-white"
              data-testid="preview-html"
            />
          ) : (
            <pre className="h-[520px] overflow-auto whitespace-pre-wrap rounded-b-lg bg-surface-2/50 p-4 font-mono text-xs leading-relaxed text-fg-muted" data-testid="preview-text">
              {preview}
            </pre>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function TemplatesPage() {
  return (
    <AppShell title="Templates">
      <Suspense fallback={<Skeleton className="h-96" />}>
        <TemplatesEditor />
      </Suspense>
    </AppShell>
  );
}
