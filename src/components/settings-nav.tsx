"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { KeyRound, Plug, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/settings", label: "Credentials", icon: KeyRound, exact: true },
  { href: "/settings/integrations", label: "Integrations", icon: Plug, exact: false },
  { href: "/settings/permissions", label: "Permissions", icon: ShieldCheck, exact: false },
];

/** Sub-navigation for the unified Settings section. */
export function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav className="mb-6 flex gap-1 border-b border-border">
      {TABS.map(({ href, label, icon: Icon, exact }) => {
        const active = exact ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            data-testid={`settings-tab-${label.toLowerCase()}`}
            className={cn(
              "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors",
              active
                ? "border-primary font-medium text-primary"
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
