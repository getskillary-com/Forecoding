"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
    signInWithCustomToken,
    signInWithEmailAndPassword
} from "firebase/auth";
import { ArrowLeft, Loader2, Mail, ShieldCheck, Eye, EyeOff } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { useNavigationFeedback } from "@/components/NavigationFeedback";
import { getFirebaseAuth } from "@/lib/firebase-client";

type AuthFlow = "login" | "register" | "forgot";
type LoginMethod = "password" | "code";
type SendCodePurpose = "register" | "login" | "reset_password";
const CODE_TTL_SECONDS = 120;

function readFlow(mode: string | null): AuthFlow {
    if (mode === "register") return "register";
    if (mode === "forgot") return "forgot";
    return "login";
}

const inputClassName =
    "w-full rounded-xl border border-[color:var(--border)] bg-white/90 px-4 py-2.5 text-slate-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30 dark:bg-slate-900/70 dark:text-slate-100";

const segmentedButtonBase =
    "rounded-lg px-3 py-2 text-sm text-center transition-colors";

export default function LoginClient({ initialMode }: { initialMode?: "login" | "register" }) {
    const searchParams = useSearchParams();
    const router = useRouter();
    const { beginNavigation } = useNavigationFeedback();

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

    const establishSessionFromCurrentUser = async () => {
        const auth = getFirebaseAuth();
        const currentUser = auth.currentUser;
        if (!currentUser) {
            throw new Error("No authenticated user.");
        }

        const idToken = await currentUser.getIdToken(true);
        const res = await fetch("/api/auth/session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ idToken })
        });
        if (!res.ok) {
            const payload = (await res.json().catch(() => ({}))) as { error?: string };
            throw new Error(payload.error || "Failed to establish session.");
        }
    };

    const loginWithPassword = async () => {
        const auth = getFirebaseAuth();
        try {
            await signInWithEmailAndPassword(auth, email, password);
            await establishSessionFromCurrentUser();
            beginNavigation(callbackUrl);
            router.push(callbackUrl);
        } catch {
            setError("Invalid email or password.");
        }
    };

    const loginWithCode = async () => {
        try {
            const auth = getFirebaseAuth();
            const res = await fetch("/api/auth/code-login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, code })
            });
            const data = (await res.json()) as { error?: string; customToken?: string };
            if (!res.ok || !data.customToken) {
                setError(data.error || "Invalid or expired verification code.");
                return;
            }

            await signInWithCustomToken(auth, data.customToken);
            await establishSessionFromCurrentUser();
            beginNavigation(callbackUrl);
            router.push(callbackUrl);
        } catch {
            setError("Failed to sign in with verification code.");
        }
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
        try {
            const auth = getFirebaseAuth();
            await signInWithEmailAndPassword(auth, email, newPassword);
            await establishSessionFromCurrentUser();
            beginNavigation(callbackUrl);
            router.push(callbackUrl);
        } catch {
            setError("Password reset succeeded, but auto sign-in failed. Please sign in manually.");
            beginNavigation(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
            router.push(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
        }
    };

    const loginWithDevBypass = async () => {
        try {
            const auth = getFirebaseAuth();
            const res = await fetch("/api/auth/dev-login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: "dev@local" })
            });
            const data = (await res.json()) as { error?: string; customToken?: string };
            if (!res.ok || !data.customToken) {
                setError(data.error || "Dev login is unavailable.");
                return;
            }

            await signInWithCustomToken(auth, data.customToken);
            await establishSessionFromCurrentUser();
            beginNavigation(callbackUrl);
            router.push(callbackUrl);
        } catch {
            setError("Dev login is unavailable.");
        }
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
        <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-8 text-slate-900 dark:text-slate-100 sm:px-6">
            <div className="pointer-events-none absolute inset-0">
                <div className="fc-float absolute -top-24 -left-20 h-72 w-72 rounded-full bg-blue-500/20 blur-3xl" />
                <div className="fc-float absolute -right-20 top-1/3 h-72 w-72 rounded-full bg-cyan-400/20 blur-3xl" style={{ animationDelay: "0.8s" }} />
            </div>
            <div className="fc-surface-strong relative z-10 w-full max-w-md rounded-[var(--radius-2xl)] p-6 sm:p-7">
                <div className="mb-4 flex items-center justify-between text-sm">
                    <Link
                        href="/"
                        className="flex items-center gap-1 text-slate-500 transition-colors hover:text-slate-800 dark:text-slate-300 dark:hover:text-slate-100"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back to home
                    </Link>
                    <div className="flex items-center gap-2 text-slate-500 dark:text-slate-300">
                        <BrandLogo
                            showText={false}
                            iconClassName="w-[clamp(16px,1.8vw,22px)] h-[clamp(16px,1.8vw,22px)]"
                        />
                        <span>Forecoding Auth</span>
                    </div>
                </div>

                <div className="mb-4 grid grid-cols-3 gap-2 rounded-xl border border-[color:var(--border)] bg-slate-100/90 p-1 dark:bg-slate-800/80">
                    <Link
                        href={`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`}
                        className={`${segmentedButtonBase} ${
                            flow === "login" ? "bg-white font-semibold text-slate-900 dark:bg-slate-700 dark:text-slate-100" : "text-slate-600 dark:text-slate-300"
                        }`}
                    >
                        Sign in
                    </Link>
                    <Link
                        href={`/login?mode=register&callbackUrl=${encodeURIComponent(callbackUrl)}`}
                        className={`${segmentedButtonBase} ${
                            flow === "register" ? "bg-white font-semibold text-slate-900 dark:bg-slate-700 dark:text-slate-100" : "text-slate-600 dark:text-slate-300"
                        }`}
                    >
                        Register
                    </Link>
                    <Link
                        href={`/login?mode=forgot&callbackUrl=${encodeURIComponent(callbackUrl)}`}
                        className={`${segmentedButtonBase} ${
                            flow === "forgot" ? "bg-white font-semibold text-slate-900 dark:bg-slate-700 dark:text-slate-100" : "text-slate-600 dark:text-slate-300"
                        }`}
                    >
                        Forgot
                    </Link>
                </div>

                <div className="mb-2 flex items-center gap-2 text-blue-600 dark:text-blue-400">
                    <ShieldCheck className="w-5 h-5" />
                    <span className="text-sm font-semibold">
                        {flow === "register" ? "Create account" : flow === "forgot" ? "Reset password" : "Sign in"}
                    </span>
                </div>
                <h1 className="mb-2 text-2xl font-semibold text-slate-900 dark:text-slate-100">
                    {flow === "register" ? "Email + Password + Code" : flow === "forgot" ? "Recover your password" : "Sign in to continue"}
                </h1>
                <p className="mb-6 text-sm text-slate-500 dark:text-slate-300">
                    {flow === "login"
                        ? "Use email and password, or switch to email verification code."
                        : flow === "register"
                            ? "Enter email, password, and verification code to create your account."
                            : "Use email verification code to set a new password."}
                </p>

                {flow === "login" && (
                    <div className="mb-4 grid grid-cols-2 gap-2 rounded-xl border border-[color:var(--border)] bg-slate-100/90 p-1 dark:bg-slate-800/80">
                        <button
                            type="button"
                            onClick={() => setLoginMethod("password")}
                            className={`${segmentedButtonBase} ${
                                loginMethod === "password"
                                    ? "bg-white font-semibold text-slate-900 dark:bg-slate-700 dark:text-slate-100"
                                    : "text-slate-600 dark:text-slate-300"
                            }`}
                        >
                            Password
                        </button>
                        <button
                            type="button"
                            onClick={() => setLoginMethod("code")}
                            className={`${segmentedButtonBase} ${
                                loginMethod === "code"
                                    ? "bg-white font-semibold text-slate-900 dark:bg-slate-700 dark:text-slate-100"
                                    : "text-slate-600 dark:text-slate-300"
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
                            className={inputClassName}
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
                                    className={`${inputClassName} pr-11`}
                                    required
                                    minLength={8}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword((prev) => !prev)}
                                    className="absolute inset-y-0 right-0 px-3 text-slate-500 hover:text-slate-700 dark:text-slate-300 dark:hover:text-slate-100"
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
                                    className={`${inputClassName} pr-11`}
                                    required
                                    minLength={8}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowNewPassword((prev) => !prev)}
                                    className="absolute inset-y-0 right-0 px-3 text-slate-500 hover:text-slate-700 dark:text-slate-300 dark:hover:text-slate-100"
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
                                    className={inputClassName}
                                    required
                                    maxLength={6}
                                />
                                <button
                                    type="button"
                                    onClick={sendCode}
                                    disabled={isSendingCode || !email.trim() || codeCountdown > 0}
                                    className="fc-button-secondary min-w-20 px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
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
                    {message && <div className="text-sm text-emerald-600 dark:text-emerald-400">{message}</div>}

                    <button
                        type="submit"
                        disabled={isSubmitting}
                        className="fc-button-primary flex w-full items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                        {flow === "register" ? "Create account" : flow === "forgot" ? "Reset password" : "Sign in"}
                    </button>

                    {showDevLogin && (
                        <button
                            type="button"
                            onClick={() => void loginWithDevBypass()}
                            className="fc-button-secondary w-full px-4 py-2.5 text-sm font-semibold"
                        >
                            Dev Login
                        </button>
                    )}
                </form>
            </div>
        </div>
    );
}
