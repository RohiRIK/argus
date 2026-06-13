"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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

  const btn = "rounded-md border border-[hsl(var(--border))] px-2.5 py-1 text-xs hover:bg-[hsl(var(--muted))] disabled:opacity-50";

  return (
    <div className="flex gap-2">
      <button
        className={btn}
        disabled={busy !== null}
        onClick={() => call("run", () => fetch(`/api/jobs/${jobId}/run`, { method: "POST" }))}
      >
        {busy === "run" ? "Running…" : "Run Now"}
      </button>
      <button
        className={btn}
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
        {status === "active" ? "Disable" : "Enable"}
      </button>
      <button
        className={btn}
        disabled={busy !== null}
        onClick={() => {
          if (confirm("Delete this job and its history?"))
            call("delete", () => fetch(`/api/jobs/${jobId}`, { method: "DELETE" }));
        }}
      >
        Delete
      </button>
    </div>
  );
}
