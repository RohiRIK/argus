import { AppShell } from "@/components/app-shell";
import { JobForm } from "@/components/job-form";
import { LinkButton } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

/** Edit a job (UX-E2). Reuses the creation form, pre-populated from GET /api/jobs/:id. */
export default async function EditJobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AppShell title="Edit job">
      <div className="mx-auto max-w-2xl space-y-4">
        <div className="flex justify-end">
          <LinkButton href={`/jobs/new?clone=${id}`} variant="outline" size="sm" data-testid="duplicate-job">
            Duplicate
          </LinkButton>
        </div>
        <JobForm mode="edit" jobId={id} sourceJobId={id} />
      </div>
    </AppShell>
  );
}
