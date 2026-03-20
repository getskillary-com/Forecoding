import { notFound } from "next/navigation";
import { AdminDetailSection, AdminDetailShell, formatAdminTimestamp } from "@/components/AdminDetailShell";
import { resolveAdminRole } from "@/lib/admin";
import { getGenerationJobById } from "@/lib/data/generation-jobs";
import { getServerSessionIdentity } from "@/lib/server-auth";

function statusTone(status: "queued" | "running" | "succeeded" | "failed") {
    if (status === "succeeded") {
        return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300";
    }
    if (status === "failed") {
        return "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300";
    }
    return "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300";
}

export default async function AdminJobDetailPage({
    params
}: {
    params: Promise<{ jobId: string }>;
}) {
    const { jobId } = await params;
    const [user, job] = await Promise.all([
        getServerSessionIdentity(),
        getGenerationJobById(jobId)
    ]);

    if (!job) {
        notFound();
    }

    const email = user?.email || "admin";
    const role = resolveAdminRole({ email: user?.email });
    const focusedHref = `/admin?job=${encodeURIComponent(job.id)}`;

    return (
        <AdminDetailShell
            eyebrow="Admin Detail"
            title={`Generation Job ${job.id}`}
            description="Standalone view for a generation run, including lifecycle, preflight outcomes, remediation hints, and artifact previews."
            email={email}
            role={role}
            actions={[
                { href: focusedHref, label: "Open focused console", tone: "primary" },
                { href: "/admin", label: "Admin home", tone: "secondary" }
            ]}
        >
            <AdminDetailSection
                title="Overview"
                description="High-signal context for the selected generation run."
            >
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <article className="rounded-2xl border border-[color:var(--border)] bg-white/80 p-4 dark:bg-slate-900/60">
                        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-300">Status</p>
                        <div className="mt-3 flex items-center gap-3">
                            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone(job.status)}`}>
                                {job.status}
                            </span>
                            <span className="text-xs text-slate-500 dark:text-slate-300">{job.outputMode}</span>
                        </div>
                        <p className="mt-3 text-xs text-slate-600 dark:text-slate-300">Template: {job.templateKind || "auto"}</p>
                        <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">Release intent: {job.releaseIntent || "not set"}</p>
                    </article>
                    <article className="rounded-2xl border border-[color:var(--border)] bg-white/80 p-4 dark:bg-slate-900/60">
                        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-300">Target</p>
                        <p className="mt-3 text-sm font-semibold text-slate-900 dark:text-slate-100">{job.projectId || "unknown project"}</p>
                        <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">Version: {job.versionId || "unknown version"}</p>
                        <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">Tenant: {job.tenantId || "unassigned"} ({job.tenantStatus || "unknown"})</p>
                        <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">Workspace snapshot: {job.workspaceSnapshotId || "n/a"}</p>
                    </article>
                    <article className="rounded-2xl border border-[color:var(--border)] bg-white/80 p-4 dark:bg-slate-900/60">
                        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-300">Lifecycle</p>
                        <p className="mt-3 text-xs text-slate-600 dark:text-slate-300">Created: {formatAdminTimestamp(job.createdAt)}</p>
                        <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">Updated: {formatAdminTimestamp(job.updatedAt)}</p>
                        {job.errorMessage ? (
                            <p className="mt-3 text-xs text-rose-600 dark:text-rose-300">
                                {job.errorCode || "ERROR"}: {job.errorMessage}
                            </p>
                        ) : (
                            <p className="mt-3 text-xs text-slate-600 dark:text-slate-300">No terminal error recorded.</p>
                        )}
                    </article>
                    <article className="rounded-2xl border border-[color:var(--border)] bg-white/80 p-4 dark:bg-slate-900/60">
                        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-300">Quality Signals</p>
                        <p className="mt-3 text-xs text-slate-600 dark:text-slate-300">
                            Preflight: {job.preflightReport ? (job.preflightReport.pass ? "passed" : "blocked") : "not recorded"}
                        </p>
                        <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                            Missing deps: {job.preflightReport?.missingDepsCount ?? 0}
                        </p>
                        <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                            Remediation hints: {job.remediationHints?.length ?? 0}
                        </p>
                        <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                            Files in artifact: {job.artifactManifest?.fileCount ?? 0}
                        </p>
                    </article>
                </div>
            </AdminDetailSection>

            <AdminDetailSection
                title="Preflight"
                description="Recorded checks before the runnable scaffold or virtual spec was accepted."
            >
                {job.preflightReport ? (
                    <div className="space-y-4">
                        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                            <article className="rounded-2xl border border-[color:var(--border)] bg-white/80 p-4 text-sm dark:bg-slate-900/60">
                                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-300">Result</p>
                                <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                                    {job.preflightReport.pass ? "Passed" : "Blocked"}
                                </p>
                            </article>
                            <article className="rounded-2xl border border-[color:var(--border)] bg-white/80 p-4 text-sm dark:bg-slate-900/60">
                                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-300">Coverage</p>
                                <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                                    {job.preflightReport.planCoveragePct}%
                                </p>
                            </article>
                            <article className="rounded-2xl border border-[color:var(--border)] bg-white/80 p-4 text-sm dark:bg-slate-900/60">
                                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-300">Tasks</p>
                                <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                                    {job.preflightReport.manifestTaskCount}
                                </p>
                            </article>
                            <article className="rounded-2xl border border-[color:var(--border)] bg-white/80 p-4 text-sm dark:bg-slate-900/60">
                                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-300">Path fixes</p>
                                <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                                    {job.preflightReport.pathNormalizationFixCount}
                                </p>
                            </article>
                        </div>

                        {job.preflightReport.issues.length > 0 ? (
                            <div className="space-y-3">
                                {job.preflightReport.issues.map((issue) => (
                                    <article
                                        key={`${job.id}-${issue.code}-${issue.message}`}
                                        className="rounded-2xl border border-[color:var(--border)] bg-white/80 p-4 dark:bg-slate-900/60"
                                    >
                                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{issue.code}</p>
                                        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{issue.message}</p>
                                        {issue.details ? (
                                            <p className="mt-1 text-xs text-slate-500 dark:text-slate-300">{issue.details}</p>
                                        ) : null}
                                    </article>
                                ))}
                            </div>
                        ) : (
                            <p className="text-sm text-slate-600 dark:text-slate-300">No preflight issues were recorded for this run.</p>
                        )}
                    </div>
                ) : (
                    <p className="text-sm text-slate-600 dark:text-slate-300">No preflight report is stored for this job.</p>
                )}
            </AdminDetailSection>

            <div className="grid gap-6 xl:grid-cols-2">
                <AdminDetailSection
                    title="Remediation"
                    description="Structured hints emitted when generation detected blockers or cleanup work."
                >
                    {job.remediationHints && job.remediationHints.length > 0 ? (
                        <div className="space-y-3">
                            {job.remediationHints.map((hint) => (
                                <article
                                    key={`${job.id}-${hint.code}-${hint.message}`}
                                    className="rounded-2xl border border-[color:var(--border)] bg-white/80 p-4 dark:bg-slate-900/60"
                                >
                                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                                        {hint.code} | {hint.severity}
                                    </p>
                                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{hint.message}</p>
                                    {hint.action ? (
                                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-300">{hint.action}</p>
                                    ) : null}
                                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-300">
                                        Auto-fixable: {hint.autoFixable ? "yes" : "no"}
                                    </p>
                                </article>
                            ))}
                        </div>
                    ) : (
                        <p className="text-sm text-slate-600 dark:text-slate-300">No remediation hints were attached to this job.</p>
                    )}
                </AdminDetailSection>

                <AdminDetailSection
                    title="Artifact Preview"
                    description="First files and folders recorded in the artifact manifest."
                >
                    {job.artifactManifest?.files?.length ? (
                        <div className="space-y-3">
                            <article className="rounded-2xl border border-[color:var(--border)] bg-white/80 p-4 dark:bg-slate-900/60">
                                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-300">Manifest</p>
                                <p className="mt-2 text-sm text-slate-700 dark:text-slate-200">
                                    {job.artifactManifest.fileCount} files tracked | Generated {formatAdminTimestamp(job.artifactManifest.generatedAt)}
                                </p>
                            </article>
                            <div className="space-y-2">
                                {job.artifactManifest.files.slice(0, 16).map((file) => (
                                    <article
                                        key={`${job.id}-${file.path}`}
                                        className="rounded-2xl border border-[color:var(--border)] bg-white/80 px-4 py-3 text-sm dark:bg-slate-900/60"
                                    >
                                        <p className="font-semibold text-slate-900 dark:text-slate-100">{file.path}</p>
                                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-300">
                                            {file.nodeType} {file.contentKind ? `| ${file.contentKind}` : ""} {file.promptPath ? `| ${file.promptPath}` : ""}
                                        </p>
                                    </article>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <p className="text-sm text-slate-600 dark:text-slate-300">No artifact manifest entries are stored for this job.</p>
                    )}
                </AdminDetailSection>
            </div>
        </AdminDetailShell>
    );
}
