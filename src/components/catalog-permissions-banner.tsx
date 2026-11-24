"use client";

import { useEffect, useState } from "react";
import { GraphConsent } from "@/components/graph-consent";
import { LinkButton } from "@/components/ui/primitives";

/**
 * Catalog banner: prompts admin to connect Microsoft 365 (if vault is empty)
 * or authorize missing Graph scopes before picking a report.
 */
export function CatalogPermissionsBanner() {
  const [state, setState] = useState<"loading" | "ok" | "unconfigured" | "missing">("loading");

  useEffect(() => {
    void Promise.all([
      fetch("/api/vault").then((r) => r.json()).catch(() => null),
      fetch("/api/settings/permissions").then((r) => r.json()).catch(() => null),
    ]).then(([vaultRes, permRes]) => {
      if (vaultRes?.success && !vaultRes.data?.configured) {
        setState("unconfigured");
      } else if (permRes?.success && permRes.data?.status === "ok") {
        setState("ok");
      } else {
        setState("missing");
      }
    });
  }, []);

  if (state === "loading" || state === "ok") return null;

  if (state === "unconfigured") {
    return (
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning/5 p-4" data-testid="catalog-perms-banner">
        <div>
          <p className="text-sm font-semibold text-warning">Microsoft 365 not connected</p>
          <p className="mt-0.5 text-xs text-fg-muted leading-relaxed">
            Deploy or connect an Entra ID app registration in Settings before running reports.
          </p>
        </div>
        <LinkButton href="/settings/integrations" variant="primary" size="sm">
          Connect Microsoft 365 →
        </LinkButton>
      </div>
    );
  }

  return (
    <div className="mb-6 rounded-lg border border-warning/30 bg-warning/5 p-4" data-testid="catalog-perms-banner">
      <p className="text-sm font-semibold text-warning">Permissions required</p>
      <p className="mt-0.5 text-xs text-fg-muted/80 leading-relaxed">
        Argus doesn&apos;t have all the Microsoft Graph permissions its reports need yet. Authorize once and every report will work.
      </p>
      <GraphConsent variant="compact" />
    </div>
  );
}
