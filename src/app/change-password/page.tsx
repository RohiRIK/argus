import { Suspense } from "react";
import type { Metadata } from "next";
import { ChangePasswordForm } from "./change-password-form";

export const metadata: Metadata = { title: "Set your password — Argus" };

export default function ChangePasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4 py-10">
      <Suspense>
        <ChangePasswordForm />
      </Suspense>
    </main>
  );
}
