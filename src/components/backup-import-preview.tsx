"use client";

import { IconAlert, IconPower } from "@/components/icons";
import { Badge, Button } from "@/components/ui/primitives";

/** Client mirror of `ImportPreview` from `@/services/backup` (kept local: client bundle). */
export interface ImportPreviewData {
  exportedAt: string | null;
  jobs: {
    create: number;
    update: number;
    scheduled: number;
    items: Array<{ id: string; name: string; action: "create" | "update"; scheduled: boolean; importedStatus: "active" | "disabled" }>;
  };
  templates: { create: number; update: number };
  recipientGroups: { create: number; update: number };
  maintenanceWindows: { create: number; update: number };
  settingsChanges: string[];
  missingReferences: Array<{ ownerId: string; ownerName: string; kind: "template" | "recipientGroup"; refId: string }>;
  integration: { provider: string; status: string; connected: boolean };
  activate: boolean;
}

function CountRow({ label, c }: { label: string; c: { create: number; update: number } }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="text-fg-muted">{label}</span>
      <span className="tabular-nums text-fg">
        {c.create} new · {c.update} updated
      </span>
    </div>
  );
}

/** Dry-run summary shown before a config import is confirmed (H6). */
export function BackupImportPreview({
  preview,
  busy,
  onConfirm,
  onCancel,
}: {
  preview: ImportPreviewData;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const blocking = preview.missingReferences.some((m) => m.kind === "template");
  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface-2/40 p-4" data-testid="import-preview">
      <div className="flex items-start gap-3 rounded-md border border-info/30 border-l-2 border-l-info bg-info/5 p-3">
        <IconPower className="mt-0.5 h-4 w-4 shrink-0 text-info" />
        <p className="text-xs leading-relaxed text-fg">
          <span className="font-semibold">All imported jobs land paused.</span>{" "}
          Nothing is scheduled, run, or emailed by this import. Review each job, then enable it from the dashboard.
        </p>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="text-fg-muted">Jobs</span>
          <span className="tabular-nums text-fg">
            {preview.jobs.create} new · {preview.jobs.update} updated · {preview.jobs.scheduled} with a schedule
          </span>
        </div>
        <CountRow label="Templates" c={preview.templates} />
        <CountRow label="Recipient groups" c={preview.recipientGroups} />
        <CountRow label="Maintenance windows" c={preview.maintenanceWindows} />
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="text-fg-muted">Settings changed</span>
          <span className="text-right text-fg">{preview.settingsChanges.length ? preview.settingsChanges.join(", ") : "none"}</span>
        </div>
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="text-fg-muted">Microsoft 365 on this instance</span>
          <Badge className={preview.integration.connected ? "text-success" : "text-fg-muted"}>
            {preview.integration.connected ? "Connected" : preview.integration.status}
          </Badge>
        </div>
      </div>

      {preview.jobs.items.length > 0 && (
        <ul className="max-h-40 space-y-1 overflow-auto border-t border-border/60 pt-2 text-xs" data-testid="import-preview-jobs">
          {preview.jobs.items.map((j) => (
            <li key={j.id} className="flex items-center justify-between gap-3">
              <span className="truncate text-fg">{j.name}</span>
              <span className="shrink-0 text-fg-muted">
                {j.action === "create" ? "new" : "update"} · {j.importedStatus === "active" ? "active" : "paused"}
              </span>
            </li>
          ))}
        </ul>
      )}

      {preview.missingReferences.length > 0 && (
        <div className="flex items-start gap-3 rounded-md border border-warning/30 border-l-2 border-l-warning bg-warning/5 p-3" data-testid="import-preview-missing">
          <IconAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <div className="space-y-1 text-xs">
            <p className="font-semibold text-fg">
              {blocking ? "Missing templates — import is blocked" : "Missing references"}
            </p>
            <ul className="space-y-0.5 text-fg-muted">
              {preview.missingReferences.map((m, i) => (
                <li key={`${m.ownerId}-${m.refId}-${i}`}>
                  {m.ownerName}: {m.kind === "template" ? "template" : "recipient group"} <code className="font-mono">{m.refId}</code>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={onConfirm} disabled={busy || blocking} data-testid="confirm-import">
          {busy ? "Importing…" : "Import (jobs paused)"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
