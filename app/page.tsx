import type { Metadata } from "next";
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
import { getServerSessionIdentity } from "@/lib/server-auth";

export const metadata: Metadata = {
    title: "Requirements to Architecture Studio"
};

const capabilityCards = [
    {
        icon: Compass,
        title: "Requirements Progress",
        description: "Keep confirmed scope, blockers, open questions, and next actions visible in one running workspace."
    },
    {
        icon: Workflow,
        title: "Architecture Graph",
        description: "Turn clarified requirements into system boundaries, ownership, contracts, and delivery structure."
    },
    {
        icon: Boxes,
        title: "Decision Trail",
        description: "Capture tradeoffs, implementation constraints, and what changed instead of losing context in chat."
    },
    {
        icon: ShieldCheck,
        title: "Spec-Ready Handoff",
        description: "Generate only after acceptance criteria, test strategy, and implementation readiness are explicit."
    }
];

const flowSteps = [
    {
        title: "Clarify the product request",
        description: "Start from the goal, target users, key workflow, constraints, and any reference material."
    },
    {
        title: "Track scope and architecture together",
        description: "Forecoding keeps requirements progress, architecture structure, and blocker resolution synchronized."
    },
    {
        title: "Generate with clearer handoff",
        description: "Move into Spec Pack or scaffold generation only when the workspace is actually ready."
    }
];

const stackTags = ["Requirements Progress", "Architecture Graph", "Spec Pack", "Generation Gate"];

function GoogleIcon({ className = "h-4 w-4" }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
            <path
                fill="#4285F4"
                d="M21.6 12.23c0-.72-.06-1.25-.2-1.8H12v3.39h5.52c-.11.84-.73 2.1-2.12 2.95l-.02.11 3.05 2.36.21.02c1.92-1.77 3.04-4.37 3.04-7.03Z"
            />
            <path
                fill="#34A853"
                d="M12 22c2.7 0 4.97-.89 6.63-2.42l-3.16-2.45c-.84.59-1.96 1-3.47 1a6.02 6.02 0 0 1-5.71-4.16l-.1.01-3.17 2.45-.04.09A9.99 9.99 0 0 0 12 22Z"
            />
            <path
                fill="#FBBC05"
                d="M6.29 13.97A5.97 5.97 0 0 1 5.96 12c0-.68.12-1.34.31-1.97l-.01-.13-3.2-2.49-.1.05A9.98 9.98 0 0 0 2 12c0 1.6.38 3.11 1.06 4.46l3.23-2.49Z"
            />
            <path
                fill="#EA4335"
                d="M12 5.87c1.9 0 3.18.82 3.91 1.51l2.86-2.79C16.96 2.99 14.7 2 12 2a9.99 9.99 0 0 0-8.94 5.54l3.31 2.57A6.02 6.02 0 0 1 12 5.87Z"
            />
        </svg>
    );
}

export default async function Home() {
    const user = await getServerSessionIdentity();
    const isAuthed = Boolean(user?.uid);

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
                        {isAuthed ? (
                            <Link
                                href="/dashboard"
                                className="hidden rounded-xl border border-[color:var(--border)] bg-white/70 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-white dark:bg-slate-900/70 dark:text-slate-200 dark:hover:bg-slate-900 md:inline-flex"
                            >
                                Dashboard
                            </Link>
                        ) : (
                            <Link
                                href="/login?callbackUrl=/dashboard"
                                className="hidden items-center gap-2 rounded-xl border border-[color:var(--border)] bg-white/85 px-4 py-2 text-sm font-semibold text-slate-800 transition hover:bg-white dark:bg-slate-900/80 dark:text-slate-100 dark:hover:bg-slate-900 md:inline-flex"
                            >
                                <GoogleIcon />
                                Google Sign-In
                            </Link>
                        )}
                        <UserCenter />
                    </div>
                </header>

                <section className="grid items-stretch gap-6 lg:grid-cols-[1.15fr_0.85fr]">
                    <div className="fc-surface fc-fade-up rounded-[var(--radius-2xl)] p-7 sm:p-10">
                        <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[color:var(--border)] bg-white/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-slate-700 dark:bg-slate-900/70 dark:text-slate-200">
                            <Sparkles className="h-4 w-4 text-[color:var(--brand)]" />
                            AI Co-Founder for Requirements and Architecture
                        </div>
                        <h1 className="text-balance text-4xl font-semibold leading-tight text-slate-900 dark:text-slate-100 sm:text-5xl">
                            Forecoding turns vague requests into executable requirements and architecture.
                        </h1>
                        <p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-600 dark:text-slate-300 sm:text-lg">
                            Clarify the product, keep requirements progress and architecture in sync, and generate
                            only after scope, decisions, and delivery readiness are explicit.
                        </p>

                        <div className="mt-7 flex flex-wrap gap-3">
                            {isAuthed ? (
                                <>
                                    <Link
                                        href="/dashboard"
                                        className="fc-button-primary inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold"
                                    >
                                        Start Requirement Session
                                        <ArrowRight className="h-4 w-4" />
                                    </Link>
                                    <Link
                                        href="/demo"
                                        className="fc-button-secondary inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold"
                                    >
                                        View Example Workspace
                                    </Link>
                                </>
                            ) : (
                                <>
                                    <Link
                                        href="/login?callbackUrl=/dashboard"
                                        className="fc-button-primary inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold"
                                    >
                                        <GoogleIcon />
                                        Continue with Google
                                        <ArrowRight className="h-4 w-4" />
                                    </Link>
                                    <Link
                                        href="/demo"
                                        className="fc-button-secondary inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold"
                                    >
                                        View Example Workspace
                                    </Link>
                                </>
                            )}
                        </div>
                        {!isAuthed ? (
                            <p className="mt-3 text-xs text-slate-500 dark:text-slate-300">
                                Email, password, and verification-code sign-in are still available on the auth page.
                            </p>
                        ) : null}

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
                                <p className="mt-2 text-2xl font-semibold text-slate-900 dark:text-slate-100">Live Delivery Context</p>
                                <p className="mt-1 text-xs text-slate-500 dark:text-slate-300">Requirements + architecture + readiness + spec output</p>
                            </div>
                            <div className="rounded-2xl border border-[color:var(--border)] bg-white/70 p-4 dark:bg-slate-900/70">
                                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-300">Goal</p>
                                <p className="mt-2 text-2xl font-semibold text-slate-900 dark:text-slate-100">Less Ambiguity</p>
                                <p className="mt-1 text-xs text-slate-500 dark:text-slate-300">Make the next implementation step obvious</p>
                            </div>
                        </div>

                        <div className="mt-4 rounded-2xl border border-[color:var(--border)] bg-gradient-to-br from-blue-600/95 to-cyan-600/90 p-5 text-white">
                            <div className="flex items-center justify-between">
                                <p className="text-sm font-semibold">Readiness Signal</p>
                                <Gauge className="h-4 w-4 opacity-90" />
                            </div>
                            <p className="mt-2 text-xs text-blue-100">
                                Better requirement and architecture hygiene leads to fewer rewrites and cleaner handoffs.
                            </p>
                            <ul className="mt-4 space-y-2 text-xs text-blue-50">
                                <li className="flex items-center gap-2">
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                    Show what is confirmed, blocked, and still missing
                                </li>
                                <li className="flex items-center gap-2">
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                    Keep architecture and implementation intent aligned
                                </li>
                                <li className="flex items-center gap-2">
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                    Hand off a cleaner Spec Pack when generation is ready
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
                            <h3 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Align first, generate faster.</h3>
                            <p className="mt-2 max-w-2xl text-sm text-slate-600 dark:text-slate-300">
                                Forecoding is the layer that turns product discussion into a clearer implementation handoff, not just another code prompt box.
                            </p>
                        </div>
                        <Link
                            href="/dashboard"
                            className="fc-button-primary inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold"
                        >
                            Open Workspace
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
