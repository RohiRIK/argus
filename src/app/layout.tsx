import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import Script from "next/script";
import "./globals.css";
import { ToastProvider } from "@/components/ui/toast";

// Local bundled Geist WOFF2 fonts (`geist/font/sans` & `geist/font/mono`) so builds
// are 100% offline-safe and deterministic across Docker & multi-arch CI runners.

export const metadata: Metadata = {
  title: "Argus — M365 Notifications",
  description: "Self-hosted Microsoft 365 admin notification system",
};

// Set the dark class + palette before paint to avoid a flash (FOUC). Palette
// 'graphite-amber' is the default (no data-theme attribute); others set it.
const themeScript = `(function(){try{var e=document.documentElement;var s=localStorage.getItem('argus-theme');var d=s?s==='dark':matchMedia('(prefers-color-scheme: dark)').matches;e.classList.toggle('dark',d);var p=localStorage.getItem('argus-palette');if(p&&p!=='graphite-amber')e.setAttribute('data-theme',p);}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-screen font-sans selection:bg-primary/25">
        <Script id="theme-init" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: themeScript }} />
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
