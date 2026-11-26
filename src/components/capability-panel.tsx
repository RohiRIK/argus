"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";

interface CapabilityState {
  ok: boolean;
  missing: string[];
}

interface CapabilityData {
  directoryWrites: boolean;
  groups: { read: string[]; deliver: string[]; directoryWrite: string[] };
  lastVerified: null | {
    readable: boolean;
    read: CapabilityState;
    deliver: CapabilityState & { sender: { address: string | null; source: string } };
    directoryWrite: CapabilityState & { enabled: boolean };
  };
}

function State({ ok, unknown }: { ok: boolean; unknown?: boolean }) {
  if (unknown) return <span className="text-[11px] font-medium text-fg-muted">Not verified yet</span>;
  return ok ? (
    <span className="text-[11px] font-medium text-success">Ready</span>
  ) : (
    <span className="text-[11px] font-medium text-warning">Needs attention</span>
  );
}

/**
 * Plan H2: what Argus asks Microsoft for, per capability, explained before
 * consent. Entra group writes are opt-in and off by default.
 */
export function CapabilityPanel() {
  const { push: toast } = useToast();
  const [data, setData] = useState<CapabilityData | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void fetch("/api/integrations/microsoft365/capabilities")
      .then((r) => r.json())
      .then((b) => b.success && setData(b.data))
      .catch(() => undefined);
  }, []);

  async function toggle(next: boolean) {
    setSaving(true);
    try {
      const res = await fetch("/api/integrations/microsoft365/capabilities", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ directoryWrites: next }),
      });
      const b = await res.json();
      if (!b.success) throw new Error(b.error?.message ?? "Could not save");
      setData((d) => (d ? { ...d, directoryWrites: next, groups: b.data.groups } : d));
      toast(
        next
          ? "Entra group management on — grant consent again (Authorize) to add Group.ReadWrite.All."
          : "Entra group management off — Argus no longer requests or uses Group.ReadWrite.All.",
      );
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save", "danger");
    } finally {
      setSaving(false);
    }
  }

  if (!data) return null;
  const v = data.lastVerified;
  const unknown = !v || !v.readable;

  return (
    <Card data-testid="capability-panel">
      <CardHeader>
        <CardTitle className="text-sm">What Argus asks Microsoft for</CardTitle>
        <p className="mt-1 text-xs text-fg-muted">
          Three separate capabilities. Run Test Connection to verify each one.
        </p>
      </CardHeader>
      <CardContent className="divide-y divide-border/50 p-0">
        <div className="flex items-start justify-between gap-4 px-5 py-3">
          <div>
            <p className="text-sm text-fg">Read reports</p>
            <p className="mt-0.5 text-[11px] text-fg-muted">
              {data.groups.read.length} read-only application permissions used by the report catalog.
            </p>
            {v && v.read.missing.length > 0 && v.readable && (
              <p className="mt-1 text-[11px] text-warning">Missing: {v.read.missing.join(", ")}</p>
            )}
          </div>
          <State ok={Boolean(v?.read.ok)} unknown={unknown} />
        </div>

        <div className="flex items-start justify-between gap-4 px-5 py-3">
          <div>
            <p className="text-sm text-fg">Send email</p>
            <p className="mt-0.5 text-[11px] text-fg-muted">
              Mail.Send, from one sender
              {v?.deliver.sender.address ? (
                <>
                  : <span className="font-mono">{v.deliver.sender.address}</span> (
                  {v.deliver.sender.source === "settings" ? "Settings From address" : "integration mailbox"})
                </>
              ) : (
                " — no sender set yet"
              )}
              . Restrict it to that mailbox with an Exchange application access policy.
            </p>
          </div>
          <State ok={Boolean(v?.deliver.ok)} unknown={unknown} />
        </div>

        <div className="flex items-start justify-between gap-4 px-5 py-3">
          <label className="flex cursor-pointer items-start gap-2.5">
            <input
              type="checkbox"
              checked={data.directoryWrites}
              disabled={saving}
              onChange={(e) => void toggle(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-accent"
              data-testid="directory-writes-toggle"
            />
            <span>
              <span className="text-sm text-fg">Manage Entra groups (optional)</span>
              <span className="mt-0.5 block text-[11px] text-fg-muted">
                Lets Argus create Entra security groups and change their members. Requests
                Group.ReadWrite.All, a broad write permission. Off: recipient groups stay local,
                and linked Entra groups are read-only.
              </span>
            </span>
          </label>
          {data.directoryWrites ? <State ok={Boolean(v?.directoryWrite.ok)} unknown={unknown} /> : (
            <span className="text-[11px] font-medium text-fg-muted">Off</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
