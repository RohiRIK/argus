import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** The automation catalog moved into the unified /catalog. */
export default function Page() {
  redirect("/catalog?type=automation");
}
