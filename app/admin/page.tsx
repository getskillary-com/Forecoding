import Link from "next/link";
import { getServerUser } from "@/lib/server-auth";

export default async function AdminPage() {
    const user = await getServerUser();
    const email = user?.email || "admin";

    return (
        <main className="relative min-h-screen overflow-hidden px-4 py-8 sm:px-8">
            <div className="pointer-events-none absolute inset-0">
                <div className="fc-float absolute -top-20 -left-20 h-72 w-72 rounded-full bg-blue-500/20 blur-3xl" />
                <div className="fc-float absolute right-0 top-1/3 h-72 w-72 rounded-full bg-cyan-500/20 blur-3xl" style={{ animationDelay: "1.1s" }} />
            </div>

            <div className="relative mx-auto max-w-4xl space-y-6">
                <header className="fc-surface-strong rounded-[var(--radius-2xl)] p-6">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-300">Admin Console</p>
                    <h1 className="mt-1 text-3xl font-semibold text-slate-900 dark:text-slate-100">Admin Backend</h1>
                    <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                        Current account: {email}
                    </p>
                </header>

                <section className="fc-surface-strong rounded-[var(--radius-2xl)] p-6">
                    <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Generation and Payment Policy</h2>
                    <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                        Admin users generate directly in Wizard. Stripe checkout links are not created for admin accounts.
                    </p>
                    <div className="mt-4 flex gap-3">
                        <Link
                            href="/dashboard"
                            className="fc-button-primary px-4 py-2.5 text-sm font-semibold"
                        >
                            Open Dashboard
                        </Link>
                        <Link
                            href="/"
                            className="fc-button-secondary px-4 py-2.5 text-sm font-semibold"
                        >
                            Go Home
                        </Link>
                    </div>
                </section>
            </div>
        </main>
    );
}
