"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
    getRedirectResult,
    GoogleAuthProvider,
    OAuthProvider,
    SAMLAuthProvider,
    signOut,
    signInWithCustomToken,
    signInWithEmailAndPassword,
    signInWithPopup,
    signInWithRedirect
} from "firebase/auth";
import { ArrowLeft, Loader2, Mail, ShieldCheck, Eye, EyeOff } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { useNavigationFeedback } from "@/components/NavigationFeedback";
import { getFirebaseAuth } from "@/lib/firebase-client";
import {
    createDefaultEnterpriseAuthBootstrap,
    type EnterpriseAuthBootstrap
} from "@/lib/auth-enterprise-shared";

type AuthFlow = "login" | "register" | "forgot";
type LoginMethod = "password" | "code";
type SendCodePurpose = "register" | "login" | "reset_password";
type PendingAction = "form" | "google" | "enterprise" | "dev";
const CODE_TTL_SECONDS = 120;
const ENTERPRISE_REDIRECT_STORAGE_KEY = "fc.enterprise-auth.redirect";

function createRedirectBootstrapSnapshot(bootstrap: EnterpriseAuthBootstrap) {
    return {
        identityPlatformTenantId: bootstrap.identityPlatformTenantId,
        providerType: bootstrap.providerType,
        providerId: bootstrap.providerId,
        tenantId: bootstrap.tenantId
    };
}

function persistRedirectBootstrap(bootstrap: EnterpriseAuthBootstrap) {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem(
        ENTERPRISE_REDIRECT_STORAGE_KEY,
        JSON.stringify(createRedirectBootstrapSnapshot(bootstrap))
    );
}

function readPersistedRedirectBootstrap() {
    if (typeof window === "undefined") return null;
    const raw = window.sessionStorage.getItem(ENTERPRISE_REDIRECT_STORAGE_KEY);
    if (!raw) return null;

    try {
        const parsed = JSON.parse(raw) as Partial<EnterpriseAuthBootstrap> | null;
        if (!parsed || typeof parsed !== "object") return null;
        return parsed;
    } catch {
        return null;
    }
}

function clearPersistedRedirectBootstrap() {
    if (typeof window === "undefined") return;
    window.sessionStorage.removeItem(ENTERPRISE_REDIRECT_STORAGE_KEY);
}

async function fetchEnterpriseAuthBootstrap(input: { email?: string; tenantHint?: string }) {
    const params = new URLSearchParams();
    const email = (input.email || "").trim();
    const tenantHint = (input.tenantHint || "").trim();

    if (email) {
        params.set("email", email);
    }
    if (tenantHint) {
        params.set("tenant", tenantHint);
    }

    const res = await fetch(`/api/auth/bootstrap?${params.toString()}`, {
        cache: "no-store"
    });
    const payload = (await res.json().catch(() => ({}))) as {
        auth?: EnterpriseAuthBootstrap;
        error?: string;
    };
    if (!res.ok || !payload.auth) {
        throw new Error(payload.error || "Failed to load enterprise sign-in settings.");
    }
    return payload.auth;
}

function readFlow(mode: string | null): AuthFlow {
    if (mode === "register") return "register";
    if (mode === "forgot") return "forgot";
    return "login";
}

const inputClassName =
    "w-full rounded-xl border border-[color:var(--border)] bg-white/90 px-4 py-2.5 text-slate-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30 dark:bg-slate-900/70 dark:text-slate-100";

const segmentedButtonBase =
    "rounded-lg px-3 py-2 text-sm text-center transition-colors";

function GoogleIcon({ className = "w-4 h-4" }: { className?: string }) {
    return (
        <svg
            className={className}
            viewBox="0 0 24 24"
            aria-hidden="true"
        >
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

function getFederatedAuthErrorMessage(error: unknown) {
    const message =
        error instanceof Error && typeof error.message === "string"
            ? error.message.trim()
            : "";
    const code =
        typeof error === "object" && error && "code" in error && typeof error.code === "string"
            ? error.code
            : "";

    if (/Firebase client is not configured/i.test(message)) {
        return "Firebase client configuration is missing. Set the NEXT_PUBLIC_FIREBASE_* variables and try again.";
    }

    switch (code) {
        case "auth/popup-closed-by-user":
        case "auth/cancelled-popup-request":
            return "Google sign-in was cancelled.";
        case "auth/popup-blocked":
            return "Popup was blocked. Allow popups for this site and try again.";
        case "auth/network-request-failed":
            return "Network error while signing in with Google.";
        case "auth/unauthorized-domain":
            return "This domain is not authorized for Firebase Google sign-in. Add it in Firebase Authentication > Settings > Authorized domains.";
        case "auth/operation-not-allowed":
            return "Google sign-in is not enabled for this Firebase project.";
        case "auth/invalid-api-key":
        case "auth/app-not-authorized":
            return "Firebase client credentials are invalid for Google sign-in.";
        case "auth/invalid-tenant-id":
        case "auth/tenant-id-mismatch":
            return "The enterprise tenant configuration does not match this sign-in request.";
        case "auth/account-exists-with-different-credential":
            return "This email already exists with another sign-in method.";
        default:
            return message || "Failed to sign in with the identity provider.";
    }
}

function getPasswordAuthErrorMessage(error: unknown) {
    const message =
        error instanceof Error && typeof error.message === "string"
            ? error.message.trim()
            : "";
    const code =
        typeof error === "object" && error && "code" in error && typeof error.code === "string"
            ? error.code
            : "";

    switch (code) {
        case "auth/user-not-found":
        case "auth/wrong-password":
        case "auth/invalid-credential":
        case "auth/invalid-login-credentials":
            return "Invalid email or password.";
        case "auth/invalid-tenant-id":
        case "auth/tenant-id-mismatch":
            return "The enterprise tenant configuration does not match this sign-in request.";
        default:
            return message || "Invalid email or password.";
    }
}

function getSessionEstablishErrorMessage(error: unknown) {
    const message =
        error instanceof Error && typeof error.message === "string"
            ? error.message.trim()
            : "";

    if (!message) {
        return "Signed in successfully, but failed to establish the app session.";
    }

    if (/Missing idToken/i.test(message) || /Invalid token/i.test(message)) {
        return "Sign-in completed, but the Firebase token could not be verified by the server.";
    }

    if (/credential/i.test(message) || /private key/i.test(message) || /project id/i.test(message)) {
        return "Sign-in completed, but the server-side Firebase Admin configuration is incomplete.";
    }

    if (/session/i.test(message)) {
        return message;
    }

    return `Sign-in completed, but the app session could not be created: ${message}`;
}

function getFederatedButtonLabel(flow: AuthFlow, bootstrap: EnterpriseAuthBootstrap) {
    if (bootstrap.mode === "enterprise") {
        if (bootstrap.providerType === "saml" || bootstrap.providerType === "oidc") {
            return "Continue with company SSO";
        }
        if (bootstrap.providerType === "google") {
            return "Continue with company Google";
        }
        return "Continue with company sign-in";
    }
    return flow === "register" ? "Create account with Google" : "Continue with Google";
}

function getEnterpriseMethodMessage(flow: AuthFlow, loginMethod: LoginMethod, bootstrap: EnterpriseAuthBootstrap) {
    if (bootstrap.mode !== "enterprise") return null;
    if (!bootstrap.ready) {
        return bootstrap.message || "Enterprise sign-in is not fully configured for this tenant.";
    }
    if (flow === "register" && !bootstrap.allowRegistration) {
        return "Self-service registration is disabled for this company. Use company SSO instead.";
    }
    if (flow === "forgot" && !bootstrap.allowPasswordLogin) {
        return "Password reset is disabled for this company because password sign-in is not enabled.";
    }
    if (flow === "login" && loginMethod === "password" && !bootstrap.allowPasswordLogin) {
        return "Password sign-in is disabled for this company. Use company SSO instead.";
    }
    if (flow === "login" && loginMethod === "code" && !bootstrap.allowCodeLogin) {
        return "Verification-code sign-in is disabled for this company. Use company SSO instead.";
    }
    return null;
}

function getEnterpriseBanner(bootstrap: EnterpriseAuthBootstrap) {
    if (bootstrap.mode !== "enterprise") return null;
    if (bootstrap.message) return bootstrap.message;
    if (bootstrap.providerType === "saml" || bootstrap.providerType === "oidc") {
        return "This workspace uses company SSO through Identity Platform.";
    }
    if (bootstrap.providerType === "google") {
        return "This workspace uses company Google sign-in through Identity Platform.";
    }
    return "This workspace uses managed company access policies.";
}

export default function LoginClient({ initialMode }: { initialMode?: "login" | "register" }) {
    const searchParams = useSearchParams();
    const router = useRouter();
    const { beginNavigation } = useNavigationFeedback();

    const callbackUrl = searchParams.get("callbackUrl") || "/dashboard";
    const tenantHint = searchParams.get("tenant") || "";
    const notice = searchParams.get("notice");
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
    const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
    const [authBootstrap, setAuthBootstrap] = useState<EnterpriseAuthBootstrap>(() => createDefaultEnterpriseAuthBootstrap());
    const [isAuthBootstrapLoading, setIsAuthBootstrapLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const isBusy = pendingAction !== null;

    useEffect(() => {
        if (codeCountdown <= 0) return;
        const timer = window.setInterval(() => {
            setCodeCountdown((prev) => (prev <= 1 ? 0 : prev - 1));
        }, 1000);
        return () => window.clearInterval(timer);
    }, [codeCountdown]);

    useEffect(() => {
        if (notice === "password-updated") {
            setMessage("Password updated. Sign in again to continue.");
            setError(null);
            return;
        }
        if (notice === "session-expired") {
            setMessage("Your session expired. Sign in again to continue.");
            setError(null);
            return;
        }
    }, [notice]);

    useEffect(() => {
        let isActive = true;
        const timer = window.setTimeout(async () => {
            try {
                const nextBootstrap = await fetchEnterpriseAuthBootstrap({
                    email,
                    tenantHint
                });
                if (!isActive) return;
                setAuthBootstrap(nextBootstrap);
            } catch {
                if (!isActive) return;
                setAuthBootstrap(createDefaultEnterpriseAuthBootstrap());
            } finally {
                if (isActive) {
                    setIsAuthBootstrapLoading(false);
                }
            }
        }, email.trim().includes("@") ? 300 : 0);

        return () => {
            isActive = false;
            window.clearTimeout(timer);
        };
    }, [email, tenantHint]);

    useEffect(() => {
        let isActive = true;

        async function resumeRedirectSignIn() {
            const persisted = readPersistedRedirectBootstrap();
            if (!persisted) return;

            setPendingAction("enterprise");
            try {
                const auth = getFirebaseAuth();
                auth.tenantId = persisted.identityPlatformTenantId || null;
                const result = await getRedirectResult(auth);
                clearPersistedRedirectBootstrap();

                if (!result?.user || !isActive) return;

                try {
                    await establishSessionFromCurrentUser();
                } catch (sessionError) {
                    await signOut(auth).catch(() => undefined);
                    if (isActive) {
                        setError(getSessionEstablishErrorMessage(sessionError));
                    }
                    return;
                }

                beginNavigation(callbackUrl);
                router.push(callbackUrl);
            } catch (nextError) {
                clearPersistedRedirectBootstrap();
                if (isActive) {
                    setError(getFederatedAuthErrorMessage(nextError));
                }
            } finally {
                if (isActive) {
                    setPendingAction(null);
                }
            }
        }

        void resumeRedirectSignIn();

        return () => {
            isActive = false;
        };
    }, [beginNavigation, callbackUrl, router]);

    const requiresCode = useMemo(() => {
        return flow === "register" || flow === "forgot" || (flow === "login" && loginMethod === "code");
    }, [flow, loginMethod]);

    const codePurpose: SendCodePurpose | null = useMemo(() => {
        if (flow === "register") return "register";
        if (flow === "forgot") return "reset_password";
        if (flow === "login" && loginMethod === "code") return "login";
        return null;
    }, [flow, loginMethod]);

    const enterpriseBanner = useMemo(() => getEnterpriseBanner(authBootstrap), [authBootstrap]);
    const emailMethodMessage = useMemo(
        () => getEnterpriseMethodMessage(flow, loginMethod, authBootstrap),
        [authBootstrap, flow, loginMethod]
    );
    const isFederatedActionBusy = pendingAction === "google" || pendingAction === "enterprise";
    const showFederatedButton =
        authBootstrap.mode !== "enterprise"
            || Boolean(authBootstrap.providerType && authBootstrap.providerId);
    const showEmailDivider =
        flow !== "forgot"
        && showFederatedButton
        && (
            authBootstrap.mode !== "enterprise"
            || authBootstrap.allowPasswordLogin
            || authBootstrap.allowCodeLogin
            || authBootstrap.allowRegistration
        );

    const loadAuthBootstrap = async (emailOverride?: string) => {
        const nextBootstrap = await fetchEnterpriseAuthBootstrap({
            email: emailOverride ?? email,
            tenantHint
        });
        setAuthBootstrap(nextBootstrap);
        setIsAuthBootstrapLoading(false);
        return nextBootstrap;
    };

    const configureAuthTenant = async (emailOverride?: string) => {
        const nextBootstrap = await loadAuthBootstrap(emailOverride);
        const auth = getFirebaseAuth();
        auth.tenantId =
            nextBootstrap.mode === "enterprise"
                ? nextBootstrap.identityPlatformTenantId || null
                : null;
        return { auth, bootstrap: nextBootstrap };
    };

    const sendCode = async () => {
        if (!email.trim() || !codePurpose || codeCountdown > 0) return;
        setError(null);
        setMessage(null);
        setIsSendingCode(true);

        try {
            const bootstrap = await loadAuthBootstrap(email);
            const blockedMessage = getEnterpriseMethodMessage(flow, loginMethod, bootstrap);
            if (blockedMessage) {
                setError(blockedMessage);
                return;
            }

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
        try {
            const { auth, bootstrap } = await configureAuthTenant(email);
            const blockedMessage = getEnterpriseMethodMessage(flow, loginMethod, bootstrap);
            if (blockedMessage) {
                setError(blockedMessage);
                return;
            }
            await signInWithEmailAndPassword(auth, email, password);
            await establishSessionFromCurrentUser();
            beginNavigation(callbackUrl);
            router.push(callbackUrl);
        } catch (nextError) {
            setError(getPasswordAuthErrorMessage(nextError));
        }
    };

    const loginWithCode = async () => {
        try {
            const { auth, bootstrap } = await configureAuthTenant(email);
            const blockedMessage = getEnterpriseMethodMessage(flow, loginMethod, bootstrap);
            if (blockedMessage) {
                setError(blockedMessage);
                return;
            }
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
        } catch (nextError) {
            const message =
                nextError instanceof Error && nextError.message.trim()
                    ? nextError.message.trim()
                    : "Failed to sign in with verification code.";
            setError(message);
        }
    };

    const loginWithFederatedProvider = async () => {
        setError(null);
        setMessage(null);
        setPendingAction(authBootstrap.mode === "enterprise" ? "enterprise" : "google");

        try {
            const { auth, bootstrap } = await configureAuthTenant(email);
            if (!bootstrap.ready) {
                setError(bootstrap.message || "Enterprise sign-in is not fully configured for this tenant.");
                return;
            }

            if (bootstrap.mode === "enterprise") {
                if (!bootstrap.providerId || !bootstrap.providerType) {
                    setError("Enterprise sign-in is not fully configured for this tenant.");
                    return;
                }

                const provider =
                    bootstrap.providerType === "saml"
                        ? new SAMLAuthProvider(bootstrap.providerId)
                        : bootstrap.providerType === "oidc"
                        ? new OAuthProvider(bootstrap.providerId)
                        : new GoogleAuthProvider();

                const customParameters: Record<string, string> = {};
                if (bootstrap.providerType === "google") {
                    customParameters.prompt = "select_account";
                }
                const loginHint = email.trim() || bootstrap.loginHint || "";
                if (loginHint) {
                    customParameters.login_hint = loginHint;
                }
                if (Object.keys(customParameters).length > 0) {
                    provider.setCustomParameters(customParameters);
                }

                if (bootstrap.providerType === "saml" || bootstrap.providerType === "oidc") {
                    persistRedirectBootstrap(bootstrap);
                    await signInWithRedirect(auth, provider);
                    return;
                }

                await signInWithPopup(auth, provider);
            } else {
                const provider = new GoogleAuthProvider();
                provider.setCustomParameters({ prompt: "select_account" });
                await signInWithPopup(auth, provider);
            }

            try {
                await establishSessionFromCurrentUser();
            } catch (sessionError) {
                await signOut(auth).catch(() => undefined);
                setError(getSessionEstablishErrorMessage(sessionError));
                return;
            }

            beginNavigation(callbackUrl);
            router.push(callbackUrl);
        } catch (nextError) {
            setError(getFederatedAuthErrorMessage(nextError));
        } finally {
            setPendingAction(null);
        }
    };

    const registerWithCode = async () => {
        const bootstrap = await loadAuthBootstrap(email);
        const blockedMessage = getEnterpriseMethodMessage(flow, loginMethod, bootstrap);
        if (blockedMessage) {
            setError(blockedMessage);
            return;
        }

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
        const bootstrap = await loadAuthBootstrap(email);
        const blockedMessage = getEnterpriseMethodMessage(flow, loginMethod, bootstrap);
        if (blockedMessage) {
            setError(blockedMessage);
            return;
        }

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
            const { auth } = await configureAuthTenant(email);
            await signInWithEmailAndPassword(auth, email, newPassword);
            await establishSessionFromCurrentUser();
            beginNavigation(callbackUrl);
            router.push(callbackUrl);
        } catch (nextError) {
            const message =
                nextError instanceof Error && nextError.message.trim()
                    ? nextError.message.trim()
                    : "Password reset succeeded, but auto sign-in failed. Please sign in manually.";
            setError(message);
            beginNavigation(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
            router.push(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
        }
    };

    const loginWithDevBypass = async () => {
        setError(null);
        setMessage(null);
        setPendingAction("dev");

        try {
            const { auth } = await configureAuthTenant(email || "dev@local");
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
        } finally {
            setPendingAction(null);
        }
    };

    const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setError(null);
        setMessage(null);
        setPendingAction("form");

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
        } catch (nextError) {
            const message =
                nextError instanceof Error && nextError.message.trim()
                    ? nextError.message.trim()
                    : "Authentication request failed.";
            setError(message);
        } finally {
            setPendingAction(null);
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
                    {authBootstrap.mode === "enterprise"
                        ? flow === "forgot"
                            ? "Company account recovery"
                            : "Company sign-in"
                        : flow === "register"
                        ? "Email + Password + Code"
                        : flow === "forgot"
                        ? "Recover your password"
                        : "Sign in to continue"}
                </h1>
                <p className="mb-6 text-sm text-slate-500 dark:text-slate-300">
                    {authBootstrap.mode === "enterprise"
                        ? enterpriseBanner
                        : flow === "login"
                        ? "Use Google, email and password, or switch to email verification code."
                        : flow === "register"
                        ? "Create your account with Google, or enter email, password, and verification code."
                        : "Use email verification code to set a new password."}
                </p>

                {flow !== "forgot" && (
                    <>
                        {showFederatedButton && (
                            <button
                                type="button"
                                onClick={() => void loginWithFederatedProvider()}
                                disabled={isBusy || isAuthBootstrapLoading || (authBootstrap.mode === "enterprise" && !authBootstrap.ready)}
                                className="fc-button-secondary mb-4 flex w-full items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {isFederatedActionBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <GoogleIcon />}
                                {getFederatedButtonLabel(flow, authBootstrap)}
                            </button>
                        )}

                        {showEmailDivider && (
                            <div className="mb-4 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
                                <div className="h-px flex-1 bg-[color:var(--border)]" />
                                <span>Or continue with email</span>
                                <div className="h-px flex-1 bg-[color:var(--border)]" />
                            </div>
                        )}
                    </>
                )}

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

                    {!error && emailMethodMessage && (
                        <div className="text-sm text-amber-600 dark:text-amber-400">{emailMethodMessage}</div>
                    )}
                    {error && <div className="text-sm text-red-500">{error}</div>}
                    {message && <div className="text-sm text-emerald-600 dark:text-emerald-400">{message}</div>}

                    <button
                        type="submit"
                        disabled={isBusy || !!emailMethodMessage}
                        className="fc-button-primary flex w-full items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {pendingAction === "form" ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                        {flow === "register" ? "Create account" : flow === "forgot" ? "Reset password" : "Sign in"}
                    </button>

                    {showDevLogin && (
                        <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void loginWithDevBypass()}
                            className="fc-button-secondary flex w-full items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {pendingAction === "dev" ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                            Dev Login
                        </button>
                    )}
                </form>
            </div>
        </div>
    );
}
