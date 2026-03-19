import Link from "next/link";
import type { ReactNode } from "react";
import type { AdminRole } from "@/lib/admin";

type ActionLink = {
    href: string;
    label: string;
    tone?: "primary" | "secondary";
};

type AdminDetailShellProps = {
    eyebrow: string;
    title: string;
    description: string;
    email: string;
    role: AdminRole;
    actions: ActionLink[];
    children: ReactNode;
};

type AdminDetailSectionProps = {
    title: string;
    description?: string;
    children: ReactNode;
};

function roleLabel(role: AdminRole) {
    switch (role) {
        case "admin":
            return "Admin";
        case "operator":
            return "Operator";
        case "viewer":
            return "Viewer";
        default:
            return "No access";
    }
}

export function formatAdminTimestamp(value?: number | null) {
    if (!value) return "n/a";
    return new Date(value).toLocaleString();
}

export function AdminDetailShell({
    eyebrow,
    title,
    description,
    email,
    role,
    actions,
    children
}: AdminDetailShellProps) {
    return (
        <main className="relative min-h-screen overflow-hidden px-4 py-8 sm:px-8">
            <div className="pointer-events-none absolute inset-0">
                <div className="fc-float absolute -top-20 -left-20 h-72 w-72 rounded-full bg-blue-500/20 blur-3xl" />
                <div
                    className="fc-float absolute right-0 top-1/3 h-72 w-72 rounded-full bg-cyan-500/20 blur-3xl"
                    style={{ animationDelay: "1.1s" }}
                />
            </div>

            <div className="relative mx-auto max-w-5xl space-y-6">
                <header className="fc-surface-strong rounded-[var(--radius-2xl)] p-6">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-300">
                                {eyebrow}
                            </p>
                            <h1 className="mt-1 text-3xl font-semibold text-slate-900 dark:text-slate-100">
                                {title}
                            </h1>
                            <p className="mt-2 max-w-3xl text-sm text-slate-600 dark:text-slate-300">
                                {description}
                            </p>
                            <p className="mt-3 text-xs text-slate-500 dark:text-slate-300">
                                Current account: {email} | Active role: {roleLabel(role)}
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-3">
                            {actions.map((action) => (
                                <Link
                                    key={`${action.href}-${action.label}`}
                                    href={action.href}
                                    className={`${action.tone === "primary" ? "fc-button-primary" : "fc-button-secondary"} px-4 py-2.5 text-sm font-semibold`}
                                >
                                    {action.label}
                                </Link>
                            ))}
                        </div>
                    </div>
                </header>

                {children}
            </div>
        </main>
    );
}

export function AdminDetailSection({
    title,
    description,
    children
}: AdminDetailSectionProps) {
    return (
        <section className="fc-surface-strong rounded-[var(--radius-2xl)] p-6">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
                    {description ? (
                        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{description}</p>
                    ) : null}
                </div>
            </div>
            <div className="mt-4">{children}</div>
        </section>
    );
}
