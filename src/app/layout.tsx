import type { Metadata } from "next";
import { Geist, JetBrains_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { ToastProvider } from "@/components/ui/toast";

// Geist Sans — Swiss grotesque with crisp screen hinting. Bound to the exact CSS
// vars Tailwind reads (--font-sans / --font-mono) so `font-sans` resolves.
const sans = Geist({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Argus — M365 Notifications",
  description: "Self-hosted Microsoft 365 admin notification system",
};

// Set the dark class + palette before paint to avoid a flash (FOUC). Palette
// 'graphite-amber' is the default (no data-theme attribute); others set it.
const themeScript = `(function(){try{var e=document.documentElement;var s=localStorage.getItem('argus-theme');var d=s?s==='dark':matchMedia('(prefers-color-scheme: dark)').matches;e.classList.toggle('dark',d);var p=localStorage.getItem('argus-palette');if(p&&p!=='graphite-amber')e.setAttribute('data-theme',p);}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-screen font-sans selection:bg-primary/25">
        <Script id="theme-init" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: themeScript }} />
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
