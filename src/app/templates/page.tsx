"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Save, Plus, RefreshCw } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, Button, Input, Textarea, Label, Badge, EmptyState } from "@/components/ui/primitives";

interface Template {
  id: string;
  name: string;
  reportType: string;
  subject: string;
  htmlBody: string;
  isDefault: boolean;
  language: "en" | "he";
}

const VARS = [
  "organization_name", "reportName", "count", "executiveSummary",
  "trendArrow", "trendPercent", "trendDirection", "baselineAvg", "timestamp", "executionId",
  "anomalyBanner", "detailsTable",
];

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selected, setSelected] = useState<Template | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [preview, setPreview] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout>>();

  const load = useCallback(async () => {
    const res = await fetch("/api/templates");
    const body = await res.json();
    if (body.success) {
      setTemplates(body.data);
      if (!selected && body.data.length) pick(body.data[0]);
    }
  }, [selected]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pick(t: Template) {
    setSelected(t);
    setSubject(t.subject);
    setBody(t.htmlBody);
    setMsg(null);
  }

  const renderPreview = useCallback(async (html: string, subj: string) => {
    const res = await fetch("/api/templates/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ htmlBody: html, subject: subj }),
    });
    const data = await res.json();
    if (data.success) setPreview(data.data.html);
  }, []);

  useEffect(() => {
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void renderPreview(body, subject), 300);
    return () => clearTimeout(debounce.current);
  }, [body, subject, renderPreview]);

  async function save() {
    if (!selected) return;
    setSaving(true);
    setMsg(null);
    const res = await fetch(`/api/templates/${selected.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subject, htmlBody: body }),
    });
    const data = await res.json();
    setMsg(data.success ? "Saved." : `Error: ${data.error?.message}`);
    setSaving(false);
    await load();
  }

  return (
    <AppShell
      title="Templates"
      actions={<Button variant="outline" size="sm" onClick={() => void load()}><RefreshCw className="h-3.5 w-3.5" /> Reload</Button>}
    >
      {templates.length === 0 ? (
        <EmptyState title="No templates" hint="Default templates are seeded per report on first run." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[220px_1fr_1fr]">
          {/* List */}
          <Card className="h-fit">
            <CardContent className="space-y-1 p-2">
              {templates.map((t) => (
                <button
                  key={t.id}
                  onClick={() => pick(t)}
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
            <CardHeader><CardTitle>Editor</CardTitle>{msg && <span className="text-xs text-fg-muted">{msg}</span>}</CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label>Subject</Label>
                <Input value={subject} onChange={(e) => setSubject(e.target.value)} className="font-mono text-xs" />
              </div>
              <div>
                <Label>HTML body</Label>
                <Textarea value={body} onChange={(e) => setBody(e.target.value)} className="min-h-[320px]" />
              </div>
              <div>
                <Label>Available variables (click to insert)</Label>
                <div className="flex flex-wrap gap-1">
                  {VARS.map((v) => (
                    <button
                      key={v}
                      onClick={() => setBody((b) => `${b}{{${v}}}`)}
                      className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-fg-muted hover:text-fg"
                    >
                      {`{{${v}}}`}
                    </button>
                  ))}
                </div>
              </div>
              <Button onClick={save} disabled={saving}><Save className="h-3.5 w-3.5" /> {saving ? "Saving…" : "Save template"}</Button>
            </CardContent>
          </Card>

          {/* Live preview */}
          <Card>
            <CardHeader><CardTitle>Live preview</CardTitle><span className="text-[10px] text-fg-muted">sample data</span></CardHeader>
            <CardContent className="p-0">
              <iframe title="preview" srcDoc={preview} className="h-[480px] w-full rounded-b-lg border-0 bg-white" />
            </CardContent>
          </Card>
        </div>
      )}
    </AppShell>
  );
}
