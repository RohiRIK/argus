"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Segmented } from "@/components/ui/primitives";
import { ActivityRuns } from "@/components/activity-runs";
import { ActivityLogs } from "@/components/activity-logs";

export type ActivityTab = "runs" | "logs";

export function ActivityClient({
  initialTab,
  initialSource,
}: {
  initialTab: ActivityTab;
  initialSource: "all" | "report" | "automation";
}) {
  const router = useRouter();
  const [tab, setTab] = useState<ActivityTab>(initialTab);

  function switchTab(next: ActivityTab) {
    setTab(next);
    router.replace(`/activity?tab=${next}`, { scroll: false });
  }

  return (
    <div className="space-y-4" data-testid="activity-page">
      <Segmented<ActivityTab>
        options={[
          { value: "runs", label: "Runs" },
          { value: "logs", label: "Logs & events" },
        ]}
        value={tab}
        onChange={switchTab}
        testIdPrefix="activity-"
      />
      {tab === "runs" ? <ActivityRuns initialSource={initialSource} /> : <ActivityLogs />}
    </div>
  );
}
