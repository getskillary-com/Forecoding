"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Mail, Loader2, ArrowRight } from "lucide-react";

export default function LoginPage() {
    const searchParams = useSearchParams();
    const callbackUrl = searchParams.get("callbackUrl") || "/dashboard";
    const isVerify = searchParams.get("verify") === "1";
    const showDevLogin = process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS === "1";

    const [email, setEmail] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [sent, setSent] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!email.trim()) return;
        setIsSubmitting(true);
        setError(null);

        try {
            const result = await signIn("email", {
                email,
                callbackUrl,
                redirect: false
            });

            if (result?.error) {
                setError(result.error);
            } else {
                setSent(true);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to send login email.");
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100 flex items-center justify-center p-6">
            <div className="w-full max-w-md bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-xl p-6">
                <div className="flex items-center gap-2 mb-2 text-blue-600 dark:text-blue-400">
                    <Mail className="w-5 h-5" />
                    <span className="text-sm font-semibold">Email Sign In</span>
                </div>
                <h1 className="text-2xl font-bold mb-2">Sign in to continue</h1>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
                    {isVerify
                        ? "We sent you a magic link. Check your inbox to complete sign in."
                        : "Enter your email and we’ll send you a magic link."}
                </p>

                {sent ? (
                    <div className="rounded-xl border border-green-200 dark:border-green-900/40 bg-green-50 dark:bg-green-900/10 p-4 text-sm text-green-700 dark:text-green-300">
                        Magic link sent to <span className="font-semibold">{email}</span>. Please check your inbox.
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium mb-1">Email</label>
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="you@company.com"
                                className="w-full px-4 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                                required
                            />
                        </div>

                        {error && (
                            <div className="text-sm text-red-500">{error}</div>
                        )}

                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold shadow-lg transition-all disabled:opacity-60"
                        >
                            {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
                            {isSubmitting ? "Sending..." : "Send Magic Link"}
                        </button>

                        {showDevLogin && (
                            <button
                                type="button"
                                onClick={() => signIn("credentials", { email: "dev@local", callbackUrl })}
                                className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-gray-900 hover:bg-black text-white font-semibold shadow-lg transition-all"
                            >
                                Dev Login (No Email)
                            </button>
                        )}
                    </form>
                )}
            </div>
        </div>
    );
}
