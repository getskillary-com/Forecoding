import Link from "next/link";
import {
    ArrowRight,
    Sparkles,
    Compass,
    Workflow,
    Boxes,
    ShieldCheck,
    CheckCircle2,
    Gauge
} from "lucide-react";
import { UserCenter } from "@/components/UserCenter";
import { BrandLogo } from "@/components/BrandLogo";

const capabilityCards = [
    {
        icon: Compass,
        title: "Business Discovery",
        description: "Interrogate goals, users, constraints, and risks before architecture is allowed to harden."
    },
    {
        icon: Workflow,
        title: "Boundary Modeling",
        description: "Define bounded contexts, ownership, contracts, and module responsibilities explicitly."
    },
    {
        icon: Boxes,
        title: "Decision Records",
        description: "Capture tradeoffs, rejected alternatives, and consequences instead of producing one opaque answer."
    },
    {
        icon: ShieldCheck,
        title: "Delivery Guardrails",
        description: "Turn architecture into acceptance criteria, test strategy, and scaffold-ready implementation order."
    }
];

const flowSteps = [
    {
        title: "Feed the Architect your context",
        description: "Share goals, flows, constraints, risks, and reference documents."
    },
    {
        title: "Lock boundaries and decisions",
        description: "Forecoding produces an architecture pack with ownership, contracts, and tradeoffs."
    },
    {
        title: "Lock PRD and generate",
        description: "Keep PRD, architecture, and delivery guardrails synchronized before generating scaffold."
    }
];

const stackTags = ["Cursor", "Windsurf", "Cline", "VS Code + AI"];

export default function Home() {
    return (
        <div className="relative min-h-screen overflow-hidden px-4 pb-14 pt-6 sm:px-8">
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
                <div className="fc-float absolute -top-28 -left-14 h-72 w-72 rounded-full bg-blue-500/20 blur-3xl" />
                <div className="fc-float absolute right-0 top-1/3 h-72 w-72 rounded-full bg-emerald-400/20 blur-3xl" style={{ animationDelay: "1.2s" }} />
            </div>

            <main className="relative z-10 mx-auto w-full max-w-6xl space-y-10">
                <header className="flex items-center justify-between">
                    <BrandLogo />
                    <div className="flex items-center gap-3">
                        <Link
                            href="/dashboard"
                            className="hidden rounded-xl border border-[color:var(--border)] bg-white/70 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-white dark:bg-slate-900/70 dark:text-slate-200 dark:hover:bg-slate-900 md:inline-flex"
                        >
                            Dashboard
                        </Link>
                        <UserCenter />
                    </div>
                </header>

                <section className="grid items-stretch gap-6 lg:grid-cols-[1.15fr_0.85fr]">
                    <div className="fc-surface fc-fade-up rounded-[var(--radius-2xl)] p-7 sm:p-10">
                        <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[color:var(--border)] bg-white/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-slate-700 dark:bg-slate-900/70 dark:text-slate-200">
                            <Sparkles className="h-4 w-4 text-[color:var(--brand)]" />
                            Chief AI Architect for Engineering Teams
                        </div>
                        <h1 className="text-balance text-4xl font-semibold leading-tight text-slate-900 dark:text-slate-100 sm:text-5xl">
                            Forecoding turns product ambiguity into architecture decisions.
                        </h1>
                        <p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-600 dark:text-slate-300 sm:text-lg">
                            Stop treating AI like a code vending machine. Discover the business, define system
                            boundaries, lock contracts, and generate only after the architecture pack is ready.
                        </p>

                        <div className="mt-7 flex flex-wrap gap-3">
                            <Link
                                href="/dashboard"
                                className="fc-button-primary inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold"
                            >
                                Start a Project
                                <ArrowRight className="h-4 w-4" />
                            </Link>
                            <Link
                                href="/demo"
                                className="fc-button-secondary inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold"
                            >
                                View Demo Blueprint
                            </Link>
                        </div>

                        <div className="mt-6 flex flex-wrap gap-2">
                            {stackTags.map((tag) => (
                                <span key={tag} className="fc-chip text-slate-600 dark:text-slate-300">
                                    {tag}
                                </span>
                            ))}
                        </div>
                    </div>

                    <aside className="fc-surface fc-fade-up fc-delay-1 rounded-[var(--radius-2xl)] p-7 sm:p-8">
                        <div className="grid grid-cols-2 gap-3">
                            <div className="rounded-2xl border border-[color:var(--border)] bg-white/70 p-4 dark:bg-slate-900/70">
                                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-300">Output</p>
                                <p className="mt-2 text-2xl font-semibold text-slate-900 dark:text-slate-100">Architecture Pack</p>
                                <p className="mt-1 text-xs text-slate-500 dark:text-slate-300">PRD + architecture + scaffold + tasks</p>
                            </div>
                            <div className="rounded-2xl border border-[color:var(--border)] bg-white/70 p-4 dark:bg-slate-900/70">
                                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-300">Goal</p>
                                <p className="mt-2 text-2xl font-semibold text-slate-900 dark:text-slate-100">Less Drift</p>
                                <p className="mt-1 text-xs text-slate-500 dark:text-slate-300">Keep implementation aligned with architecture</p>
                            </div>
                        </div>

                        <div className="mt-4 rounded-2xl border border-[color:var(--border)] bg-gradient-to-br from-blue-600/95 to-cyan-600/90 p-5 text-white">
                            <div className="flex items-center justify-between">
                                <p className="text-sm font-semibold">Planning Quality</p>
                                <Gauge className="h-4 w-4 opacity-90" />
                            </div>
                            <p className="mt-2 text-xs text-blue-100">
                                Better architectural hygiene means more predictable implementation and fewer rewrites.
                            </p>
                            <ul className="mt-4 space-y-2 text-xs text-blue-50">
                                <li className="flex items-center gap-2">
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                    Clarify ownership before coding
                                </li>
                                <li className="flex items-center gap-2">
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                    Keep contracts and tasks synchronized
                                </li>
                                <li className="flex items-center gap-2">
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                    Keep PRD and tasks synchronized before scaffold handoff
                                </li>
                            </ul>
                        </div>
                    </aside>
                </section>

                <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                    {capabilityCards.map((card, idx) => (
                        <article
                            key={card.title}
                            className={`fc-surface rounded-2xl p-5 transition duration-300 hover:-translate-y-1 hover:shadow-[var(--shadow-lg)] fc-fade-up ${idx > 0 ? `fc-delay-${Math.min(idx, 3)}` : ""}`}
                        >
                            <div className="mb-4 inline-flex rounded-xl bg-blue-50 p-2.5 text-[color:var(--brand)] dark:bg-blue-950/40">
                                <card.icon className="h-5 w-5" />
                            </div>
                            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{card.title}</h3>
                            <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{card.description}</p>
                        </article>
                    ))}
                </section>

                <section className="fc-surface fc-fade-up fc-delay-2 rounded-[var(--radius-2xl)] p-7 sm:p-9">
                    <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">How Forecoding Works</h2>
                    <div className="mt-6 grid gap-4 md:grid-cols-3">
                        {flowSteps.map((step, index) => (
                            <div key={step.title} className="rounded-2xl border border-[color:var(--border)] bg-white/75 p-5 dark:bg-slate-900/70">
                                <div className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">
                                    {index + 1}
                                </div>
                                <h3 className="mt-3 text-base font-semibold text-slate-900 dark:text-slate-100">{step.title}</h3>
                                <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{step.description}</p>
                            </div>
                        ))}
                    </div>
                </section>

                <section className="fc-surface fc-fade-up fc-delay-3 rounded-[var(--radius-2xl)] p-7 sm:p-9">
                    <div className="flex flex-col items-start justify-between gap-5 md:flex-row md:items-center">
                        <div className="text-left">
                            <h3 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Design first, code faster.</h3>
                            <p className="mt-2 max-w-2xl text-sm text-slate-600 dark:text-slate-300">
                                Forecoding is not a final code generator. It is the architect layer that makes every downstream AI implementation pass more defensible.
                            </p>
                        </div>
                        <Link
                            href="/dashboard"
                            className="fc-button-primary inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold"
                        >
                            Open Dashboard
                            <ArrowRight className="h-4 w-4" />
                        </Link>
                    </div>
                </section>

                <footer className="flex flex-wrap justify-center gap-4 pb-2 pt-2 text-xs font-medium uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400">
                    <Link href="/privacy" className="transition-colors hover:text-[color:var(--brand)]">
                        Privacy
                    </Link>
                    <Link href="/terms" className="transition-colors hover:text-[color:var(--brand)]">
                        Terms
                    </Link>
                    <Link href="/refund" className="transition-colors hover:text-[color:var(--brand)]">
                        Refund
                    </Link>
                    <Link href="/cookie" className="transition-colors hover:text-[color:var(--brand)]">
                        Cookie
                    </Link>
                </footer>
            </main>
        </div>
    );
}
