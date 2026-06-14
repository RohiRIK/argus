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
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
    setMounted(true);
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
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-lg transition-all duration-200",
        "text-sidebar-fg-muted hover:bg-white/5 hover:text-sidebar-fg",
        "active:scale-95",
        mounted ? "opacity-100" : "opacity-0",
      )}
    >
      {dark ? <IconSun className="h-3.5 w-3.5" /> : <IconMoon className="h-3.5 w-3.5" />}
    </button>
  );
}

export function AppShell({ title, actions, children }: { title: string; actions?: React.ReactNode; children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen bg-bg">
      {/* Sidebar */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar-bg md:flex">
        {/* Grain overlay on sidebar */}
        <div className="pointer-events-none fixed left-0 top-0 z-0 h-screen w-64 opacity-[0.03]"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
            backgroundRepeat: "repeat",
            backgroundSize: "256px 256px",
          }}
        />

        {/* Logo area */}
        <div className="relative z-10 mx-4 mt-5 mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center border border-sidebar-border/70">
            <ArgusMark className="h-6 w-6" />
          </div>
          <div>
            <p className="text-base font-semibold leading-none tracking-[-0.01em] text-sidebar-fg">Argus</p>
            <p className="mt-1 text-[9px] uppercase tracking-[0.22em] text-sidebar-fg-muted/70">M365 Notifications</p>
          </div>
        </div>

        {/* Navigation */}
        <nav className="relative z-10 flex flex-1 flex-col gap-5 px-3">
          {NAV_GROUPS.map(({ group, items }) => (
            <div key={group} className="flex flex-col gap-0.5">
              <p className="px-3 pb-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-sidebar-fg-muted/50">
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
                      "group relative flex items-center gap-3 px-3 py-2.5 text-sm font-medium transition-colors duration-200",
                      active
                        ? "text-sidebar-fg"
                        : "text-sidebar-fg-muted hover:bg-white/[0.04] hover:text-sidebar-fg",
                    )}
                  >
                    {/* Active indicator — gunmetal hairline */}
                    {active && <span className="nav-active-indicator" />}
                    {/* Icon */}
                    <span className={cn(
                      "flex h-5 w-5 items-center justify-center",
                      active ? "text-accent" : "text-sidebar-fg-muted group-hover:text-sidebar-fg",
                    )}>
                      <Icon className="h-4 w-4" />
                    </span>
                    {label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Footer area */}
        <div className="relative z-10 mx-3 mb-4 mt-2 flex flex-col gap-3 rounded-lg border border-sidebar-border/50 bg-sidebar-surface/50 px-3 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="status-dot status-dot--active" />
              <span className="text-[10px] font-medium text-sidebar-fg-muted/80">All systems nominal</span>
            </div>
            <ThemeToggle />
          </div>
          <div className="flex items-center gap-2 text-[9px] uppercase tracking-[0.15em] text-sidebar-fg-muted/40">
            <span>v0.1.0</span>
            <span className="h-1 w-1 rounded-full bg-sidebar-fg-muted/20" />
            <span>self-hosted</span>
          </div>
        </div>
      </aside>

      {/* Main area */}
      <div className="relative flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-4 border-b border-border/60 bg-bg/80 px-6 backdrop-blur-xl">
          <h1 className="truncate text-2xl font-semibold tracking-[-0.02em] text-fg">{title}</h1>
          <div className="flex shrink-0 items-center gap-2">
            {actions}
          </div>
        </header>

        {/* Page content with staggered fade */}
        <main className="flex-1 animate-fade-in px-6 py-6">
          {children}
        </main>
      </div>
    </div>
  );
}
