"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  IconDashboard,
  IconCatalog,
  IconLogs,
  IconTemplate,
  IconSettings,
  IconMoon,
  IconSun,
  ArgusMark,
} from "@/components/icons";
import { cn } from "@/lib/utils";

type IconCmp = (props: React.SVGProps<SVGSVGElement>) => React.ReactElement;

// Grouped nav (Operate / Configure). Integrations now lives under Settings.
const NAV_GROUPS: { group: string; items: { href: string; label: string; icon: IconCmp }[] }[] = [
  {
    group: "Operate",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: IconDashboard },
      { href: "/catalog", label: "Catalog", icon: IconCatalog },
      { href: "/logs", label: "Logs", icon: IconLogs },
    ],
  },
  {
    group: "Configure",
    items: [
      { href: "/templates", label: "Templates", icon: IconTemplate },
      { href: "/settings", label: "Settings", icon: IconSettings },
    ],
  },
];

function ThemeToggle() {
  const [dark, setDark] = useState(true);
  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);
  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("argus-theme", next ? "dark" : "light");
  }
  return (
    <button
      onClick={toggle}
      aria-label="Toggle theme"
      className="inline-flex h-9 w-9 items-center justify-center rounded-md text-fg-muted hover:bg-surface-2 hover:text-fg"
    >
      {dark ? <IconSun className="h-4 w-4" /> : <IconMoon className="h-4 w-4" />}
    </button>
  );
}

export function AppShell({ title, actions, children }: { title: string; actions?: React.ReactNode; children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen bg-bg">
      {/* Sidebar */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-border bg-surface/60 px-3 py-4 backdrop-blur md:flex">
        <div className="mb-6 flex items-center gap-2.5 px-2">
          <ArgusMark className="h-9 w-9 drop-shadow-sm" />
          <div>
            <p className="text-sm font-semibold leading-none tracking-tight">Argus</p>
            <p className="mt-1 text-[10px] uppercase tracking-wider text-fg-muted">M365 Notifications</p>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-5">
          {NAV_GROUPS.map(({ group, items }) => (
            <div key={group} className="flex flex-col gap-0.5">
              <p className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-fg-muted/70">
                {group}
              </p>
              {items.map(({ href, label, icon: Icon }) => {
                const active = pathname === href || pathname.startsWith(`${href}/`);
                return (
                  <Link
                    key={href}
                    href={href}
                    data-testid={`nav-${label.toLowerCase()}`}
                    className={cn(
                      "group relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
                      active
                        ? "bg-primary/10 font-medium text-primary"
                        : "text-fg-muted hover:bg-surface-2 hover:text-fg",
                    )}
                  >
                    {active && <span className="absolute left-0 top-1/2 h-4 -translate-y-1/2 w-0.5 rounded-full bg-primary" />}
                    <Icon className="h-4 w-4" />
                    {label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="flex items-center gap-2 px-2.5 text-[10px] text-fg-muted">
          <span className="h-1.5 w-1.5 rounded-full bg-success" />
          <span>v0.1.0 · self-hosted</span>
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border bg-bg/80 px-6 backdrop-blur">
          <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
          <div className="flex items-center gap-2">
            {actions}
            <ThemeToggle />
          </div>
        </header>
        <main className="flex-1 animate-fade-in px-6 py-6">{children}</main>
      </div>
    </div>
  );
}
