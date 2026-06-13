import { AppShell } from "@/components/app-shell";
import { SettingsNav } from "@/components/settings-nav";

/** Unified Settings section: credentials, integrations, permissions. */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell title="Settings">
      <div className="mx-auto max-w-3xl">
        <SettingsNav />
        {children}
      </div>
    </AppShell>
  );
}
