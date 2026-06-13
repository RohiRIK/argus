"use client";

import { Suspense, useEffect, useRef, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { IconSave } from "@/components/icons";
import { AppShell } from "@/components/app-shell";
import { CreateJobDialog } from "@/components/create-job-dialog";
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

type Mode = "html" | "text";

const VARS = [
  "organization_name", "reportName", "count", "executiveSummary",
  "trendArrow", "trendPercent", "trendDirection", "baselineAvg", "timestamp", "executionId",
  "anomalyBanner", "detailsTable",
];

function TemplatesEditor() {
  const reportParam = useSearchParams().get("report");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selected, setSelected] = useState<Template | null>(null);
  const [mode, setMode] = useState<Mode>("html");
  const [subject, setSubject] = useState("");
  const [html, setHtml] = useState("");
  const [text, setText] = useState("");
  const [preview, setPreview] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const pick = useCallback((t: Template) => {
    setSelected(t);
    setSubject(t.subject);
    setHtml(t.htmlBody);
    setText(t.textBody ?? "");
    setMsg(null);
  }, []);

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
      if (next) pick(next);
    },
    [pick],
  );

  useEffect(() => {
    void load(reportParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportParam]);

  const renderPreview = useCallback(async () => {
    const res = await fetch("/api/templates/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(mode === "html" ? { mode, htmlBody: html, subject } : { mode, textBody: text, subject }),
    });
    const data = await res.json();
    if (data.success) setPreview(mode === "html" ? data.data.html : data.data.text);
  }, [mode, html, text, subject]);

  useEffect(() => {
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void renderPreview(), 300);
    return () => clearTimeout(debounce.current);
  }, [renderPreview]);

  async function save() {
    if (!selected) return;
    setSaving(true);
    setMsg(null);
    const res = await fetch(`/api/templates/${selected.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subject, htmlBody: html, textBody: text }),
    });
    const data = await res.json();
    setMsg(data.success ? "Saved." : `Error: ${data.error?.message}`);
    setSaving(false);
  }

  if (loaded && templates.length === 0) {
    return <EmptyState title="No templates" hint="Default templates are seeded per report on first run." />;
  }
  if (!loaded) {
    return (
      <div className="grid gap-4 lg:grid-cols-[220px_1fr_1fr]">
        <Skeleton className="h-64" /><Skeleton className="h-96" /><Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[220px_1fr_1fr]">
      {/* Template list */}
      <Card className="h-fit">
        <CardContent className="space-y-1 p-2">
          {templates.map((t) => (
            <button
              key={t.id}
              onClick={() => pick(t)}
              data-testid={`template-item-${t.reportType}`}
              className={`w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${selected?.id === t.id ? "bg-primary/10 text-primary" : "hover:bg-surface-2"}`}
            >
              <div className="truncate font-medium">{t.name}</div>
              <div className="mt-0.5 flex items-center gap-1 text-[10px] text-fg-muted">
                <span className="font-mono">{t.reportType}</span>
                {t.isDefault && <Badge className="text-success">default</Badge>}
              </div>
            </button>
          ))}
        </CardContent>
      </Card>

      {/* Editor */}
      <Card>
        <CardHeader>
          <div className="min-w-0">
            <CardTitle>Editor</CardTitle>
            {selected && <p className="mt-0.5 truncate text-[11px] text-fg-muted">{selected.name}</p>}
          </div>
          <div className="flex items-center gap-2">
            <Segmented<Mode>
              value={mode}
              onChange={setMode}
              options={[{ value: "html", label: "HTML" }, { value: "text", label: "Text" }]}
            />
            {selected && (
              <CreateJobDialog reportType={selected.reportType} reportName={selected.name.replace(/ — Default$/, "")} templateId={selected.id} />
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label>Subject</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} className="font-mono text-xs" />
          </div>
          <div>
            <Label>{mode === "html" ? "HTML body" : "Plain-text body"}</Label>
            {mode === "html" ? (
              <Textarea value={html} onChange={(e) => setHtml(e.target.value)} className="min-h-[320px]" data-testid="editor-html" />
            ) : (
              <Textarea value={text} onChange={(e) => setText(e.target.value)} className="min-h-[320px]" data-testid="editor-text" placeholder="Plain-text alternative…" />
            )}
          </div>
          <div>
            <Label>Insert variable</Label>
            <div className="flex flex-wrap gap-1">
              {VARS.map((v) => (
                <button
                  key={v}
                  onClick={() => (mode === "html" ? setHtml((b) => `${b}{{${v}}}`) : setText((b) => `${b}{{${v}}}`))}
                  className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-fg-muted hover:text-fg"
                >
                  {`{{${v}}}`}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={save} disabled={saving}><IconSave className="h-3.5 w-3.5" /> {saving ? "Saving…" : "Save template"}</Button>
            {msg && <span className="text-xs text-fg-muted">{msg}</span>}
          </div>
        </CardContent>
      </Card>

      {/* Live preview */}
      <Card>
        <CardHeader>
          <CardTitle>Live preview</CardTitle>
          <span className="text-[10px] uppercase tracking-wide text-fg-muted">{mode} · sample data</span>
        </CardHeader>
        <CardContent className="p-0">
          {mode === "html" ? (
            <iframe title="preview" srcDoc={preview} className="h-[480px] w-full rounded-b-lg border-0 bg-white" data-testid="preview-html" />
          ) : (
            <pre className="h-[480px] overflow-auto whitespace-pre-wrap rounded-b-lg bg-surface-2 p-4 font-mono text-xs" data-testid="preview-text">
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
