import Link from "next/link";
import { ArrowRight, Zap, Code2, Rocket } from "lucide-react";
import { UserCenter } from "@/components/UserCenter";
import { BrandLogo } from "@/components/BrandLogo";
import { StripeCheckoutButton } from "@/components/StripeCheckoutButton";

export default function Home() {
    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100 flex flex-col items-center justify-center p-6 relative overflow-hidden">
            {/* Background Gradients */}
            <div className="absolute top-0 left-0 w-full h-full overflow-hidden z-0">
                <div className="absolute -top-1/2 -left-1/4 w-[800px] h-[800px] bg-purple-500/20 rounded-full blur-3xl opacity-50 animate-pulse" />
                <div className="absolute top-1/2 -right-1/4 w-[600px] h-[600px] bg-blue-500/20 rounded-full blur-3xl opacity-50 animate-pulse delay-1000" />
            </div>

            <main className="z-10 max-w-4xl w-full text-center space-y-8">
                <div className="flex justify-between items-center">
                    <BrandLogo />
                    <UserCenter />
                </div>
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/50 dark:bg-white/10 backdrop-blur-md border border-white/20 shadow-sm mb-4 animate-in fade-in slide-in-from-top-5 duration-700">
                    <Zap className="w-4 h-4 text-yellow-500" />
                    <span className="text-sm font-medium">Built for solo builders and small teams</span>
                </div>

                <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight bg-gradient-to-br from-gray-900 via-blue-800 to-purple-900 dark:from-white dark:via-blue-200 dark:to-purple-200 bg-clip-text text-transparent animate-in zoom-in-95 duration-1000">
                    Turn Product Ideas into <br className="hidden md:block" />{" "}
                    <span className="text-blue-600 dark:text-blue-400">Actionable Blueprints</span>
                </h1>

                <p className="text-xl text-gray-600 dark:text-gray-300 max-w-2xl mx-auto leading-relaxed animate-in fade-in slide-in-from-bottom-5 duration-1000 delay-200">
                    Generate a PRD, architecture diagram, build checklist, and low-token patch-style instructions in minutes.
                </p>
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-blue-50/80 dark:bg-blue-900/20 border border-blue-200/60 dark:border-blue-700/40 text-blue-700 dark:text-blue-300 text-sm font-semibold">
                    One-time purchase - $9.9 per project - No subscription
                </div>

                <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mt-8 animate-in fade-in slide-in-from-bottom-5 duration-1000 delay-300">
                    <Link
                        href="/dashboard"
                        className="group relative px-8 py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-lg shadow-xl hover:shadow-2xl hover:-translate-y-1 transition-all duration-300 flex items-center gap-2"
                    >
                        Generate Your First Blueprint
                        <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                        <div className="absolute inset-0 rounded-xl bg-white/20 blur opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                    </Link>
                    <Link
                        href="/dashboard"
                        className="flex items-center gap-2 px-8 py-4 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-xl font-semibold border border-gray-200 dark:border-gray-700 transition-colors"
                    >
                        <Code2 className="w-5 h-5" />
                        View Sample Project
                    </Link>
                </div>

                <StripeCheckoutButton
                    label="Buy 1 Project Credit"
                    className="inline-flex items-center gap-2 px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-semibold shadow-lg transition-colors disabled:opacity-70 disabled:cursor-not-allowed"
                />

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-16 text-left animate-in fade-in slide-in-from-bottom-10 duration-1000 delay-500">
                    <div className="p-6 rounded-2xl bg-white/60 dark:bg-white/5 backdrop-blur-lg border border-white/20 hover:border-blue-500/50 transition-colors">
                        <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center mb-4">
                            <Rocket className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                        </div>
                        <h3 className="text-lg font-bold mb-2">PRD + Architecture</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400">Clarify requirements and system design before coding to reduce rework.</p>
                    </div>
                    <div className="p-6 rounded-2xl bg-white/60 dark:bg-white/5 backdrop-blur-lg border border-white/20 hover:border-purple-500/50 transition-colors">
                        <div className="w-12 h-12 bg-purple-100 dark:bg-purple-900/30 rounded-lg flex items-center justify-center mb-4">
                            <Code2 className="w-6 h-6 text-purple-600 dark:text-purple-400" />
                        </div>
                        <h3 className="text-lg font-bold mb-2">Build Task Checklist</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400">Break work into executable tasks so your team can ship faster.</p>
                    </div>
                    <div className="p-6 rounded-2xl bg-white/60 dark:bg-white/5 backdrop-blur-lg border border-white/20 hover:border-pink-500/50 transition-colors">
                        <div className="w-12 h-12 bg-pink-100 dark:bg-pink-900/30 rounded-lg flex items-center justify-center mb-4">
                            <Zap className="w-6 h-6 text-pink-600 dark:text-pink-400" />
                        </div>
                        <h3 className="text-lg font-bold mb-2">Low-Token Patch Instructions</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400">Use minimal context and precise edits to cut AI assistant token usage.</p>
                    </div>
                </div>

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
