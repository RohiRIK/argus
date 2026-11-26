import { AppShell } from "@/components/app-shell";
import { JobForm } from "@/components/job-form";
import { LinkButton } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

/** Edit a job (UX-E2). Reuses the creation form, pre-populated from GET /api/jobs/:id. */
// Fixed texts keyed by blocker code, so a crafted link can't put arbitrary words on the page.
const PAUSED_NOTICE: Record<string, string> = {
  no_recipients:
    "Saved as paused — No one would receive this report: add recipients or a recipient group, or make the job compute-only.",
};

export default async function EditJobPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ paused?: string }>;
}) {
  const { id } = await params;
  const { paused } = await searchParams;
  return (
    <AppShell title="Edit job">
      <div className="mx-auto max-w-2xl space-y-4">
        <div className="flex justify-end">
          <LinkButton href={`/jobs/new?clone=${id}`} variant="outline" size="sm" data-testid="duplicate-job">
            Duplicate
          </LinkButton>
        </div>
        <JobForm mode="edit" jobId={id} sourceJobId={id} notice={paused ? PAUSED_NOTICE[paused] : undefined} />
      </div>
    </AppShell>
  );
}
