import { BrandLogo } from "@/components/BrandLogo";

export default function Loading() {
    return (
        <div className="fc-delayed-fallback relative min-h-screen overflow-hidden px-4 py-6 text-slate-900 dark:text-slate-100 sm:px-6">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(13,93,255,0.18),transparent_68%)]" />
            <div className="pointer-events-none absolute -top-24 -left-16 h-72 w-72 rounded-full bg-blue-500/12 blur-3xl" />
            <div className="pointer-events-none absolute right-0 top-1/3 h-80 w-80 rounded-full bg-cyan-400/12 blur-3xl" />

            <div className="relative mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-6xl flex-col gap-6">
                <header className="fc-surface flex items-center justify-between rounded-[var(--radius-2xl)] p-5 sm:p-6">
                    <BrandLogo />
                    <div className="h-10 w-28 animate-pulse rounded-xl bg-slate-200/80 dark:bg-slate-800/80" />
                </header>

                <div className="grid flex-1 gap-6 lg:grid-cols-[0.95fr_1.05fr]">
                    <section className="fc-surface-strong rounded-[var(--radius-2xl)] p-5 sm:p-6">
                        <div className="space-y-4">
                            <div className="h-4 w-28 animate-pulse rounded bg-slate-200/80 dark:bg-slate-800/80" />
                            <div className="h-8 w-3/4 animate-pulse rounded bg-slate-200/80 dark:bg-slate-800/80" />
                            <div className="h-4 w-full animate-pulse rounded bg-slate-100/90 dark:bg-slate-800/70" />
                            <div className="h-4 w-5/6 animate-pulse rounded bg-slate-100/90 dark:bg-slate-800/70" />
                        </div>

                        <div className="mt-8 space-y-3">
                            {Array.from({ length: 4 }).map((_, index) => (
                                <div
                                    key={index}
                                    className="h-20 animate-pulse rounded-2xl border border-[color:var(--border)] bg-white/75 dark:bg-slate-900/65"
                                />
                            ))}
                        </div>
                    </section>

                    <section className="fc-surface-strong rounded-[var(--radius-2xl)] p-5 sm:p-6">
                        <div className="grid grid-cols-4 gap-2">
                            {Array.from({ length: 4 }).map((_, index) => (
                                <div
                                    key={index}
                                    className="h-10 animate-pulse rounded-xl bg-slate-200/80 dark:bg-slate-800/80"
                                />
                            ))}
                        </div>
                        <div className="mt-4 h-[min(62vh,42rem)] animate-pulse rounded-[var(--radius-2xl)] bg-slate-100/90 dark:bg-slate-800/70" />
                    </section>
                </div>
            </div>
        </div>
    );
}
