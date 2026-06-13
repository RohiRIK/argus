import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-6 px-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Argus</h1>
        <p className="mt-2 text-sm opacity-70">
          Microsoft 365 admin notification system. Jobs, executions, logs — one pane of glass.
        </p>
      </div>
      <nav className="flex gap-4 text-sm">
        <Link className="underline underline-offset-4" href="/dashboard">
          Dashboard
        </Link>
        <Link className="underline underline-offset-4" href="/settings">
          Settings
        </Link>
        <a className="underline underline-offset-4" href="/api/health">
          Health
        </a>
      </nav>
    </main>
  );
}
