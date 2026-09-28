import { listReports } from "@/services/reports/registry";
import { AppShell } from "@/components/app-shell";
import { CatalogPermissionsBanner } from "@/components/catalog-permissions-banner";
import { CatalogClient } from "@/components/catalog-client";

export const dynamic = "force-dynamic";

export default function CatalogPage() {
  const reports = listReports().map((r) => ({
    id: r.id,
    name: r.name,
    category: r.category,
    description: r.description,
    requiredPermissions: r.requiredPermissions,
    baselineSupport: r.baselineSupport,
    tags: r.tags,
    maturity: r.maturity,
  }));

  return (
    <AppShell title="Catalog">
      <CatalogPermissionsBanner />

      {/* Heads-up: M365 usage reports hash identities unless concealment is off. */}
      <div className="mb-6 border-l-2 border-accent/60 bg-surface px-4 py-3" data-testid="usage-reports-notice">
        <p className="text-xs font-semibold text-fg">Heads-up — Usage reports (Teams, OneDrive, SharePoint, Email, Groups, Mailbox)</p>
        <p className="mt-1 text-xs leading-relaxed text-fg-muted">
          Microsoft hashes user, group, and site names in these reports by default. To see
          real names, uncheck <span className="font-medium text-fg">“Display concealed user,
          group, and site names in all reports”</span> in M365 Admin → Settings →
          Org&nbsp;settings → Reports.
        </p>
      </div>

      <CatalogClient reports={reports} />
    </AppShell>
  );
}
