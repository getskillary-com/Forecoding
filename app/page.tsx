import Link from "next/link";
import {
    ArrowRight,
    Zap,
    Code2,
    Rocket,
    Workflow,
    Layers3,
    ShieldCheck,
    CheckCircle2,
    Briefcase,
    Bot,
    ShoppingCart,
    PlaySquare
} from "lucide-react";
import { UserCenter } from "@/components/UserCenter";
import { BrandLogo } from "@/components/BrandLogo";

const scenarioCards = [
    {
        icon: PlaySquare,
        title: "Content / Video Platform",
        detail: "For upload flow, playback, creator roles, moderation, and analytics."
    },
    {
        icon: ShoppingCart,
        title: "E-commerce or Marketplace",
        detail: "For catalog, checkout, inventory, order lifecycle, and admin tools."
    },
    {
        icon: Bot,
        title: "AI Product or Agent Workflow",
        detail: "For prompt orchestration, tools, data boundaries, and evaluation loops."
    },
    {
        icon: Briefcase,
        title: "Internal Ops Tool",
        detail: "For approvals, role-based access, dashboards, and audit process."
    }
];

export default function Home() {
    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100 p-6 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-full overflow-hidden z-0 pointer-events-none">
                <div className="absolute -top-1/2 -left-1/4 w-[800px] h-[800px] bg-blue-500/20 rounded-full blur-3xl opacity-50 animate-pulse" />
                <div className="absolute top-1/2 -right-1/4 w-[600px] h-[600px] bg-cyan-500/20 rounded-full blur-3xl opacity-50 animate-pulse delay-1000" />
            </div>

            <main className="z-10 max-w-5xl mx-auto w-full text-center space-y-8 relative">
                <div className="flex justify-between items-center pt-2">
                    <BrandLogo />
                    <UserCenter />
                </div>

                <section className="pt-10">
                    <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/50 dark:bg-white/10 backdrop-blur-md border border-white/20 shadow-sm mb-4">
                        <Zap className="w-4 h-4 text-yellow-500" />
                        <span className="text-sm font-medium">AI Product Architect for solo builders and small teams</span>
                    </div>

                    <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight bg-gradient-to-br from-gray-900 via-blue-800 to-cyan-900 dark:from-white dark:via-blue-200 dark:to-cyan-200 bg-clip-text text-transparent">
                        Explain your idea.
                        <br className="hidden md:block" />
                        Get a build-ready blueprint.
                    </h1>

                    <p className="text-xl text-gray-600 dark:text-gray-300 max-w-3xl mx-auto leading-relaxed mt-4">
                        Forecoding turns rough requirements into a structured PRD, architecture diagram,
                        implementation tasks, and low-token coding instructions you can execute immediately.
                    </p>

                    <div className="flex flex-wrap justify-center gap-2 mt-5 text-xs">
                        {["SaaS MVP", "Internal Tool", "AI Workflow", "Marketplace", "Content Platform"].map((tag) => (
                            <span
                                key={tag}
                                className="px-3 py-1.5 rounded-full bg-white/70 dark:bg-white/10 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300"
                            >
                                {tag}
                            </span>
                        ))}
                    </div>

                    <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mt-8">
                        <Link
                            href="/dashboard"
                            className="group relative px-8 py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-lg shadow-xl hover:shadow-2xl hover:-translate-y-1 transition-all duration-300 flex items-center gap-2"
                        >
                            Start a Project
                            <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                            <div className="absolute inset-0 rounded-xl bg-white/20 blur opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                        </Link>
                        <Link
                            href="/dashboard"
                            className="flex items-center gap-2 px-8 py-4 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-xl font-semibold border border-gray-200 dark:border-gray-700 transition-colors"
                        >
                            <Code2 className="w-5 h-5" />
                            Open Workspace
                        </Link>
                    </div>
                </section>

                <section className="grid grid-cols-1 md:grid-cols-4 gap-5 mt-16 text-left">
                    <div className="p-6 rounded-2xl bg-white/60 dark:bg-white/5 backdrop-blur-lg border border-white/20 hover:border-blue-500/50 transition-colors">
                        <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center mb-4">
                            <Rocket className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                        </div>
                        <h3 className="text-lg font-bold mb-2">PRD + Scope</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400">Converts vague ideas into concrete requirements and boundaries.</p>
                    </div>
                    <div className="p-6 rounded-2xl bg-white/60 dark:bg-white/5 backdrop-blur-lg border border-white/20 hover:border-cyan-500/50 transition-colors">
                        <div className="w-12 h-12 bg-cyan-100 dark:bg-cyan-900/30 rounded-lg flex items-center justify-center mb-4">
                            <Workflow className="w-6 h-6 text-cyan-600 dark:text-cyan-400" />
                        </div>
                        <h3 className="text-lg font-bold mb-2">Architecture + Flows</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400">Builds a living diagram and key system decisions before coding.</p>
                    </div>
                    <div className="p-6 rounded-2xl bg-white/60 dark:bg-white/5 backdrop-blur-lg border border-white/20 hover:border-green-500/50 transition-colors">
                        <div className="w-12 h-12 bg-green-100 dark:bg-green-900/30 rounded-lg flex items-center justify-center mb-4">
                            <Layers3 className="w-6 h-6 text-green-600 dark:text-green-400" />
                        </div>
                        <h3 className="text-lg font-bold mb-2">Task Breakdown</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400">Splits implementation into execution-ready tasks for your team.</p>
                    </div>
                    <div className="p-6 rounded-2xl bg-white/60 dark:bg-white/5 backdrop-blur-lg border border-white/20 hover:border-amber-500/50 transition-colors">
                        <div className="w-12 h-12 bg-amber-100 dark:bg-amber-900/30 rounded-lg flex items-center justify-center mb-4">
                            <ShieldCheck className="w-6 h-6 text-amber-600 dark:text-amber-400" />
                        </div>
                        <h3 className="text-lg font-bold mb-2">Low-Token Build Prompt</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400">Outputs patch-style coding instructions optimized for AI coding tools.</p>
                    </div>
                </section>

                <section className="mt-14 text-left">
                    <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 text-center">Typical Use Scenarios</h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400 text-center mt-2 mb-6">
                        Best for projects where requirements span multiple modules and roles.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {scenarioCards.map((item) => {
                            const Icon = item.icon;
                            return (
                                <div
                                    key={item.title}
                                    className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/40 p-5"
                                >
                                    <div className="flex items-start gap-3">
                                        <div className="mt-0.5 h-9 w-9 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                                            <Icon className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                                        </div>
                                        <div>
                                            <h3 className="font-semibold">{item.title}</h3>
                                            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{item.detail}</p>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </section>

                <section className="mt-14 text-left">
                    <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 text-center">How It Works</h2>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
                        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/40 p-5">
                            <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400 font-semibold">
                                <CheckCircle2 className="w-4 h-4" />
                                Step 1
                            </div>
                            <h3 className="font-semibold mt-2">Describe your product idea</h3>
                            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Share goals, users, and constraints in natural language.</p>
                        </div>
                        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/40 p-5">
                            <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400 font-semibold">
                                <CheckCircle2 className="w-4 h-4" />
                                Step 2
                            </div>
                            <h3 className="font-semibold mt-2">Refine with guided questions</h3>
                            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">The chat narrows scope until implementation is clear enough.</p>
                        </div>
                        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/40 p-5">
                            <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400 font-semibold">
                                <CheckCircle2 className="w-4 h-4" />
                                Step 3
                            </div>
                            <h3 className="font-semibold mt-2">Generate and execute blueprint</h3>
                            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Apply PRD, architecture, and tasks directly in your build workflow.</p>
                        </div>
                    </div>
                </section>

                <section className="rounded-2xl border border-blue-200/60 dark:border-blue-800/40 bg-blue-50/70 dark:bg-blue-900/10 p-6 mt-12">
                    <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                        <div className="text-left">
                            <h3 className="text-lg font-bold">Need fast product validation before coding?</h3>
                            <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                                Start one project, clarify requirements in chat, then generate your implementation blueprint.
                            </p>
                        </div>
                        <Link
                            href="/dashboard"
                            className="inline-flex items-center gap-2 px-5 py-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold transition-colors"
                        >
                            Open Dashboard
                            <ArrowRight className="w-4 h-4" />
                        </Link>
                    </div>
                </section>

                <div className="pt-6 text-sm text-gray-500 dark:text-gray-400 flex flex-wrap justify-center gap-4">
                    <Link href="/privacy" className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                        Privacy
                    </Link>
                    <Link href="/terms" className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                        Terms
                    </Link>
                    <Link href="/refund" className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                        Refund
                    </Link>
                    <Link href="/cookie" className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                        Cookie
                    </Link>
                </div>
            </main>
        </div>
    );
}
