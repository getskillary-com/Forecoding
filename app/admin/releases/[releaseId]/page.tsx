import { notFound } from "next/navigation";
import { AdminDetailSection, AdminDetailShell, formatAdminTimestamp } from "@/components/AdminDetailShell";
import { resolveAdminRole } from "@/lib/admin";
import { getWorkspaceReleaseTagById } from "@/lib/data/workspaces";
import { getServerSessionIdentity } from "@/lib/server-auth";

function renderItems(items: string[], prefix: "+" | "-") {
    if (items.length === 0) {
        return <p className="mt-2 text-xs text-slate-500 dark:text-slate-300">None recorded.</p>;
    }

    return items.slice(0, 12).map((item) => (
        <p key={`${prefix}-${item}`} className="mt-1 text-xs text-slate-600 dark:text-slate-300">
            {prefix} {item}
        </p>
    ));
}

export default async function AdminReleaseDetailPage({
    params
}: {
    params: Promise<{ releaseId: string }>;
}) {
    const { releaseId } = await params;
    const [user, release] = await Promise.all([
        getServerSessionIdentity(),
        getWorkspaceReleaseTagById(releaseId)
    ]);

    if (!release) {
        notFound();
    }

    const email = user?.email || "admin";
    const role = resolveAdminRole({ email: user?.email });
    const focusedHref = `/admin?release=${encodeURIComponent(release.id)}`;

    return (
        <AdminDetailShell
            eyebrow="Admin Detail"
            title={`Release ${release.label}`}
            description="Snapshot-level release view showing rollback readiness, current workspace drift, and the exact impact a restore would apply."
            email={email}
            role={role}
            actions={[
                { href: focusedHref, label: "Open rollback review", tone: "primary" },
                { href: "/admin", label: "Admin home", tone: "secondary" }
            ]}
        >
            <AdminDetailSection
                title="Overview"
                description="Release identity, snapshot scope, and current workspace position."
            >
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <article className="rounded-2xl border border-[color:var(--border)] bg-white/80 p-4 dark:bg-slate-900/60">
                        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-300">Release</p>
                        <p className="mt-3 text-sm font-semibold text-slate-900 dark:text-slate-100">{release.label}</p>
                        <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">Workspace: {release.ownerUserId}</p>
                        <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">Created: {formatAdminTimestamp(release.createdAt)}</p>
                    </article>
                    <article className="rounded-2xl border border-[color:var(--border)] bg-white/80 p-4 dark:bg-slate-900/60">
                        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-300">Snapshot</p>
                        <p className="mt-3 text-sm font-semibold text-slate-900 dark:text-slate-100">{release.snapshotId}</p>
                        <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">Projects: {release.snapshotProjectCount}</p>
                        <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">Active versions: {release.snapshotActiveVersionCount}</p>
                    </article>
                    <article className="rounded-2xl border border-[color:var(--border)] bg-white/80 p-4 dark:bg-slate-900/60">
                        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-300">Rollback</p>
                        <p className="mt-3 text-sm font-semibold text-slate-900 dark:text-slate-100">
                            {release.rollbackReady ? "Ready" : "Blocked"}
                        </p>
                        <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">Current workspace revision: r{release.latestWorkspaceRevision}</p>
                        {release.rollbackReason ? (
                            <p className="mt-2 text-xs text-amber-600 dark:text-amber-300">{release.rollbackReason}</p>
                        ) : null}
                    </article>
                    <article className="rounded-2xl border border-[color:var(--border)] bg-white/80 p-4 dark:bg-slate-900/60">
                        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-300">Snapshot Summary</p>
                        <p className="mt-3 text-sm text-slate-700 dark:text-slate-200">{release.snapshotSummary || "No summary stored."}</p>
                        {release.note ? (
                            <p className="mt-2 text-xs text-slate-500 dark:text-slate-300">{release.note}</p>
                        ) : null}
                    </article>
                </div>
            </AdminDetailSection>

            <AdminDetailSection
                title="Rollback Impact"
                description="Comparison between the stored release snapshot and the current workspace state."
            >
                <div className="space-y-4">
                    <article className="rounded-2xl border border-[color:var(--border)] bg-white/80 p-4 dark:bg-slate-900/60">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                                    {release.rollbackImpact.sameAsCurrent
                                        ? "Snapshot already matches the current workspace"
                                        : "Rollback would change the current workspace"}
                                </p>
                                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                                    Current workspace: {release.rollbackImpact.currentProjectCount} projects and {release.rollbackImpact.currentActiveVersionCount} active versions
                                </p>
                            </div>
                            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${release.rollbackImpact.sameAsCurrent ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"}`}>
                                {release.rollbackImpact.sameAsCurrent ? "No net diff" : "Diff detected"}
                            </span>
                        </div>
                    </article>

                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                        <article className="rounded-2xl border border-[color:var(--border)] bg-white/80 p-4 dark:bg-slate-900/60">
                            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-300">Projects removed by rollback</p>
                            <p className="mt-3 text-2xl font-semibold text-slate-900 dark:text-slate-100">
                                {release.rollbackImpact.projectsAddedSinceRelease.length}
                            </p>
                        </article>
                        <article className="rounded-2xl border border-[color:var(--border)] bg-white/80 p-4 dark:bg-slate-900/60">
                            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-300">Projects restored by rollback</p>
                            <p className="mt-3 text-2xl font-semibold text-slate-900 dark:text-slate-100">
                                {release.rollbackImpact.projectsRemovedSinceRelease.length}
                            </p>
                        </article>
                        <article className="rounded-2xl border border-[color:var(--border)] bg-white/80 p-4 dark:bg-slate-900/60">
                            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-300">Active versions removed</p>
                            <p className="mt-3 text-2xl font-semibold text-slate-900 dark:text-slate-100">
                                {release.rollbackImpact.activeVersionsAddedSinceRelease.length}
                            </p>
                        </article>
                        <article className="rounded-2xl border border-[color:var(--border)] bg-white/80 p-4 dark:bg-slate-900/60">
                            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-300">Active versions restored</p>
                            <p className="mt-3 text-2xl font-semibold text-slate-900 dark:text-slate-100">
                                {release.rollbackImpact.activeVersionsRemovedSinceRelease.length}
                            </p>
                        </article>
                    </div>
                </div>
            </AdminDetailSection>

            <div className="grid gap-6 xl:grid-cols-2">
                <AdminDetailSection
                    title="Project Diff"
                    description="Project IDs that diverged after the release snapshot was stored."
                >
                    <div className="grid gap-4 sm:grid-cols-2">
                        <article className="rounded-2xl border border-[color:var(--border)] bg-white/80 p-4 dark:bg-slate-900/60">
                            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Would be removed</p>
                            {renderItems(release.rollbackImpact.projectsAddedSinceRelease, "-")}
                        </article>
                        <article className="rounded-2xl border border-[color:var(--border)] bg-white/80 p-4 dark:bg-slate-900/60">
                            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Would be restored</p>
                            {renderItems(release.rollbackImpact.projectsRemovedSinceRelease, "+")}
                        </article>
                    </div>
                </AdminDetailSection>

                <AdminDetailSection
                    title="Active Version Diff"
                    description="Active version IDs that would change if the snapshot is restored."
                >
                    <div className="grid gap-4 sm:grid-cols-2">
                        <article className="rounded-2xl border border-[color:var(--border)] bg-white/80 p-4 dark:bg-slate-900/60">
                            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Would be removed</p>
                            {renderItems(release.rollbackImpact.activeVersionsAddedSinceRelease, "-")}
                        </article>
                        <article className="rounded-2xl border border-[color:var(--border)] bg-white/80 p-4 dark:bg-slate-900/60">
                            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Would be restored</p>
                            {renderItems(release.rollbackImpact.activeVersionsRemovedSinceRelease, "+")}
                        </article>
                    </div>
                </AdminDetailSection>
            </div>
        </AdminDetailShell>
    );
}
