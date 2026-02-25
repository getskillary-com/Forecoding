"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { ArrowLeft, Loader2, Mail, ShieldCheck, Eye, EyeOff } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";

type AuthFlow = "login" | "register" | "forgot";
type LoginMethod = "password" | "code";
type SendCodePurpose = "register" | "login" | "reset_password";
const CODE_TTL_SECONDS = 120;

function readFlow(mode: string | null): AuthFlow {
    if (mode === "register") return "register";
    if (mode === "forgot") return "forgot";
    return "login";
}

export default function LoginClient({ initialMode }: { initialMode?: "login" | "register" }) {
    const searchParams = useSearchParams();
    const router = useRouter();

    const callbackUrl = searchParams.get("callbackUrl") || "/dashboard";
    const queryFlow = readFlow(searchParams.get("mode"));
    const flow: AuthFlow = initialMode === "register" ? "register" : queryFlow;
    const showDevLogin =
        process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS === "1";

    const [loginMethod, setLoginMethod] = useState<LoginMethod>("password");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [showNewPassword, setShowNewPassword] = useState(false);
    const [code, setCode] = useState("");
    const [codeCountdown, setCodeCountdown] = useState(0);
    const [isSendingCode, setIsSendingCode] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);

    useEffect(() => {
        if (codeCountdown <= 0) return;
        const timer = window.setInterval(() => {
            setCodeCountdown((prev) => (prev <= 1 ? 0 : prev - 1));
        }, 1000);
        return () => window.clearInterval(timer);
    }, [codeCountdown]);

    const requiresCode = useMemo(() => {
        return flow === "register" || flow === "forgot" || (flow === "login" && loginMethod === "code");
    }, [flow, loginMethod]);

    const codePurpose: SendCodePurpose | null = useMemo(() => {
        if (flow === "register") return "register";
        if (flow === "forgot") return "reset_password";
        if (flow === "login" && loginMethod === "code") return "login";
        return null;
    }, [flow, loginMethod]);

    const sendCode = async () => {
        if (!email.trim() || !codePurpose || codeCountdown > 0) return;
        setError(null);
        setMessage(null);
        setIsSendingCode(true);

        try {
            const res = await fetch("/api/auth/send-code", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, purpose: codePurpose })
            });
            const data = (await res.json()) as {
                error?: string;
                throttled?: boolean;
                retryAfterSeconds?: number;
                expiresInSeconds?: number;
            };
            const codeTtl = data.expiresInSeconds ?? CODE_TTL_SECONDS;
            if (!res.ok) {
                setError(data.error || "Failed to send verification code.");
                return;
            }
            if (data.throttled) {
                const retryAfter = data.retryAfterSeconds ?? codeTtl;
                setCodeCountdown(retryAfter);
                setMessage(`Code already sent. Retry in ${retryAfter}s.`);
                return;
            }
            setCodeCountdown(codeTtl);
            setMessage(`Verification code sent. It expires in ${codeTtl} seconds.`);
        } catch {
            setError("Failed to send verification code.");
        } finally {
            setIsSendingCode(false);
        }
    };

    const loginWithPassword = async () => {
        const result = await signIn("credentials-password", {
            email,
            password,
            callbackUrl,
            redirect: false
        });
        if (result?.error) {
            setError("Invalid email or password.");
            return;
        }
        router.push(result?.url || callbackUrl);
    };

    const loginWithCode = async () => {
        const result = await signIn("credentials-code", {
            email,
            code,
            callbackUrl,
            redirect: false
        });
        if (result?.error) {
            setError("Invalid or expired verification code.");
            return;
        }
        router.push(result?.url || callbackUrl);
    };

    const registerWithCode = async () => {
        const res = await fetch("/api/auth/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password, code })
        });
        const data = (await res.json()) as { error?: string };
        if (!res.ok) {
            setError(data.error || "Failed to create account.");
            return;
        }
        await loginWithPassword();
    };

    const resetPassword = async () => {
        const res = await fetch("/api/auth/reset-password", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, newPassword, code })
        });
        const data = (await res.json()) as { error?: string };
        if (!res.ok) {
            setError(data.error || "Failed to reset password.");
            return;
        }
        setPassword(newPassword);
        const signInResult = await signIn("credentials-password", {
            email,
            password: newPassword,
            callbackUrl,
            redirect: false
        });
        if (signInResult?.error) {
            setError("Password reset succeeded, but auto sign-in failed. Please sign in manually.");
            router.push(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
            return;
        }
        router.push(callbackUrl);
    };

    const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setError(null);
        setMessage(null);
        setIsSubmitting(true);

        try {
            if (flow === "login" && loginMethod === "password") {
                await loginWithPassword();
                return;
            }
            if (flow === "login" && loginMethod === "code") {
                await loginWithCode();
                return;
            }
            if (flow === "register") {
                await registerWithCode();
                return;
            }
            await resetPassword();
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100 flex items-center justify-center p-6">
            <div className="w-full max-w-md bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-xl p-6">
                <div className="flex items-center justify-between mb-4 text-sm">
                    <Link
                        href="/"
                        className="flex items-center gap-1 text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back to home
                    </Link>
                    <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
                        <BrandLogo
                            showText={false}
                            iconClassName="w-[clamp(16px,1.8vw,22px)] h-[clamp(16px,1.8vw,22px)]"
                        />
                        <span>Forecoding Auth</span>
                    </div>
                </div>

                <div className="grid grid-cols-3 gap-2 rounded-xl bg-gray-100 dark:bg-gray-800 p-1 mb-4">
                    <Link
                        href={`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`}
                        className={`px-3 py-2 text-sm rounded-lg text-center transition-colors ${
                            flow === "login" ? "bg-white dark:bg-gray-700 font-semibold" : "text-gray-600 dark:text-gray-300"
                        }`}
                    >
                        Sign in
                    </Link>
                    <Link
                        href={`/login?mode=register&callbackUrl=${encodeURIComponent(callbackUrl)}`}
                        className={`px-3 py-2 text-sm rounded-lg text-center transition-colors ${
                            flow === "register" ? "bg-white dark:bg-gray-700 font-semibold" : "text-gray-600 dark:text-gray-300"
                        }`}
                    >
                        Register
                    </Link>
                    <Link
                        href={`/login?mode=forgot&callbackUrl=${encodeURIComponent(callbackUrl)}`}
                        className={`px-3 py-2 text-sm rounded-lg text-center transition-colors ${
                            flow === "forgot" ? "bg-white dark:bg-gray-700 font-semibold" : "text-gray-600 dark:text-gray-300"
                        }`}
                    >
                        Forgot
                    </Link>
                </div>

                <div className="flex items-center gap-2 mb-2 text-blue-600 dark:text-blue-400">
                    <ShieldCheck className="w-5 h-5" />
                    <span className="text-sm font-semibold">
                        {flow === "register" ? "Create account" : flow === "forgot" ? "Reset password" : "Sign in"}
                    </span>
                </div>
                <h1 className="text-2xl font-bold mb-2">
                    {flow === "register" ? "Email + Password + Code" : flow === "forgot" ? "Recover your password" : "Sign in to continue"}
                </h1>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
                    {flow === "login"
                        ? "Use email and password, or switch to email verification code."
                        : flow === "register"
                            ? "Enter email, password, and verification code to create your account."
                            : "Use email verification code to set a new password."}
                </p>

                {flow === "login" && (
                    <div className="grid grid-cols-2 gap-2 rounded-xl bg-gray-100 dark:bg-gray-800 p-1 mb-4">
                        <button
                            type="button"
                            onClick={() => setLoginMethod("password")}
                            className={`px-3 py-2 text-sm rounded-lg transition-colors ${
                                loginMethod === "password"
                                    ? "bg-white dark:bg-gray-700 font-semibold"
                                    : "text-gray-600 dark:text-gray-300"
                            }`}
                        >
                            Password
                        </button>
                        <button
                            type="button"
                            onClick={() => setLoginMethod("code")}
                            className={`px-3 py-2 text-sm rounded-lg transition-colors ${
                                loginMethod === "code"
                                    ? "bg-white dark:bg-gray-700 font-semibold"
                                    : "text-gray-600 dark:text-gray-300"
                            }`}
                        >
                            Verification Code
                        </button>
                    </div>
                )}

                <form onSubmit={onSubmit} className="space-y-4">
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

                    {(flow === "register" || (flow === "login" && loginMethod === "password")) && (
                        <div>
                            <label className="block text-sm font-medium mb-1">Password</label>
                            <div className="relative">
                                <input
                                    type={showPassword ? "text" : "password"}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder="At least 8 characters"
                                    className="w-full px-4 py-2 pr-11 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                                    required
                                    minLength={8}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword((prev) => !prev)}
                                    className="absolute inset-y-0 right-0 px-3 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                                    aria-label={showPassword ? "Hide password" : "Show password"}
                                >
                                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                </button>
                            </div>
                        </div>
                    )}

                    {flow === "forgot" && (
                        <div>
                            <label className="block text-sm font-medium mb-1">New password</label>
                            <div className="relative">
                                <input
                                    type={showNewPassword ? "text" : "password"}
                                    value={newPassword}
                                    onChange={(e) => setNewPassword(e.target.value)}
                                    placeholder="At least 8 characters"
                                    className="w-full px-4 py-2 pr-11 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                                    required
                                    minLength={8}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowNewPassword((prev) => !prev)}
                                    className="absolute inset-y-0 right-0 px-3 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                                    aria-label={showNewPassword ? "Hide password" : "Show password"}
                                >
                                    {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                </button>
                            </div>
                        </div>
                    )}

                    {requiresCode && (
                        <div>
                            <label className="block text-sm font-medium mb-1">Verification code</label>
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={code}
                                    onChange={(e) => setCode(e.target.value)}
                                    placeholder="6-digit code"
                                    className="w-full px-4 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                                    required
                                    maxLength={6}
                                />
                                <button
                                    type="button"
                                    onClick={sendCode}
                                    disabled={isSendingCode || !email.trim() || codeCountdown > 0}
                                    className="min-w-20 px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 text-sm disabled:opacity-60"
                                >
                                    {isSendingCode ? (
                                        <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                                    ) : codeCountdown > 0 ? (
                                        <span className="tabular-nums">{codeCountdown}s</span>
                                    ) : (
                                        <span className="inline-flex items-center gap-1">
                                            <Mail className="w-4 h-4" />
                                            Send
                                        </span>
                                    )}
                                </button>
                            </div>
                        </div>
                    )}

                    {error && <div className="text-sm text-red-500">{error}</div>}
                    {message && <div className="text-sm text-green-600 dark:text-green-400">{message}</div>}

                    <button
                        type="submit"
                        disabled={isSubmitting}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold shadow-lg transition-all disabled:opacity-60"
                    >
                        {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                        {flow === "register" ? "Create account" : flow === "forgot" ? "Reset password" : "Sign in"}
                    </button>

                    {showDevLogin && (
                        <button
                            type="button"
                            onClick={() => signIn("dev-login", { email: "dev@local", callbackUrl })}
                            className="w-full px-4 py-2 rounded-xl bg-gray-900 hover:bg-black text-white font-semibold transition-all"
                        >
                            Dev Login
                        </button>
                    )}
                </form>
            </div>
        </div>
    );
}
