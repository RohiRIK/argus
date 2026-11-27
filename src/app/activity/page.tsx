import { AppShell } from "@/components/app-shell";
import { ActivityClient, type ActivityTab } from "@/components/activity-client";

export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const SOURCES = ["all", "report", "automation"] as const;

export default async function ActivityPage({ searchParams }: PageProps) {
  const p = await searchParams;
  const tab: ActivityTab = p.tab === "logs" ? "logs" : "runs";
  const source = SOURCES.find((s) => s === p.source) ?? "all";
  return (
    <AppShell title="Activity">
      <ActivityClient initialTab={tab} initialSource={source} />
    </AppShell>
  );
}
