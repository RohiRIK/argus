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
    <nav className="mb-6 flex gap-6 border-b border-border/60">
      {TABS.map(({ href, label, icon: Icon, exact }) => {
        const active = exact ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            data-testid={`settings-tab-${label.toLowerCase()}`}
            className={cn(
              "-mb-px flex items-center gap-2 border-b-2 px-1 py-2.5 text-sm font-medium transition-colors duration-200",
              active
                ? "border-accent text-fg"
                : "border-transparent text-fg-muted hover:text-fg",
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
