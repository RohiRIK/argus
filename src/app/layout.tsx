import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Argus — M365 Notifications",
  description: "Self-hosted Microsoft 365 admin notification system",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
