import { redirect } from "next/navigation";

/** Users moved out of Settings to its own page. */
export default function OldUsersPage() {
  redirect("/users");
}
