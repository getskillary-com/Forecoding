import Link from "next/link";
import {
    ArrowRight,
    Zap,
    Code2,
    Rocket,
    Workflow,
    Layers3,
    ShieldCheck,
    CheckCircle2
} from "lucide-react";
import { UserCenter } from "@/components/UserCenter";
import { BrandLogo } from "@/components/BrandLogo";

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
                        <span className="text-sm font-medium">Core function: convert rough ideas into AI IDE-ready blueprints</span>
                    </div>

                    <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight bg-gradient-to-br from-gray-900 via-blue-800 to-cyan-900 dark:from-white dark:via-blue-200 dark:to-cyan-200 bg-clip-text text-transparent">
                        From vague requirements
                        <br className="hidden md:block" />
                        to executable AI IDE blueprint.
                    </h1>

                    <p className="text-xl text-gray-600 dark:text-gray-300 max-w-3xl mx-auto leading-relaxed mt-4">
                        Forecoding gives you structured outputs before coding: PRD, architecture, task order,
                        and patch-style execution prompts for Cursor, Windsurf, Cline, or VS Code AI.
                        The value is faster planning and less rework before implementation starts.
                    </p>

                    <div className="flex flex-wrap justify-center gap-2 mt-5 text-xs">
                        {["Cursor", "Windsurf", "Cline", "VS Code + AI"].map((tag) => (
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
                        <h3 className="text-lg font-bold mb-2">Pain: Scope keeps changing</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400">Forecoding runs structured clarification to lock requirements before build.</p>
                    </div>
                    <div className="p-6 rounded-2xl bg-white/60 dark:bg-white/5 backdrop-blur-lg border border-white/20 hover:border-cyan-500/50 transition-colors">
                        <div className="w-12 h-12 bg-cyan-100 dark:bg-cyan-900/30 rounded-lg flex items-center justify-center mb-4">
                            <Workflow className="w-6 h-6 text-cyan-600 dark:text-cyan-400" />
                        </div>
                        <h3 className="text-lg font-bold mb-2">Pain: AI output drifts</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400">Architecture and constraints align AI IDE generations to one direction.</p>
                    </div>
                    <div className="p-6 rounded-2xl bg-white/60 dark:bg-white/5 backdrop-blur-lg border border-white/20 hover:border-green-500/50 transition-colors">
                        <div className="w-12 h-12 bg-green-100 dark:bg-green-900/30 rounded-lg flex items-center justify-center mb-4">
                            <Layers3 className="w-6 h-6 text-green-600 dark:text-green-400" />
                        </div>
                        <h3 className="text-lg font-bold mb-2">Pain: No build order</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400">Task decomposition gives your AI IDE a concrete, sequential execution plan.</p>
                    </div>
                    <div className="p-6 rounded-2xl bg-white/60 dark:bg-white/5 backdrop-blur-lg border border-white/20 hover:border-amber-500/50 transition-colors">
                        <div className="w-12 h-12 bg-amber-100 dark:bg-amber-900/30 rounded-lg flex items-center justify-center mb-4">
                            <ShieldCheck className="w-6 h-6 text-amber-600 dark:text-amber-400" />
                        </div>
                        <h3 className="text-lg font-bold mb-2">Pain: Prompt waste</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400">Patch-style prompts reduce token waste and cut trial-and-error cycles.</p>
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
                            <h3 className="font-semibold mt-2">Describe requirements in plain language</h3>
                            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Provide goals, user flow, constraints, and expected behavior.</p>
                        </div>
                        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/40 p-5">
                            <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400 font-semibold">
                                <CheckCircle2 className="w-4 h-4" />
                                Step 2
                            </div>
                            <h3 className="font-semibold mt-2">Refine until scope is implementation-ready</h3>
                            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">The chat resolves missing details and removes ambiguity.</p>
                        </div>
                        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/40 p-5">
                            <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400 font-semibold">
                                <CheckCircle2 className="w-4 h-4" />
                                Step 3
                            </div>
                            <h3 className="font-semibold mt-2">Open the unzipped blueprint folder in your AI IDE</h3>
                            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Unzip the blueprint package, then continue implementation in Cursor/Windsurf/Cline.</p>
                        </div>
                    </div>
                </section>

                <section className="rounded-2xl border border-blue-200/60 dark:border-blue-800/40 bg-blue-50/70 dark:bg-blue-900/10 p-6 mt-12">
                    <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                        <div className="text-left">
                            <h3 className="text-lg font-bold">Main value: less planning time, less build rework</h3>
                            <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                                You are not buying final code output. You are buying faster, clearer starts in your AI IDE workflow.
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
