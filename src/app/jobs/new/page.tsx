import { listReports } from "@/services/reports/registry";
import { AppShell } from "@/components/app-shell";
import { CreateJobClient } from "@/components/create-job-client";

export const dynamic = "force-dynamic";

/** Dedicated job creation page (UX-C2). `?report=<id>` pre-selects a report; `?clone=<id>` duplicates a job. */
export default async function NewJobPage({
  searchParams,
}: {
  searchParams: Promise<{ report?: string; clone?: string }>;
}) {
  const { report, clone } = await searchParams;
  const reports = listReports().map((r) => ({ id: r.id, name: r.name }));
  const reportName = reports.find((r) => r.id === report)?.name;

  return (
    <AppShell title={clone ? "Duplicate job" : "New job"}>
      <CreateJobClient catalog={reports} reportType={report} reportName={reportName} cloneId={clone} />
    </AppShell>
  );
}
