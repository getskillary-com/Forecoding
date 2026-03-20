import { notFound } from "next/navigation";
import { AdminDetailSection, AdminDetailShell, formatAdminTimestamp } from "@/components/AdminDetailShell";
import { resolveAdminRole } from "@/lib/admin";
import {
    diffWorkspaceRevisionsByUserId,
    getWorkspaceRevisionOverviewByUserId,
    type WorkspaceRevisionTimelineItem
} from "@/lib/data/workspaces";
import { getServerSessionIdentity } from "@/lib/server-auth";

function renderList(items: string[], prefix: "+" | "-" | "~") {
    if (items.length === 0) {
        return <p className="mt-2 text-xs text-slate-500 dark:text-slate-300">None recorded.</p>;
    }

    return items.slice(0, 12).map((item) => (
        <p key={`${prefix}-${item}`} className="mt-1 text-xs text-slate-600 dark:text-slate-300">
            {prefix} {item}
        </p>
    ));
}

function pickDefaultTarget(revisions: WorkspaceRevisionTimelineItem[]) {
    return revisions[0]?.revisionId || "";
}

function pickDefaultSource(revisions: WorkspaceRevisionTimelineItem[], targetRevisionId: string) {
    return revisions.find((item) => item.revisionId !== targetRevisionId)?.revisionId || "";
}

function buildWorkspaceDiffHref(ownerUserId: string, fromRevisionId: string, toRevisionId: string) {
    const params = new URLSearchParams();
    if (fromRevisionId) {
        params.set("from", fromRevisionId);
    }
    if (toRevisionId) {
        params.set("to", toRevisionId);
    }
    const query = params.toString();
    return query
        ? `/admin/workspaces/${encodeURIComponent(ownerUserId)}?${query}`
        : `/admin/workspaces/${encodeURIComponent(ownerUserId)}`;
}

function diffTotalCount(diff: { added: string[]; removed: string[]; changed: string[] }) {
    return diff.added.length + diff.removed.length + diff.changed.length;
}

export default async function AdminWorkspaceDetailPage({
    params,
    searchParams
}: {
    params: Promise<{ ownerUserId: string }>;
    searchParams: Promise<{ from?: string; to?: string }>;
}) {
    const resolvedParams = await params;
    const resolvedSearchParams = await searchParams;
    const ownerUserId = resolvedParams.ownerUserId.trim();
    if (!ownerUserId) {
        notFound();
    }

    const [user, overview] = await Promise.all([
        getServerSessionIdentity(),
        getWorkspaceRevisionOverviewByUserId(ownerUserId)
    ]);

    if (!overview) {
        notFound();
    }

    const email = user?.email || "admin";
    const role = resolveAdminRole({ email: user?.email });
    const selectedTargetRevisionId = (resolvedSearchParams.to || "").trim() || pickDefaultTarget(overview.revisions);
    const selectedSourceRevisionId = (resolvedSearchParams.from || "").trim() || pickDefaultSource(overview.revisions, selectedTargetRevisionId);
    const resetDiffHref = buildWorkspaceDiffHref(
        ownerUserId,
        pickDefaultSource(overview.revisions, pickDefaultTarget(overview.revisions)),
        pickDefaultTarget(overview.revisions)
    );
    const diffResult = await diffWorkspaceRevisionsByUserId({
        userId: ownerUserId,
        fromRevisionId: selectedSourceRevisionId,
        toRevisionId: selectedTargetRevisionId
    });

    return (
        <AdminDetailShell
            eyebrow="Admin Detail"
            title={`Workspace ${ownerUserId}`}
            description="Workspace snapshot governance view for revision timelines, diff impact, and rollback-safe change analysis."
            email={email}
            role={role}
            actions={[
                { href: resetDiffHref, label: "Reset diff", tone: "secondary" },
                { href: "/admin", label: "Back to console", tone: "primary" }
            ]}
        >
            <AdminDetailSection
                title="Overview"
                description="Current workspace envelope state and revision inventory."
            >
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <article className="rounded-2xl border border-[color:var(--border)] bg-white/80 p-4 dark:bg-slate-900/60">
                        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-300">Workspace</p>
                        <p className="mt-3 text-sm font-semibold text-slate-900 dark:text-slate-100">{overview.ownerUserId}</p>
                        <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">Tenant: {overview.tenantId || "unassigned"}</p>
                    </article>
                    <article className="rounded-2xl border border-[color:var(--border)] bg-white/80 p-4 dark:bg-slate-900/60">
                        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-300">Current Revision</p>
                        <p className="mt-3 text-sm font-semibold text-slate-900 dark:text-slate-100">r{overview.revision}</p>
                        <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">Projects: {overview.projectCount}</p>
                    </article>
                    <article className="rounded-2xl border border-[color:var(--border)] bg-white/80 p-4 dark:bg-slate-900/60">
                        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-300">Revision History</p>
                        <p className="mt-3 text-sm font-semibold text-slate-900 dark:text-slate-100">{overview.revisions.length} revisions</p>
                        <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                            Payload snapshots: {overview.revisions.filter((item) => item.hasSnapshotPayload).length}
                        </p>
                    </article>
                    <article className="rounded-2xl border border-[color:var(--border)] bg-white/80 p-4 dark:bg-slate-900/60">
                        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-300">Updated</p>
                        <p className="mt-3 text-sm font-semibold text-slate-900 dark:text-slate-100">{formatAdminTimestamp(overview.updatedAt)}</p>
                        <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">Diff baseline ready</p>
                    </article>
                </div>
            </AdminDetailSection>

            <AdminDetailSection
                title="Revision Timeline"
                description="Select source and target revisions to recompute change impact."
            >
                <div className="space-y-3">
                    {overview.revisions.map((revision) => (
                        <article
                            key={revision.revisionId}
                            className="rounded-2xl border border-[color:var(--border)] bg-white/80 p-4 text-sm dark:bg-slate-900/60"
                        >
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                    <p className="font-semibold text-slate-900 dark:text-slate-100">
                                        r{revision.revisionNumber} | {revision.kind}
                                    </p>
                                    <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{revision.summary}</p>
                                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-300">
                                        Snapshot {revision.snapshotId} | {formatAdminTimestamp(revision.createdAt)}
                                    </p>
                                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-300">
                                        Projects {revision.projectCount} | Active versions {revision.activeVersionCount} | Payload {revision.hasSnapshotPayload ? "yes" : "no"}
                                    </p>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    <a
                                        href={buildWorkspaceDiffHref(ownerUserId, selectedSourceRevisionId, revision.revisionId)}
                                        className={`rounded-xl px-3 py-2 text-xs font-semibold ${selectedTargetRevisionId === revision.revisionId ? "bg-blue-600 text-white" : "fc-button-secondary"}`}
                                    >
                                        Set as target
                                    </a>
                                    <a
                                        href={buildWorkspaceDiffHref(ownerUserId, revision.revisionId, selectedTargetRevisionId)}
                                        className={`rounded-xl px-3 py-2 text-xs font-semibold ${selectedSourceRevisionId === revision.revisionId ? "bg-slate-700 text-white dark:bg-slate-200 dark:text-slate-900" : "fc-button-secondary"}`}
                                    >
                                        Set as source
                                    </a>
                                </div>
                            </div>
                        </article>
                    ))}
                </div>
            </AdminDetailSection>

            <AdminDetailSection
                title="Change Impact"
                description="Computed impact between selected source and target workspace revisions."
            >
                {!diffResult.ok ? (
                    <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
                        <p className="font-semibold">{diffResult.code}</p>
                        <p className="mt-1">{diffResult.message}</p>
                        {diffResult.availableRevisionIds?.length ? (
                            <p className="mt-2 text-xs">
                                Available revisions: {diffResult.availableRevisionIds.join(", ")}
                            </p>
                        ) : null}
                    </div>
                ) : (
                    <div className="space-y-4">
                        <article className="rounded-2xl border border-[color:var(--border)] bg-white/80 p-4 dark:bg-slate-900/60">
                            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                                Source r{diffResult.diff.source.revisionNumber}{" -> "}Target r{diffResult.diff.target.revisionNumber}
                            </p>
                            <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                                {diffResult.diff.source.revisionId}{" -> "}{diffResult.diff.target.revisionId}
                            </p>
                            <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                                Source snapshot {diffResult.diff.source.snapshotId} | Target snapshot {diffResult.diff.target.snapshotId}
                            </p>
                        </article>

                        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                            <article className="rounded-2xl border border-[color:var(--border)] bg-white/80 p-4 dark:bg-slate-900/60">
                                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-300">Project IDs</p>
                                <p className="mt-2 text-sm text-slate-700 dark:text-slate-200">
                                    +{diffResult.diff.impact.projectIds.added.length} / -{diffResult.diff.impact.projectIds.removed.length} / ~{diffResult.diff.impact.projectIds.changed.length}
                                </p>
                            </article>
                            <article className="rounded-2xl border border-[color:var(--border)] bg-white/80 p-4 dark:bg-slate-900/60">
                                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-300">Active Versions</p>
                                <p className="mt-2 text-sm text-slate-700 dark:text-slate-200">
                                    +{diffResult.diff.impact.activeVersionIds.added.length} / -{diffResult.diff.impact.activeVersionIds.removed.length}
                                </p>
                            </article>
                            <article className="rounded-2xl border border-[color:var(--border)] bg-white/80 p-4 dark:bg-slate-900/60">
                                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-300">Module/Route/Contract</p>
                                <p className="mt-2 text-sm text-slate-700 dark:text-slate-200">
                                    {diffTotalCount(diffResult.diff.impact.modules)} / {diffTotalCount(diffResult.diff.impact.routes)} / {diffTotalCount(diffResult.diff.impact.contracts)}
                                </p>
                            </article>
                            <article className="rounded-2xl border border-[color:var(--border)] bg-white/80 p-4 dark:bg-slate-900/60">
                                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-300">Billing Events</p>
                                <p className="mt-2 text-sm text-slate-700 dark:text-slate-200">
                                    {diffResult.diff.impact.billing.sourceEventCount}{" -> "}{diffResult.diff.impact.billing.targetEventCount}
                                </p>
                            </article>
                        </div>

                        <div className="grid gap-4 xl:grid-cols-2">
                            <article className="rounded-2xl border border-[color:var(--border)] bg-white/80 p-4 dark:bg-slate-900/60">
                                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Modules</p>
                                {renderList(diffResult.diff.impact.modules.added, "+")}
                                {renderList(diffResult.diff.impact.modules.removed, "-")}
                                {renderList(diffResult.diff.impact.modules.changed, "~")}
                            </article>
                            <article className="rounded-2xl border border-[color:var(--border)] bg-white/80 p-4 dark:bg-slate-900/60">
                                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Routes</p>
                                {renderList(diffResult.diff.impact.routes.added, "+")}
                                {renderList(diffResult.diff.impact.routes.removed, "-")}
                                {renderList(diffResult.diff.impact.routes.changed, "~")}
                            </article>
                            <article className="rounded-2xl border border-[color:var(--border)] bg-white/80 p-4 dark:bg-slate-900/60">
                                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Contracts</p>
                                {renderList(diffResult.diff.impact.contracts.added, "+")}
                                {renderList(diffResult.diff.impact.contracts.removed, "-")}
                                {renderList(diffResult.diff.impact.contracts.changed, "~")}
                            </article>
                            <article className="rounded-2xl border border-[color:var(--border)] bg-white/80 p-4 dark:bg-slate-900/60">
                                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Tests</p>
                                {renderList(diffResult.diff.impact.tests.added, "+")}
                                {renderList(diffResult.diff.impact.tests.removed, "-")}
                                {renderList(diffResult.diff.impact.tests.changed, "~")}
                            </article>
                        </div>

                        <div className="grid gap-4 xl:grid-cols-2">
                            <article className="rounded-2xl border border-[color:var(--border)] bg-white/80 p-4 dark:bg-slate-900/60">
                                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Requirements</p>
                                <p className="mt-1 text-xs text-slate-500 dark:text-slate-300">Status changed: {diffResult.diff.impact.requirements.statusChanged.length}</p>
                                {renderList(diffResult.diff.impact.requirements.statusChanged, "~")}
                            </article>
                            <article className="rounded-2xl border border-[color:var(--border)] bg-white/80 p-4 dark:bg-slate-900/60">
                                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Task Definitions</p>
                                <p className="mt-1 text-xs text-slate-500 dark:text-slate-300">Status changed: {diffResult.diff.impact.taskDefinitions.statusChanged.length}</p>
                                {renderList(diffResult.diff.impact.taskDefinitions.statusChanged, "~")}
                            </article>
                            <article className="rounded-2xl border border-[color:var(--border)] bg-white/80 p-4 dark:bg-slate-900/60">
                                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Task Run Delta</p>
                                <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                                    Count {diffResult.diff.impact.taskRuns.sourceCount}{" -> "}{diffResult.diff.impact.taskRuns.targetCount}
                                </p>
                                <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                                    queued {diffResult.diff.impact.taskRuns.statusDelta.queued >= 0 ? "+" : ""}{diffResult.diff.impact.taskRuns.statusDelta.queued},
                                    running {diffResult.diff.impact.taskRuns.statusDelta.running >= 0 ? "+" : ""}{diffResult.diff.impact.taskRuns.statusDelta.running},
                                    succeeded {diffResult.diff.impact.taskRuns.statusDelta.succeeded >= 0 ? "+" : ""}{diffResult.diff.impact.taskRuns.statusDelta.succeeded},
                                    failed {diffResult.diff.impact.taskRuns.statusDelta.failed >= 0 ? "+" : ""}{diffResult.diff.impact.taskRuns.statusDelta.failed},
                                    blocked {diffResult.diff.impact.taskRuns.statusDelta.blocked >= 0 ? "+" : ""}{diffResult.diff.impact.taskRuns.statusDelta.blocked}
                                </p>
                            </article>
                            <article className="rounded-2xl border border-[color:var(--border)] bg-white/80 p-4 dark:bg-slate-900/60">
                                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Billing Impact</p>
                                <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                                    Payment status changed: {diffResult.diff.impact.billing.paymentStatusChanged.length}
                                </p>
                                <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                                    Events +{diffResult.diff.impact.billing.addedEvents.length} / -{diffResult.diff.impact.billing.removedEvents.length}
                                </p>
                                {renderList(
                                    diffResult.diff.impact.billing.paymentStatusChanged.map((item) => (
                                        `${item.projectId}: ${item.sourceStatus} -> ${item.targetStatus}`
                                    )),
                                    "~"
                                )}
                            </article>
                        </div>
                    </div>
                )}
            </AdminDetailSection>
        </AdminDetailShell>
    );
}
