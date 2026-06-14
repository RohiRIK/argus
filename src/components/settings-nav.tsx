"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconSettings, IconPlug } from "@/components/icons";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/settings", label: "General", icon: IconSettings, exact: true },
  { href: "/settings/integrations", label: "Integrations", icon: IconPlug, exact: false },
];

export function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav className="mb-6 flex gap-1 rounded-xl border border-border/60 bg-surface p-1 shadow-sm">
      {TABS.map(({ href, label, icon: Icon, exact }) => {
        const active = exact ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            data-testid={`settings-tab-${label.toLowerCase()}`}
            className={cn(
              "flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200",
              active
                ? "bg-primary/10 text-primary shadow-sm"
                : "text-fg-muted hover:text-fg hover:bg-surface-2/50",
            )}
          >
            <Icon className={cn("h-4 w-4", active ? "text-primary" : "")} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
