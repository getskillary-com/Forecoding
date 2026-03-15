"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Home, LayoutDashboard, LogIn, LogOut, Settings, Shield, UserPlus } from "lucide-react";
import { useAuth } from "@/lib/auth-client";
import { getCachedAdminStatus, loadAdminStatus } from "@/lib/admin-status-client";

type UserCenterProps = {
    className?: string;
    signOutCallbackUrl?: string;
};

function getInitials(value: string) {
    const parts = value.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "U";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

export function UserCenter({ className, signOutCallbackUrl = "/" }: UserCenterProps) {
    const { user, loading, signOutUser } = useAuth();
    const [isOpen, setIsOpen] = useState(false);
    const [isAdmin, setIsAdmin] = useState(() => getCachedAdminStatus() ?? false);
    const rootRef = useRef<HTMLDivElement>(null);

    const displayName = user?.displayName || user?.email || "User";
    const displayEmail = user?.email ?? "";
    const initials = useMemo(() => getInitials(displayName), [displayName]);
    const isAuthed = !loading && Boolean(user);

    useEffect(() => {
        const handlePointerDown = (event: MouseEvent) => {
            if (!rootRef.current) return;
            if (!rootRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                setIsOpen(false);
            }
        };

        document.addEventListener("mousedown", handlePointerDown);
        document.addEventListener("keydown", handleKeyDown);
        return () => {
            document.removeEventListener("mousedown", handlePointerDown);
            document.removeEventListener("keydown", handleKeyDown);
        };
    }, []);

    useEffect(() => {
        let cancelled = false;

        if (!isAuthed) {
            return () => {
                cancelled = true;
            };
        }

        if (getCachedAdminStatus() !== null) {
            return () => {
                cancelled = true;
            };
        }

        const resolveAdminStatus = async () => {
            const nextIsAdmin = await loadAdminStatus();
            if (!cancelled) {
                setIsAdmin(nextIsAdmin);
            }
        };

        void resolveAdminStatus();
        return () => {
            cancelled = true;
        };
    }, [isAuthed]);

    return (
        <div ref={rootRef} className={`relative ${className ?? ""}`}>
            <button
                type="button"
                onClick={() => setIsOpen((prev) => !prev)}
                className="flex items-center gap-2 rounded-full border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/80 px-2.5 py-1.5 text-sm shadow-sm hover:bg-white dark:hover:bg-gray-900 transition-colors"
                aria-haspopup="menu"
                aria-expanded={isOpen}
            >
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white">
                    {initials}
                </span>
                <span className="hidden sm:inline font-medium text-gray-800 dark:text-gray-200">User Center</span>
                <ChevronDown className={`h-4 w-4 text-gray-500 transition-transform ${isOpen ? "rotate-180" : ""}`} />
            </button>

            {isOpen && (
                <div
                    className="absolute right-0 top-full mt-2 w-64 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl z-[80] overflow-hidden"
                    role="menu"
                >
                    <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800">
                        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{displayName}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{displayEmail || "Not signed in"}</p>
                    </div>

                    {isAuthed ? (
                        <div className="p-1.5 space-y-1">
                            <Link
                                href="/dashboard"
                                className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                                onClick={() => setIsOpen(false)}
                            >
                                <LayoutDashboard className="h-4 w-4" />
                                Dashboard
                            </Link>
                            <Link
                                href="/account"
                                className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                                onClick={() => setIsOpen(false)}
                            >
                                <Settings className="h-4 w-4" />
                                Account
                            </Link>
                            {isAdmin && (
                                <Link
                                    href="/admin"
                                    className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                                    onClick={() => setIsOpen(false)}
                                >
                                    <Shield className="h-4 w-4" />
                                    Admin
                                </Link>
                            )}
                            <Link
                                href="/"
                                className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                                onClick={() => setIsOpen(false)}
                            >
                                <Home className="h-4 w-4" />
                                Home
                            </Link>
                            <button
                                type="button"
                                className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                                onClick={() => {
                                    setIsOpen(false);
                                    void signOutUser(signOutCallbackUrl);
                                }}
                            >
                                <LogOut className="h-4 w-4" />
                                Sign out
                            </button>
                        </div>
                    ) : (
                        <div className="p-1.5 space-y-1">
                            <Link
                                href="/login?callbackUrl=/dashboard"
                                className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                                onClick={() => setIsOpen(false)}
                            >
                                <LogIn className="h-4 w-4" />
                                Sign in
                            </Link>
                            <Link
                                href="/register"
                                className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                                onClick={() => setIsOpen(false)}
                            >
                                <UserPlus className="h-4 w-4" />
                                Create account
                            </Link>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
