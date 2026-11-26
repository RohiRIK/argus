import { redirect } from "next/navigation";

/** Logs moved into the unified Activity page. */
export default function LogsPage() {
  redirect("/activity?tab=logs");
}
