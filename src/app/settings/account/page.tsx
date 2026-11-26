import { redirect } from "next/navigation";

/** My account moved out of Settings (account menu at the bottom of the sidebar). */
export default function OldAccountPage() {
  redirect("/account");
}
