"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, Save, Shield, User, LogOut, Mail, Eye, EyeOff } from "lucide-react";
import { UserCenter } from "@/components/UserCenter";
import { BrandLogo } from "@/components/BrandLogo";
import { useAuth } from "@/lib/auth-client";

const CODE_TTL_SECONDS = 120;

type ProfileState = {
    email: string;
    name: string;
    emailVerified: string | null;
};

const cardClassName = "fc-surface-strong rounded-[var(--radius-2xl)] p-6";
const fieldClassName =
    "w-full rounded-xl border border-[color:var(--border)] bg-white/90 px-4 py-2.5 text-slate-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30 dark:bg-slate-900/70 dark:text-slate-100";
const disabledFieldClassName =
    "w-full rounded-xl border border-[color:var(--border)] bg-slate-100 px-4 py-2.5 text-slate-500 dark:bg-slate-800 dark:text-slate-300";

export default function AccountPage() {
    const { user, signOutUser } = useAuth();
    const [profile, setProfile] = useState<ProfileState>({
        email: user?.email ?? "",
        name: user?.displayName ?? "",
        emailVerified: null
    });
    const [isProfileLoading, setIsProfileLoading] = useState(true);
    const [isSavingProfile, setIsSavingProfile] = useState(false);
    const [profileMessage, setProfileMessage] = useState<string | null>(null);
    const [profileError, setProfileError] = useState<string | null>(null);
    const [newEmail, setNewEmail] = useState("");
    const [emailCode, setEmailCode] = useState("");
    const [emailCodeCountdown, setEmailCodeCountdown] = useState(0);
    const [isSendingEmailCode, setIsSendingEmailCode] = useState(false);
    const [isChangingEmail, setIsChangingEmail] = useState(false);
    const [emailMessage, setEmailMessage] = useState<string | null>(null);
    const [emailError, setEmailError] = useState<string | null>(null);

    const [newPassword, setNewPassword] = useState("");
    const [confirmNewPassword, setConfirmNewPassword] = useState("");
    const [showNewPassword, setShowNewPassword] = useState(false);
    const [showConfirmNewPassword, setShowConfirmNewPassword] = useState(false);
    const [isChangingPassword, setIsChangingPassword] = useState(false);
    const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
    const [passwordError, setPasswordError] = useState<string | null>(null);

    const [isSigningOutAll, setIsSigningOutAll] = useState(false);
    const [securityError, setSecurityError] = useState<string | null>(null);

    useEffect(() => {
        let ignore = false;

        const loadProfile = async () => {
            setIsProfileLoading(true);
            setProfileError(null);
            try {
                const res = await fetch("/api/account/profile", { cache: "no-store" });
                const data = (await res.json()) as {
                    error?: string;
                    user?: { email?: string | null; name?: string | null; emailVerified?: string | null };
                };

                if (!res.ok || !data.user) {
                    if (!ignore) setProfileError(data.error || "Failed to load profile.");
                    return;
                }

                if (!ignore) {
                    setProfile({
                        email: data.user.email ?? "",
                        name: data.user.name ?? "",
                        emailVerified: data.user.emailVerified ?? null
                    });
                }
            } catch {
                if (!ignore) setProfileError("Failed to load profile.");
            } finally {
                if (!ignore) setIsProfileLoading(false);
            }
        };

        loadProfile();

        return () => {
            ignore = true;
        };
    }, []);

    useEffect(() => {
        if (emailCodeCountdown <= 0) return;
        const timer = window.setInterval(() => {
            setEmailCodeCountdown((prev) => (prev <= 1 ? 0 : prev - 1));
        }, 1000);
        return () => window.clearInterval(timer);
    }, [emailCodeCountdown]);

    const saveProfile = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setProfileError(null);
        setProfileMessage(null);
        setIsSavingProfile(true);

        try {
            const res = await fetch("/api/account/profile", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: profile.name })
            });
            const data = (await res.json()) as { error?: string };
            if (!res.ok) {
                setProfileError(data.error || "Failed to update profile.");
                return;
            }
            setProfileMessage("Profile updated.");
        } catch {
            setProfileError("Failed to update profile.");
        } finally {
            setIsSavingProfile(false);
        }
    };

    const changePassword = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setPasswordError(null);
        setPasswordMessage(null);

        if (newPassword !== confirmNewPassword) {
            setPasswordError("Two passwords do not match.");
            return;
        }

        setIsChangingPassword(true);

        try {
            const res = await fetch("/api/account/change-password", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ newPassword, confirmNewPassword })
            });
            const data = (await res.json()) as { error?: string };
            if (!res.ok) {
                setPasswordError(data.error || "Failed to change password.");
                return;
            }
            setNewPassword("");
            setConfirmNewPassword("");
            setPasswordMessage("Password updated.");
        } catch {
            setPasswordError("Failed to change password.");
        } finally {
            setIsChangingPassword(false);
        }
    };

    const sendEmailChangeCode = async () => {
        if (!newEmail.trim() || emailCodeCountdown > 0) return;
        setEmailError(null);
        setEmailMessage(null);
        setIsSendingEmailCode(true);

        try {
            const res = await fetch("/api/auth/send-code", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: newEmail, purpose: "change_email" })
            });
            const data = (await res.json()) as {
                error?: string;
                throttled?: boolean;
                retryAfterSeconds?: number;
                expiresInSeconds?: number;
            };
            const codeTtl = data.expiresInSeconds ?? CODE_TTL_SECONDS;

            if (!res.ok) {
                setEmailError(data.error || "Failed to send verification code.");
                return;
            }

            if (data.throttled) {
                const retryAfter = data.retryAfterSeconds ?? codeTtl;
                setEmailCodeCountdown(retryAfter);
                setEmailMessage(`Code already sent. Retry in ${retryAfter}s.`);
                return;
            }

            setEmailCodeCountdown(codeTtl);
            setEmailMessage(`Verification code sent. It expires in ${codeTtl} seconds.`);
        } catch {
            setEmailError("Failed to send verification code.");
        } finally {
            setIsSendingEmailCode(false);
        }
    };

    const changeEmail = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setEmailError(null);
        setEmailMessage(null);
        setIsChangingEmail(true);

        try {
            const res = await fetch("/api/account/change-email", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    email: newEmail,
                    code: emailCode
                })
            });

            const data = (await res.json()) as { error?: string; email?: string };
            if (!res.ok) {
                setEmailError(data.error || "Failed to change email.");
                return;
            }

            setProfile((prev) => ({ ...prev, email: data.email ?? newEmail, emailVerified: new Date().toISOString() }));
            setEmailCode("");
            setEmailMessage("Email updated.");
        } catch {
            setEmailError("Failed to change email.");
        } finally {
            setIsChangingEmail(false);
        }
    };

    const logoutAllDevices = async () => {
        setSecurityError(null);
        setIsSigningOutAll(true);

        try {
            const res = await fetch("/api/account/logout-all", { method: "POST" });
            const data = (await res.json()) as { error?: string };
            if (!res.ok) {
                setSecurityError(data.error || "Failed to sign out all devices.");
                return;
            }
            await signOutUser("/login?callbackUrl=/dashboard");
        } catch {
            setSecurityError("Failed to sign out all devices.");
        } finally {
            setIsSigningOutAll(false);
        }
    };

    return (
        <div className="relative min-h-screen overflow-hidden px-4 py-6 sm:px-6 md:px-8">
            <div className="pointer-events-none absolute inset-0">
                <div className="fc-float absolute -top-20 -left-20 h-72 w-72 rounded-full bg-blue-500/20 blur-3xl" />
                <div className="fc-float absolute right-0 top-1/3 h-72 w-72 rounded-full bg-cyan-500/20 blur-3xl" style={{ animationDelay: "0.9s" }} />
            </div>

            <div className="relative mx-auto max-w-4xl space-y-6">
                <header className="fc-surface flex items-center justify-between gap-3 rounded-[var(--radius-2xl)] px-4 py-3 sm:px-5">
                    <div className="flex items-center gap-4">
                        <Link
                            href="/dashboard"
                            className="inline-flex items-center gap-2 text-sm text-slate-600 transition-colors hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100"
                        >
                            <ArrowLeft className="w-4 h-4" />
                            Back to dashboard
                        </Link>
                        <BrandLogo
                            showText={false}
                            iconClassName="w-[clamp(18px,2vw,24px)] h-[clamp(18px,2vw,24px)]"
                        />
                    </div>
                    <UserCenter signOutCallbackUrl="/" />
                </header>

                <div>
                    <h1 className="text-3xl font-semibold text-slate-900 dark:text-slate-100">User Center</h1>
                    <p className="mt-1 text-slate-500 dark:text-slate-300">
                        Manage your profile, account security, and sign-in sessions.
                    </p>
                </div>

                <section className={cardClassName}>
                    <div className="mb-4 flex items-center gap-2">
                        <User className="w-5 h-5 text-blue-600" />
                        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Profile</h2>
                    </div>

                    {isProfileLoading ? (
                        <div className="text-sm text-slate-500 dark:text-slate-300">Loading profile...</div>
                    ) : (
                        <form onSubmit={saveProfile} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium mb-1">Email</label>
                                <input
                                    value={profile.email}
                                    disabled
                                    className={disabledFieldClassName}
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium mb-1">Display name</label>
                                <input
                                    value={profile.name}
                                    onChange={(e) => setProfile((prev) => ({ ...prev, name: e.target.value }))}
                                    maxLength={80}
                                    placeholder="Your name"
                                    className={fieldClassName}
                                />
                            </div>

                            <div className="text-sm text-slate-500 dark:text-slate-300">
                                Email verification:{" "}
                                {profile.emailVerified ? (
                                    <span className="text-emerald-600 dark:text-emerald-400">Verified</span>
                                ) : (
                                    <span>Not verified</span>
                                )}
                            </div>

                            {profileError && <p className="text-sm text-red-500">{profileError}</p>}
                            {profileMessage && <p className="text-sm text-emerald-600 dark:text-emerald-400">{profileMessage}</p>}

                            <button
                                type="submit"
                                disabled={isSavingProfile}
                                className="fc-button-primary inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {isSavingProfile ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                Save profile
                            </button>
                        </form>
                    )}

                    <form onSubmit={changeEmail} className="mt-6 space-y-4 border-t border-[color:var(--border)] pt-6">
                        <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-700 dark:text-slate-200">Change email</h3>

                        <div>
                            <label className="block text-sm font-medium mb-1">New email</label>
                            <input
                                type="email"
                                value={newEmail}
                                onChange={(e) => setNewEmail(e.target.value)}
                                placeholder="new-email@company.com"
                                className={fieldClassName}
                                required
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium mb-1">Verification code</label>
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={emailCode}
                                    onChange={(e) => setEmailCode(e.target.value)}
                                    placeholder="6-digit code"
                                    maxLength={6}
                                    className={fieldClassName}
                                    required
                                />
                                <button
                                    type="button"
                                    onClick={sendEmailChangeCode}
                                    disabled={isSendingEmailCode || !newEmail.trim() || emailCodeCountdown > 0}
                                    className="fc-button-secondary min-w-20 px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                                    title="Send verification code"
                                >
                                    {isSendingEmailCode ? (
                                        <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                                    ) : emailCodeCountdown > 0 ? (
                                        <span className="tabular-nums">{emailCodeCountdown}s</span>
                                    ) : (
                                        <span className="inline-flex items-center gap-1">
                                            <Mail className="w-4 h-4" />
                                            Send
                                        </span>
                                    )}
                                </button>
                            </div>
                        </div>

                        {emailError && <p className="text-sm text-red-500">{emailError}</p>}
                        {emailMessage && <p className="text-sm text-emerald-600 dark:text-emerald-400">{emailMessage}</p>}

                        <button
                            type="submit"
                            disabled={isChangingEmail}
                            className="fc-button-primary inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {isChangingEmail ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                            Confirm email change
                        </button>
                    </form>
                </section>

                <section className={cardClassName}>
                    <div className="mb-4 flex items-center gap-2">
                        <Shield className="w-5 h-5 text-amber-600" />
                        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Security</h2>
                    </div>

                    <form onSubmit={changePassword} className="space-y-4 mb-6">
                        <div>
                            <label className="block text-sm font-medium mb-1">New password</label>
                            <div className="relative">
                                <input
                                    type={showNewPassword ? "text" : "password"}
                                    value={newPassword}
                                    onChange={(e) => setNewPassword(e.target.value)}
                                    placeholder="At least 8 characters"
                                    minLength={8}
                                    required
                                    className={`${fieldClassName} pr-11`}
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
                        <div>
                            <label className="block text-sm font-medium mb-1">Confirm new password</label>
                            <div className="relative">
                                <input
                                    type={showConfirmNewPassword ? "text" : "password"}
                                    value={confirmNewPassword}
                                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                                    placeholder="Re-enter new password"
                                    minLength={8}
                                    required
                                    className={`${fieldClassName} pr-11`}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowConfirmNewPassword((prev) => !prev)}
                                    className="absolute inset-y-0 right-0 px-3 text-slate-500 hover:text-slate-700 dark:text-slate-300 dark:hover:text-slate-100"
                                    aria-label={showConfirmNewPassword ? "Hide password" : "Show password"}
                                >
                                    {showConfirmNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                </button>
                            </div>
                        </div>

                        {passwordError && <p className="text-sm text-red-500">{passwordError}</p>}
                        {passwordMessage && <p className="text-sm text-emerald-600 dark:text-emerald-400">{passwordMessage}</p>}

                        <button
                            type="submit"
                            disabled={isChangingPassword}
                            className="fc-button-primary inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {isChangingPassword ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
                            Change password
                        </button>
                    </form>

                    <div className="border-t border-[color:var(--border)] pt-4">
                        <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">
                            Force all sessions to log in again on every device.
                        </p>
                        {securityError && <p className="text-sm text-red-500 mb-2">{securityError}</p>}
                        <button
                            type="button"
                            onClick={logoutAllDevices}
                            disabled={isSigningOutAll}
                            className="inline-flex items-center gap-2 rounded-xl border border-red-300 px-4 py-2.5 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-700/50 dark:text-red-300 dark:hover:bg-red-900/20"
                        >
                            {isSigningOutAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />}
                            Sign out all devices
                        </button>
                    </div>
                </section>
            </div>
        </div>
    );
}
