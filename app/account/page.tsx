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
        <div className="min-h-screen bg-gray-50 dark:bg-gray-950 p-6 md:p-8">
            <div className="max-w-4xl mx-auto space-y-6">
                <header className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-4">
                        <Link
                            href="/dashboard"
                            className="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors"
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
                    <h1 className="text-3xl font-bold text-gray-900 dark:text-white">User Center</h1>
                    <p className="text-gray-500 dark:text-gray-400 mt-1">
                        Manage your profile, account security, and sign-in sessions.
                    </p>
                </div>

                <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-6">
                    <div className="flex items-center gap-2 mb-4">
                        <User className="w-5 h-5 text-blue-600" />
                        <h2 className="text-lg font-semibold">Profile</h2>
                    </div>

                    {isProfileLoading ? (
                        <div className="text-sm text-gray-500">Loading profile...</div>
                    ) : (
                        <form onSubmit={saveProfile} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium mb-1">Email</label>
                                <input
                                    value={profile.email}
                                    disabled
                                    className="w-full px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 text-gray-500"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium mb-1">Display name</label>
                                <input
                                    value={profile.name}
                                    onChange={(e) => setProfile((prev) => ({ ...prev, name: e.target.value }))}
                                    maxLength={80}
                                    placeholder="Your name"
                                    className="w-full px-4 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                                />
                            </div>

                            <div className="text-sm text-gray-500 dark:text-gray-400">
                                Email verification:{" "}
                                {profile.emailVerified ? (
                                    <span className="text-green-600 dark:text-green-400">Verified</span>
                                ) : (
                                    <span>Not verified</span>
                                )}
                            </div>

                            {profileError && <p className="text-sm text-red-500">{profileError}</p>}
                            {profileMessage && <p className="text-sm text-green-600 dark:text-green-400">{profileMessage}</p>}

                            <button
                                type="submit"
                                disabled={isSavingProfile}
                                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold disabled:opacity-60"
                            >
                                {isSavingProfile ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                Save profile
                            </button>
                        </form>
                    )}

                    <form onSubmit={changeEmail} className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-800 space-y-4">
                        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Change email</h3>

                        <div>
                            <label className="block text-sm font-medium mb-1">New email</label>
                            <input
                                type="email"
                                value={newEmail}
                                onChange={(e) => setNewEmail(e.target.value)}
                                placeholder="new-email@company.com"
                                className="w-full px-4 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
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
                                    className="w-full px-4 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                                    required
                                />
                                <button
                                    type="button"
                                    onClick={sendEmailChangeCode}
                                    disabled={isSendingEmailCode || !newEmail.trim() || emailCodeCountdown > 0}
                                    className="min-w-20 px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 text-sm disabled:opacity-60"
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
                        {emailMessage && <p className="text-sm text-green-600 dark:text-green-400">{emailMessage}</p>}

                        <button
                            type="submit"
                            disabled={isChangingEmail}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gray-900 hover:bg-black text-white font-semibold disabled:opacity-60"
                        >
                            {isChangingEmail ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                            Confirm email change
                        </button>
                    </form>
                </section>

                <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-6">
                    <div className="flex items-center gap-2 mb-4">
                        <Shield className="w-5 h-5 text-amber-600" />
                        <h2 className="text-lg font-semibold">Security</h2>
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
                                    className="w-full px-4 py-2 pr-11 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
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
                                    className="w-full px-4 py-2 pr-11 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowConfirmNewPassword((prev) => !prev)}
                                    className="absolute inset-y-0 right-0 px-3 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                                    aria-label={showConfirmNewPassword ? "Hide password" : "Show password"}
                                >
                                    {showConfirmNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                </button>
                            </div>
                        </div>

                        {passwordError && <p className="text-sm text-red-500">{passwordError}</p>}
                        {passwordMessage && <p className="text-sm text-green-600 dark:text-green-400">{passwordMessage}</p>}

                        <button
                            type="submit"
                            disabled={isChangingPassword}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gray-900 hover:bg-black text-white font-semibold disabled:opacity-60"
                        >
                            {isChangingPassword ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
                            Change password
                        </button>
                    </form>

                    <div className="border-t border-gray-200 dark:border-gray-800 pt-4">
                        <p className="text-sm text-gray-600 dark:text-gray-300 mb-3">
                            Force all sessions to log in again on every device.
                        </p>
                        {securityError && <p className="text-sm text-red-500 mb-2">{securityError}</p>}
                        <button
                            type="button"
                            onClick={logoutAllDevices}
                            disabled={isSigningOutAll}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-red-300 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 font-semibold disabled:opacity-60"
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
