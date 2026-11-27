import { AppShell } from "@/components/app-shell";
import { UsersAdmin } from "@/components/users-admin";

export const dynamic = "force-dynamic";

export default function UsersPage() {
  return (
    <AppShell title="Users">
      <div className="mx-auto max-w-4xl">
        <UsersAdmin />
      </div>
    </AppShell>
  );
}
