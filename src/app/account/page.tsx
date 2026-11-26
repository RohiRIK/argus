import { AppShell } from "@/components/app-shell";
import { AccountCard } from "@/components/account-card";

export const dynamic = "force-dynamic";

export default function MyAccountPage() {
  return (
    <AppShell title="My account">
      <div className="mx-auto max-w-3xl">
        <AccountCard />
      </div>
    </AppShell>
  );
}
