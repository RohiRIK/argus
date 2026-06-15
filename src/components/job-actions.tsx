"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { IconPlay, IconPower, IconTrash } from "@/components/icons";
import { Button } from "@/components/ui/primitives";
import { isSnoozed, type SnoozeUnit } from "@/lib/snooze";

const SNOOZE_PRESETS: { label: string; amount: number; unit: SnoozeUnit }[] = [
  { label: "1h", amount: 1, unit: "hours" },
  { label: "24h", amount: 24, unit: "hours" },
  { label: "7d", amount: 7, unit: "days" },
];

/** Run Now / Snooze / Enable-Disable / Delete actions for a job card. */
export function JobActions({
  jobId,
  status,
  snoozedUntil,
}: {
  jobId: string;
  status: "active" | "disabled";
  snoozedUntil?: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const snoozed = isSnoozed(snoozedUntil);

  async function call(action: string, fn: () => Promise<Response>) {
    setBusy(action);
    try {
      const res = await fn();
      const body = await res.json();
      if (!body.success) alert(`Failed: ${body.error?.message ?? "unknown error"}`);
      router.refresh();
    } catch (err) {
      alert(`Request failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
      setSnoozeOpen(false);
    }
  }

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="sm"
        disabled={busy !== null}
        data-testid="edit-job"
        onClick={() => router.push(`/jobs/${jobId}/edit`)}
      >
        Edit
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={busy !== null}
        onClick={() => call("run", () => fetch(`/api/jobs/${jobId}/run`, { method: "POST" }))}
      >
        <IconPlay className="h-3.5 w-3.5" />
        {busy === "run" ? "Running…" : "Run"}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={busy !== null}
        title="Email a sample render to your admin contacts"
        data-testid="test-send"
        onClick={() => call("test-send", () => fetch(`/api/jobs/${jobId}/test-send`, { method: "POST" }))}
      >
        {busy === "test-send" ? "Sending…" : "Test-send"}
      </Button>

      {/* Snooze: presets popover, or un-snooze when already snoozed */}
      {snoozed ? (
        <Button
          variant="ghost"
          size="sm"
          disabled={busy !== null}
          data-testid="unsnooze-job"
          onClick={() => call("unsnooze", () => fetch(`/api/jobs/${jobId}/snooze`, { method: "DELETE" }))}
        >
          {busy === "unsnooze" ? "…" : "Un-snooze"}
        </Button>
      ) : (
        <div className="relative">
          <Button
            variant="ghost"
            size="sm"
            disabled={busy !== null || status !== "active"}
            title={status === "active" ? "Snooze scheduled runs" : "Enable the job to snooze"}
            data-testid="snooze-job"
            onClick={() => setSnoozeOpen((o) => !o)}
          >
            {busy === "snooze" ? "Snoozing…" : "Snooze"}
          </Button>
          {snoozeOpen && (
            <div
              className="absolute bottom-full left-0 z-30 mb-1 flex gap-1 rounded-lg border border-border/60 bg-surface p-1 shadow-elevated"
              data-testid="snooze-menu"
            >
              {SNOOZE_PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  className="rounded-md px-2 py-1 text-[11px] font-medium text-fg-muted hover:bg-surface-2 hover:text-fg"
                  onClick={() =>
                    call("snooze", () =>
                      fetch(`/api/jobs/${jobId}/snooze`, {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ amount: p.amount, unit: p.unit }),
                      }),
                    )
                  }
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <Button
        variant="ghost"
        size="icon"
        title={status === "active" ? "Disable" : "Enable"}
        disabled={busy !== null}
        onClick={() =>
          call("toggle", () =>
            fetch(`/api/jobs/${jobId}`, {
              method: "PUT",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ status: status === "active" ? "disabled" : "active" }),
            }),
          )
        }
      >
        <IconPower className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        title="Delete"
        disabled={busy !== null}
        onClick={() => {
          if (confirm("Delete this job and its history?"))
            call("delete", () => fetch(`/api/jobs/${jobId}`, { method: "DELETE" }));
        }}
      >
        <IconTrash className="h-3.5 w-3.5 text-danger" />
      </Button>
    </div>
  );
}
