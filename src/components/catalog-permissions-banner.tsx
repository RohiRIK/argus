"use client";

import { useEffect, useState } from "react";
import { GraphConsent } from "@/components/graph-consent";

/**
 * Catalog banner: when the app's Graph permissions aren't fully granted, prompt the
 * admin to Authorize before they pick a report. Hidden once status is "ok". Reads the
 * persisted permission status (cheap) — the Authorize/Re-check controls live in <GraphConsent>.
 */
export function CatalogPermissionsBanner() {
  const [status, setStatus] = useState<"loading" | "ok" | "missing">("loading");

  useEffect(() => {
    void fetch("/api/settings/permissions")
      .then((r) => r.json())
      .then((b) => setStatus(b.success && b.data.status === "ok" ? "ok" : "missing"))
      .catch(() => setStatus("missing"));
  }, []);

  if (status !== "missing") return null;

  return (
    <div className="mb-6 rounded-xl border border-warning/30 bg-warning/5 p-4" data-testid="catalog-perms-banner">
      <p className="text-sm font-semibold text-warning">Permissions required</p>
      <p className="mt-0.5 text-xs text-fg-muted/80 leading-relaxed">
        Argus doesn&apos;t have all the Microsoft Graph permissions its reports need yet. Authorize once and every report will work.
      </p>
      <GraphConsent variant="compact" />
    </div>
  );
}
