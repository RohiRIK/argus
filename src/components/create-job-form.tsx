"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface CatalogItem {
  id: string;
  name: string;
}

const PRESETS = ["hourly", "daily", "weekly", "monthly", "business_days", "weekends"];
const CONDITIONS = ["always", "count_gt", "count_changed", "anomaly", "new_items"] as const;

export function CreateJobForm({ catalog }: { catalog: CatalogItem[] }) {
  const router = useRouter();
  const [reportType, setReportType] = useState(catalog[0]?.id ?? "");
  const [name, setName] = useState("");
  const [preset, setPreset] = useState("daily");
  const [recipients, setRecipients] = useState("");
  const [mode, setMode] = useState<(typeof CONDITIONS)[number]>("always");
  const [threshold, setThreshold] = useState("0");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setMsg(null);
    const body = {
      name: name || catalog.find((c) => c.id === reportType)?.name || reportType,
      reportType,
      scheduleType: "preset" as const,
      schedulePreset: preset,
      recipients: recipients.split(",").map((s) => s.trim()).filter(Boolean),
      conditionalRules: mode === "count_gt" ? { mode, threshold: Number(threshold) } : { mode },
    };
    const res = await fetch("/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (json.success) {
      setName("");
      router.push("/dashboard");
      router.refresh();
    } else {
      setMsg(`Error: ${json.error?.message ?? "failed"}`);
      setBusy(false);
    }
  }

  const field = "w-full rounded-md border border-[hsl(var(--border))] bg-transparent px-3 py-2 text-sm";

  return (
    <div className="space-y-3 rounded-lg border border-[hsl(var(--border))] p-5">
      <h2 className="font-medium">Create job</h2>
      <label className="block text-xs">Report type
        <select className={field} value={reportType} onChange={(e) => setReportType(e.target.value)}>
          {catalog.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <label className="block text-xs">Name (optional)
        <input className={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="defaults to report name" />
      </label>
      <label className="block text-xs">Schedule
        <select className={field} value={preset} onChange={(e) => setPreset(e.target.value)}>
          {PRESETS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </label>
      <label className="block text-xs">Recipients (comma-separated)
        <input className={field} value={recipients} onChange={(e) => setRecipients(e.target.value)} placeholder="admin@contoso.com" />
      </label>
      <div className="flex gap-2">
        <label className="block flex-1 text-xs">Send condition
          <select className={field} value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
            {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        {mode === "count_gt" && (
          <label className="block w-28 text-xs">Threshold
            <input className={field} type="number" value={threshold} onChange={(e) => setThreshold(e.target.value)} />
          </label>
        )}
      </div>
      <div className="flex items-center gap-3">
        <button onClick={submit} disabled={busy} className="rounded-md bg-status-suppressed px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {busy ? "Creating…" : "Create job"}
        </button>
        {msg && <span className="text-xs text-status-failed">{msg}</span>}
      </div>
    </div>
  );
}
