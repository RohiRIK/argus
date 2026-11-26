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
  IconShield,
  IconMoon,
  IconSun,
  IconMenu,
  IconPower,
  ArgusMark,
} from "@/components/icons";
import { cn } from "@/lib/utils";
import { CommandPalette } from "@/components/command-palette";
import { useCurrentUser, type CurrentUser } from "@/lib/use-current-user";
import { ROLE_LABEL } from "@/lib/auth/roles";

type IconCmp = (props: React.SVGProps<SVGSVGElement>) => React.ReactElement;

type NavItem = {
  href: string;
  label: string;
  icon: IconCmp;
  /** Other path prefixes that belong to this entry (e.g. detail pages reached from it). */
  also?: string[];
  /** Only shown to admins. */
  adminOnly?: boolean;
};

/**
 * Organised by what the operator is doing, not by report vs automation:
 * what is set up, what happened, what can be added, how emails look.
 * Settings is pinned to the bottom.
 */
const NAV_MAIN: NavItem[] = [
  // Report jobs + automation policies; their edit pages hang off it.
  { href: "/dashboard", label: "Dashboard", icon: IconDashboard, also: ["/jobs", "/automations"] },
  // Every report run, automation run, log line and platform event.
  { href: "/activity", label: "Activity", icon: IconLogs, also: ["/executions", "/automations/runs"] },
  // One catalog for read-only reports and tenant-changing automations.
  { href: "/catalog", label: "Catalog", icon: IconCatalog },
  { href: "/templates", label: "Templates", icon: IconTemplate },
];
const NAV_BOTTOM: NavItem[] = [
  // Who can sign in and what they can do (admins only).
  { href: "/users", label: "Users", icon: IconShield, adminOnly: true },
  { href: "/settings", label: "Settings", icon: IconSettings },
];

const NAV_ITEMS = [...NAV_MAIN, ...NAV_BOTTOM];

/** Most specific nav entry for a path (longest matching prefix across hrefs and aliases). */
function activeNavHref(pathname: string): string | undefined {
  const matches = NAV_ITEMS.flatMap((i) =>
    [i.href, ...(i.also ?? [])]
      .filter((p) => pathname === p || pathname.startsWith(`${p}/`))
      .map((p) => ({ href: i.href, len: p.length })),
  );
  return matches.sort((a, b) => b.len - a.len)[0]?.href;
}

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

interface ShellHealth {
  label: string;
  dotClass: string;
  version: string;
  env?: string;
  authEnabled?: boolean;
}

async function signOut() {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } finally {
    window.location.assign("/login");
  }
}

/** Sidebar account button: who is signed in + role, opening a small menu (account, users, sign out). */
function AccountMenu({ me, onNavigate }: { me: CurrentUser | null; onNavigate?: () => void }) {
  const [open, setOpen] = useState(false);
  const name = me?.displayName ?? me?.username ?? "…";
  const item =
    "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] text-sidebar-fg-muted transition-colors hover:bg-white/[0.05] hover:text-sidebar-fg";
  return (
    <div
      className="relative"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      {open && (
        <div
          role="menu"
          data-testid="account-menu"
          className="absolute bottom-full left-0 right-0 mb-2 rounded-lg border border-sidebar-border/70 bg-sidebar-bg p-1 shadow-xl"
        >
          <Link href="/account" role="menuitem" className={item} onClick={onNavigate} data-testid="account-menu-account">
            My account
          </Link>
          <div className="my-1 h-px bg-sidebar-border/60" />
          <button type="button" role="menuitem" className={item} onClick={() => void signOut()} data-testid="sign-out">
            <IconPower className="h-3.5 w-3.5" />
            Sign out
          </button>
        </div>
      )}
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        data-testid="account-button"
        className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/[0.04]"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/20 text-xs font-semibold uppercase text-sidebar-fg">
          {name.slice(0, 1)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-sidebar-fg">{name}</span>
          <span className="block text-[11px] text-sidebar-fg-muted" data-testid="account-role-label">
            {me ? ROLE_LABEL[me.role] : ""}
          </span>
        </span>
        <span aria-hidden className="text-[10px] text-sidebar-fg-muted">
          {open ? "▾" : "▴"}
        </span>
      </button>
    </div>
  );
}

/** Sidebar contents — shared by the desktop aside and the mobile drawer. */
function SidebarBody({
  pathname,
  health,
  me,
  onNavigate,
}: {
  pathname: string;
  health: ShellHealth;
  me: CurrentUser | null;
  onNavigate?: () => void;
}) {
  return (
    <>
      {/* Logo area */}
      <div className="relative z-10 mx-4 mt-5 mb-6 flex items-center gap-3">
        <ArgusMark className="h-7 w-7 shrink-0" />
        <div>
          <p className="text-base font-semibold leading-none tracking-[-0.01em] text-sidebar-fg">Argus</p>
          <p className="mt-1 text-[9px] uppercase tracking-[0.22em] text-sidebar-fg-muted/70">M365 Notifications</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="relative z-10 flex flex-1 flex-col px-3">
        {[NAV_MAIN, NAV_BOTTOM].map((items, i) => (
          <div key={i} className={cn("flex flex-col gap-0.5", i === 1 && "mt-auto pb-3")}>
            {items.filter((n) => !n.adminOnly || me?.role === "admin").map(({ href, label, icon: Icon }) => {
              const active = activeNavHref(pathname) === href;
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={onNavigate}
                  data-testid={`nav-${href.slice(1).replace(/\//g, "-")}`}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-150",
                    active
                      ? "bg-white/[0.04] text-sidebar-fg"
                      : "text-sidebar-fg-muted hover:bg-white/[0.04] hover:text-sidebar-fg",
                  )}
                >
                  {active && <span className="nav-active-indicator" />}
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

      {/* Footer area — flat 1px divider, live status */}
      <div className="relative z-10 border-t border-sidebar-border/60 px-4 py-3">
        {health.authEnabled && (
          <div className="-mx-2 mb-2">
            <AccountMenu me={me} onNavigate={onNavigate} />
          </div>
        )}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={cn("status-dot", health.dotClass)} />
            <span className="text-[11px] font-medium text-sidebar-fg-muted">{health.label}</span>
          </div>
          <div className="flex items-center gap-1">
            <ThemeToggle />
          </div>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <p className="font-mono text-[10px] text-sidebar-fg-muted/50">v{health.version}</p>
          {health.env && health.env !== "production" && (
            <span
              data-testid="env-badge"
              className="border border-warning/40 bg-warning/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-warning"
            >
              {health.env}
            </span>
          )}
        </div>
      </div>
    </>
  );
}

export function AppShell({ title, actions, children }: { title: string; actions?: React.ReactNode; children: React.ReactNode }) {
  const pathname = usePathname();
  const me = useCurrentUser();
  const [navOpen, setNavOpen] = useState(false);
  const [health, setHealth] = useState<ShellHealth>({
    label: "Checking…",
    dotClass: "bg-sidebar-fg-muted/40",
    version: "0.4.0",
  });

  useEffect(() => {
    let active = true;
    void fetch("/api/health")
      .then((r) => r.json())
      .then((b) => {
        if (!active || !b.success) return;
        const d = b.data;
        // Anonymous health omits detail: the session expired, so sign in again.
        if (d.env === undefined) {
          window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
          return;
        }
        const ver = typeof d.version === "string" ? d.version : "0.4.0";
        const env = typeof d.env === "string" ? d.env : "production";
        const authEnabled = d.auth?.mode === "access-key";
        if (d.status !== "healthy") {
          setHealth({ label: "Degraded", dotClass: "bg-danger", version: ver, env, authEnabled });
        } else if (!d.vault?.masterKeyPresent || !d.vault?.configured || d.integrationStatus !== "connected") {
          setHealth({ label: "Setup required", dotClass: "bg-warning", version: ver, env, authEnabled });
        } else {
          setHealth({ label: "M365 connected", dotClass: "bg-success", version: ver, env, authEnabled });
        }
      })
      .catch(() => {
        if (active) setHealth((h) => ({ ...h, label: "Status unknown", dotClass: "bg-sidebar-fg-muted/50" }));
      });
    return () => {
      active = false;
    };
  }, [pathname]);

  // Close the mobile drawer on route change.
  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  // Close on Escape + lock body scroll while the drawer is open.
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNavOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [navOpen]);

  return (
    <div className="flex min-h-screen bg-bg">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar-bg md:flex">
        <SidebarBody pathname={pathname} health={health} me={me} />
      </aside>

      {/* Mobile drawer + backdrop */}
      {navOpen && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true">
          <button
            aria-label="Close navigation"
            onClick={() => setNavOpen(false)}
            className="absolute inset-0 bg-black/50"
          />
          <div className="absolute inset-y-0 left-0 flex w-64 flex-col border-r border-sidebar-border bg-sidebar-bg shadow-elevated animate-slide-in-right">
            <SidebarBody pathname={pathname} health={health} me={me} onNavigate={() => setNavOpen(false)} />
          </div>
        </div>
      )}

      {/* Main area */}
      <div className="relative flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-border/60 bg-bg px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              aria-label="Open navigation"
              aria-expanded={navOpen}
              data-testid="nav-toggle"
              onClick={() => setNavOpen(true)}
              className="-ml-1 inline-flex h-9 w-9 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg md:hidden"
            >
              <IconMenu className="h-5 w-5" />
            </button>
            <h1 className="truncate text-xl font-semibold tracking-[-0.02em] text-fg sm:text-2xl">{title}</h1>
            {me?.role === "viewer" && (
              <span
                data-testid="view-only-badge"
                title="Your role can look but not change anything. Ask an admin for Operator access."
                className="shrink-0 rounded-full border border-border/70 px-2 py-0.5 text-[11px] font-medium text-fg-muted"
              >
                View only
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              aria-label="Open command palette"
              data-testid="command-trigger"
              onClick={() =>
                window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))
              }
              className="hidden h-8 items-center gap-1.5 rounded-lg border border-border/70 px-2.5 text-xs text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg sm:inline-flex"
            >
              <span>Search</span>
              <kbd className="rounded border border-border/70 bg-surface-2 px-1 font-mono text-[10px]">⌘K</kbd>
            </button>
            {actions}
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 px-4 py-6 sm:px-6">
          {children}
        </main>
      </div>

      <CommandPalette />
    </div>
  );
}
