"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { IconPlay, IconPower, IconTrash } from "@/components/icons";
import { Button } from "@/components/ui/primitives";

/** Run Now / Enable-Disable / Delete actions for a job card. */
export function JobActions({ jobId, status }: { jobId: string; status: "active" | "disabled" }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

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
    }
  }

  return (
    <div className="flex items-center gap-1">
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
