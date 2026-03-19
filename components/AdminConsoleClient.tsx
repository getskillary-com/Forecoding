"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useTransition, type FormEvent } from "react";
import { AdminAuditPanel } from "@/components/AdminAuditPanel";
import { AdminObservabilityPanel } from "@/components/AdminObservabilityPanel";
import { AdminOperationsPanel } from "@/components/AdminOperationsPanel";
import { AdminStripeWebhookPanel } from "@/components/AdminStripeWebhookPanel";
import type { AdminRole } from "@/lib/admin";
import type {
    AuditEvent,
    FeatureFlag,
    GenerationJob,
    ObservabilitySnapshot,
    Tenant,
    WebhookEventRecord
} from "@/types";

type ReleaseSummary = {
    id: string;
    label: string;
    note?: string | null;
    ownerUserId: string;
    snapshotId: string;
    createdAt: number;
    rollbackReady: boolean;
    rollbackReason?: string | null;
    snapshotProjectCount: number;
};

type ReleaseDetail = ReleaseSummary & {
    latestWorkspaceRevision: number;
    snapshotSummary?: string | null;
    snapshotActiveVersionCount: number;
    projectIds: string[];
    activeVersionIds: string[];
    rollbackImpact: {
        sameAsCurrent: boolean;
        currentProjectCount: number;
        currentActiveVersionCount: number;
        projectsAddedSinceRelease: string[];
        projectsRemovedSinceRelease: string[];
        activeVersionsAddedSinceRelease: string[];
        activeVersionsRemovedSinceRelease: string[];
    };
};

type WorkspaceEnvelopeSummary = {
    ownerUserId: string;
    revision: number;
    projectCount: number;
    updatedAt: number;
    latestSnapshotSummary: string;
};

type Props = {
    email: string;
    role: AdminRole;
    auditEvents: AuditEvent[];
    operationEvents: AuditEvent[];
    observabilitySnapshot: ObservabilitySnapshot;
    featureFlags: FeatureFlag[];
    jobs: GenerationJob[];
    tenants: Tenant[];
    releases: ReleaseSummary[];
    workspaces: WorkspaceEnvelopeSummary[];
    webhookEvents: WebhookEventRecord[];
};

function formatTimestamp(value: number) {
    return new Date(value).toLocaleString();
}

function normalizeFlagValue(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (trimmed === "true") return true;
    if (trimmed === "false") return false;
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
        return Number(trimmed);
    }
    return trimmed;
}

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

function jobStatusClasses(status: GenerationJob["status"]) {
    if (status === "succeeded") {
        return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300";
    }
    if (status === "failed") {
        return "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300";
    }
    return "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300";
}

export function AdminConsoleClient(props: Props) {
    const searchParams = useSearchParams();
    const pathname = usePathname();
    const router = useRouter();
    const initialFocusedJobId = searchParams.get("job")?.trim() || props.jobs[0]?.id || null;
    const initialFocusedReleaseId = searchParams.get("release")?.trim() || null;
    const initialFocusedWebhookId = searchParams.get("webhook")?.trim() || null;
    const [isRefreshing, startRefresh] = useTransition();
    const [featureFlags, setFeatureFlags] = useState(props.featureFlags);
    const [jobs, setJobs] = useState(props.jobs);
    const [releases, setReleases] = useState(props.releases);
    const [expandedJobId, setExpandedJobId] = useState<string | null>(initialFocusedJobId);
    const [expandedReleaseId, setExpandedReleaseId] = useState<string | null>(initialFocusedReleaseId);
    const [expandedWebhookId, setExpandedWebhookId] = useState<string | null>(initialFocusedWebhookId);
    const [focusedJob, setFocusedJob] = useState<GenerationJob | null>(
        props.jobs.find((job) => job.id === initialFocusedJobId) ?? null
    );
    const [focusedRelease, setFocusedRelease] = useState<ReleaseDetail | null>(null);
    const [focusedWebhook, setFocusedWebhook] = useState<WebhookEventRecord | null>(
        props.webhookEvents.find((event) => event.eventId === initialFocusedWebhookId) ?? null
    );
    const [isFocusedJobLoading, setIsFocusedJobLoading] = useState(false);
    const [isFocusedReleaseLoading, setIsFocusedReleaseLoading] = useState(false);
    const [isFocusedWebhookLoading, setIsFocusedWebhookLoading] = useState(false);
    const [focusedJobError, setFocusedJobError] = useState<string | null>(null);
    const [focusedReleaseError, setFocusedReleaseError] = useState<string | null>(null);
    const [focusedWebhookError, setFocusedWebhookError] = useState<string | null>(null);
    const [flagForm, setFlagForm] = useState({
        key: "",
        description: "",
        scope: "global" as FeatureFlag["scope"],
        value: ""
    });
    const [releaseForm, setReleaseForm] = useState({
        ownerUserId: props.workspaces[0]?.ownerUserId || "",
        label: "",
        note: ""
    });
    const [busyFlagKey, setBusyFlagKey] = useState<string | null>(null);
    const [busyReleaseId, setBusyReleaseId] = useState<string | null>(null);
    const [pendingRollbackReleaseId, setPendingRollbackReleaseId] = useState<string | null>(null);
    const [isSavingFlag, setIsSavingFlag] = useState(false);
    const [isPublishingRelease, setIsPublishingRelease] = useState(false);
    const [isRefreshingJobs, setIsRefreshingJobs] = useState(false);
    const [jobQuery, setJobQuery] = useState("");
    const [jobStatus, setJobStatus] = useState<"" | GenerationJob["status"]>("");
    const [jobOutputMode, setJobOutputMode] = useState<"" | "virtual_spec" | "runnable_scaffold">("");
    const [feedback, setFeedback] = useState<{ tone: "success" | "error"; message: string } | null>(null);

    const canOperate = props.role === "admin" || props.role === "operator";
    const statusTone = feedback?.tone === "error"
        ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300"
        : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300";

    const sortedFlags = useMemo(
        () => [...featureFlags].sort((left, right) => left.key.localeCompare(right.key)),
        [featureFlags]
    );
    const pendingRollbackDetail = pendingRollbackReleaseId && focusedRelease?.id === pendingRollbackReleaseId
        ? focusedRelease
        : null;
    const isPreparingRollbackReview = Boolean(
        pendingRollbackReleaseId
        && (
            pendingRollbackDetail === null
            || isFocusedReleaseLoading
        )
    );

    const syncFocusSearchParam = (key: "job" | "release" | "webhook", value: string | null) => {
        const params = new URLSearchParams(searchParams.toString());
        if (value) {
            params.set(key, value);
        } else {
            params.delete(key);
        }
        const query = params.toString();
        router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    };

    const refreshAll = () => {
        startRefresh(() => {
            router.refresh();
        });
    };

    useEffect(() => {
        if (!expandedJobId) {
            setFocusedJob(null);
            setFocusedJobError(null);
            return;
        }

        const jobFromList = jobs.find((job) => job.id === expandedJobId) ?? null;
        if (jobFromList) {
            setFocusedJob(jobFromList);
        }

        let cancelled = false;
        setIsFocusedJobLoading(true);
        setFocusedJobError(null);

        void fetch(`/api/admin/jobs/${encodeURIComponent(expandedJobId)}`, {
            cache: "no-store"
        })
            .then(async (res) => {
                const payload = (await res.json()) as { job?: GenerationJob; error?: string };
                if (!res.ok || !payload.job) {
                    throw new Error(payload.error || "Failed to load job detail.");
                }
                if (!cancelled) {
                    setFocusedJob(payload.job);
                }
            })
            .catch((error) => {
                if (!cancelled) {
                    setFocusedJobError(error instanceof Error ? error.message : "Failed to load job detail.");
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setIsFocusedJobLoading(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [expandedJobId, jobs]);

    useEffect(() => {
        if (!expandedReleaseId) {
            setFocusedRelease(null);
            setFocusedReleaseError(null);
            return;
        }

        let cancelled = false;
        setIsFocusedReleaseLoading(true);
        setFocusedReleaseError(null);

        void fetch(`/api/admin/releases/${encodeURIComponent(expandedReleaseId)}`, {
            cache: "no-store"
        })
            .then(async (res) => {
                const payload = (await res.json()) as { release?: ReleaseDetail; error?: string };
                if (!res.ok || !payload.release) {
                    throw new Error(payload.error || "Failed to load release detail.");
                }
                if (!cancelled) {
                    setFocusedRelease(payload.release);
                }
            })
            .catch((error) => {
                if (!cancelled) {
                    setFocusedReleaseError(error instanceof Error ? error.message : "Failed to load release detail.");
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setIsFocusedReleaseLoading(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [expandedReleaseId, releases]);

    useEffect(() => {
        if (!expandedWebhookId) {
            setFocusedWebhook(null);
            setFocusedWebhookError(null);
            return;
        }

        const webhookFromList = props.webhookEvents.find((event) => event.eventId === expandedWebhookId) ?? null;
        if (webhookFromList) {
            setFocusedWebhook(webhookFromList);
        }

        let cancelled = false;
        setIsFocusedWebhookLoading(true);
        setFocusedWebhookError(null);

        void fetch(`/api/admin/webhooks/stripe/${encodeURIComponent(expandedWebhookId)}`, {
            cache: "no-store"
        })
            .then(async (res) => {
                const payload = (await res.json()) as { event?: WebhookEventRecord; error?: string };
                if (!res.ok || !payload.event) {
                    throw new Error(payload.error || "Failed to load webhook detail.");
                }
                if (!cancelled) {
                    setFocusedWebhook(payload.event);
                }
            })
            .catch((error) => {
                if (!cancelled) {
                    setFocusedWebhookError(error instanceof Error ? error.message : "Failed to load webhook detail.");
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setIsFocusedWebhookLoading(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [expandedWebhookId, props.webhookEvents]);

    const refreshJobs = async (overrides?: {
        query?: string;
        status?: "" | GenerationJob["status"];
        outputMode?: "" | "virtual_spec" | "runnable_scaffold";
    }) => {
        setIsRefreshingJobs(true);
        setFeedback(null);
        try {
            const params = new URLSearchParams();
            const nextQuery = (overrides?.query ?? jobQuery).trim();
            const nextStatus = overrides?.status ?? jobStatus;
            const nextOutputMode = overrides?.outputMode ?? jobOutputMode;
            if (nextQuery) params.set("query", nextQuery);
            if (nextStatus) params.set("status", nextStatus);
            if (nextOutputMode) params.set("outputMode", nextOutputMode);
            params.set("limit", "20");

            const res = await fetch(`/api/admin/jobs?${params.toString()}`, { cache: "no-store" });
            const payload = (await res.json()) as { jobs?: GenerationJob[]; error?: string };
            if (!res.ok || !Array.isArray(payload.jobs)) {
                throw new Error(payload.error || "Failed to refresh generation jobs.");
            }
            const refreshedJobs = payload.jobs;
            setJobs(refreshedJobs);
            const nextSelectedJobId = expandedJobId && refreshedJobs.some((job) => job.id === expandedJobId)
                ? expandedJobId
                : refreshedJobs[0]?.id || null;
            setExpandedJobId(nextSelectedJobId);
            syncFocusSearchParam("job", nextSelectedJobId);
            setFeedback({ tone: "success", message: "Generation jobs refreshed." });
        } catch (error) {
            setFeedback({
                tone: "error",
                message: error instanceof Error ? error.message : "Failed to refresh generation jobs."
            });
        } finally {
            setIsRefreshingJobs(false);
        }
    };

    const upsertFlag = async (input: {
        key: string;
        description: string;
        enabled: boolean;
        scope: FeatureFlag["scope"];
        value?: string | number | boolean | null;
    }) => {
        setFeedback(null);
        setBusyFlagKey(input.key);
        try {
            const res = await fetch("/api/admin/flags", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(input)
            });
            const payload = (await res.json()) as { flag?: FeatureFlag; error?: string };
            if (!res.ok || !payload.flag) {
                throw new Error(payload.error || "Failed to save feature flag.");
            }
            const savedFlag = payload.flag;

            setFeatureFlags((current) => {
                const exists = current.some((flag) => flag.key === savedFlag.key);
                return exists
                    ? current.map((flag) => flag.key === savedFlag.key ? savedFlag : flag)
                    : [savedFlag, ...current];
            });
            setFeedback({
                tone: "success",
                message: `Feature flag ${savedFlag.key} saved.`
            });
            refreshAll();
        } catch (error) {
            setFeedback({
                tone: "error",
                message: error instanceof Error ? error.message : "Failed to save feature flag."
            });
        } finally {
            setBusyFlagKey(null);
        }
    };

    const handleFlagCreate = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!canOperate) return;

        setIsSavingFlag(true);
        try {
            await upsertFlag({
                key: flagForm.key.trim(),
                description: flagForm.description.trim(),
                enabled: true,
                scope: flagForm.scope,
                value: normalizeFlagValue(flagForm.value)
            });
            setFlagForm({
                key: "",
                description: "",
                scope: "global",
                value: ""
            });
        } finally {
            setIsSavingFlag(false);
        }
    };

    const handleFlagToggle = async (flag: FeatureFlag) => {
        if (!canOperate) return;

        await upsertFlag({
            key: flag.key,
            description: flag.description,
            enabled: !flag.enabled,
            scope: flag.scope,
            value: flag.value ?? null
        });
    };

    const handleReleasePublish = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!canOperate) return;

        setIsPublishingRelease(true);
        setFeedback(null);
        try {
            const res = await fetch("/api/admin/releases", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    ownerUserId: releaseForm.ownerUserId,
                    label: releaseForm.label.trim(),
                    note: releaseForm.note.trim() || undefined
                })
            });
            const payload = (await res.json()) as { release?: ReleaseSummary; error?: string };
            if (!res.ok || !payload.release) {
                throw new Error(payload.error || "Failed to publish release tag.");
            }
            const savedRelease = payload.release;

            setReleases((current) => [savedRelease, ...current].slice(0, 12));
            setReleaseForm((current) => ({
                ...current,
                label: "",
                note: ""
            }));
            setFeedback({
                tone: "success",
                message: `Published release ${savedRelease.label}.`
            });
            refreshAll();
        } catch (error) {
            setFeedback({
                tone: "error",
                message: error instanceof Error ? error.message : "Failed to publish release tag."
            });
        } finally {
            setIsPublishingRelease(false);
        }
    };

    const handleReleaseRollbackReview = (release: ReleaseSummary) => {
        if (!canOperate || !release.rollbackReady) return;

        setPendingRollbackReleaseId(release.id);
        if (expandedReleaseId !== release.id) {
            setExpandedReleaseId(release.id);
            setFocusedReleaseError(null);
            syncFocusSearchParam("release", release.id);
        }
    };

    const handleReleaseRollback = async (release: ReleaseSummary | ReleaseDetail) => {
        if (!canOperate || !release.rollbackReady) return;

        setBusyReleaseId(release.id);
        setFeedback(null);
        try {
            const res = await fetch("/api/admin/releases/rollback", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    ownerUserId: release.ownerUserId,
                    releaseTagId: release.id
                })
            });
            const payload = (await res.json()) as {
                result?: {
                    restoredRevision: number;
                    restoredSnapshotId: string;
                    projectCount: number;
                };
                error?: string;
            };
            if (!res.ok || !payload.result) {
                throw new Error(payload.error || "Failed to roll back release.");
            }
            setFeedback({
                tone: "success",
                message: `Rolled back ${release.ownerUserId} to ${release.label}. New revision r${payload.result.restoredRevision} restored ${payload.result.projectCount} project(s).`
            });
            setPendingRollbackReleaseId(null);
            refreshAll();
        } catch (error) {
            setFeedback({
                tone: "error",
                message: error instanceof Error ? error.message : "Failed to roll back release."
            });
        } finally {
            setBusyReleaseId(null);
        }
    };

    const handleJobSelection = (jobId: string) => {
        const nextJobId = expandedJobId === jobId ? null : jobId;
        setExpandedJobId(nextJobId);
        setFocusedJobError(null);
        syncFocusSearchParam("job", nextJobId);
    };

    const handleReleaseSelection = (releaseId: string) => {
        const nextReleaseId = expandedReleaseId === releaseId ? null : releaseId;
        setExpandedReleaseId(nextReleaseId);
        setFocusedReleaseError(null);
        if (!nextReleaseId || pendingRollbackReleaseId !== nextReleaseId) {
            setPendingRollbackReleaseId(null);
        }
        syncFocusSearchParam("release", nextReleaseId);
    };

    const handleWebhookSelection = (eventId: string) => {
        const nextWebhookId = expandedWebhookId === eventId ? null : eventId;
        setExpandedWebhookId(nextWebhookId);
        setFocusedWebhookError(null);
        syncFocusSearchParam("webhook", nextWebhookId);
    };

    return (
        <main className="relative min-h-screen overflow-hidden px-4 py-8 sm:px-8">
            <div className="pointer-events-none absolute inset-0">
                <div className="fc-float absolute -top-20 -left-20 h-72 w-72 rounded-full bg-blue-500/20 blur-3xl" />
                <div
                    className="fc-float absolute right-0 top-1/3 h-72 w-72 rounded-full bg-cyan-500/20 blur-3xl"
                    style={{ animationDelay: "1.1s" }}
                />
            </div>

            <div className="relative mx-auto max-w-6xl space-y-6">
                <header className="fc-surface-strong rounded-[var(--radius-2xl)] p-6">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-300">
                                Admin Console
                            </p>
                            <h1 className="mt-1 text-3xl font-semibold text-slate-900 dark:text-slate-100">
                                Operations and Governance
                            </h1>
                            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Current account: {props.email}</p>
                            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Active role: {roleLabel(props.role)}</p>
                        </div>
                        <div className="flex flex-wrap gap-3">
                            <button
                                type="button"
                                onClick={refreshAll}
                                disabled={isRefreshing}
                                className="fc-button-secondary px-4 py-2.5 text-sm font-semibold disabled:opacity-60"
                            >
                                {isRefreshing ? "Refreshing..." : "Refresh console"}
                            </button>
                            <Link href="/dashboard" className="fc-button-primary px-4 py-2.5 text-sm font-semibold">
                                Open Dashboard
                            </Link>
                            <Link href="/" className="fc-button-secondary px-4 py-2.5 text-sm font-semibold">
                                Go Home
                            </Link>
                        </div>
                    </div>
                    {feedback ? (
                        <div className={`mt-4 rounded-2xl border px-4 py-3 text-sm ${statusTone}`}>
                            {feedback.message}
                        </div>
                    ) : null}
                </header>

                <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <article className="fc-surface-strong rounded-[var(--radius-2xl)] p-5">
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-300">Audit Events</p>
                        <p className="mt-2 text-3xl font-semibold text-slate-900 dark:text-slate-100">{props.auditEvents.length}</p>
                        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Latest governance actions recorded in Firestore.</p>
                    </article>
                    <article className="fc-surface-strong rounded-[var(--radius-2xl)] p-5">
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-300">Feature Flags</p>
                        <p className="mt-2 text-3xl font-semibold text-slate-900 dark:text-slate-100">{sortedFlags.length}</p>
                        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Global, tenant, and workspace rollout controls.</p>
                    </article>
                    <article className="fc-surface-strong rounded-[var(--radius-2xl)] p-5">
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-300">Release Tags</p>
                        <p className="mt-2 text-3xl font-semibold text-slate-900 dark:text-slate-100">{releases.length}</p>
                        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Latest snapshot releases visible across workspaces.</p>
                    </article>
                    <article className="fc-surface-strong rounded-[var(--radius-2xl)] p-5">
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-300">Tracked Workspaces</p>
                        <p className="mt-2 text-3xl font-semibold text-slate-900 dark:text-slate-100">{props.workspaces.length}</p>
                        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Workspace envelopes with revision-aware summaries.</p>
                    </article>
                    <article className="fc-surface-strong rounded-[var(--radius-2xl)] p-5 md:col-span-2 xl:col-span-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-300">Stripe Webhooks</p>
                        <p className="mt-2 text-3xl font-semibold text-slate-900 dark:text-slate-100">{props.webhookEvents.length}</p>
                        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Stored webhook payloads that can be replayed safely from the admin console.</p>
                    </article>
                </section>

                <section className="grid gap-6 xl:grid-cols-2">
                    <article className="fc-surface-strong rounded-[var(--radius-2xl)] p-6">
                        <div className="flex items-center justify-between gap-3">
                            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Feature Flags</h2>
                            <span className="text-xs text-slate-500 dark:text-slate-300">
                                {canOperate ? "Operator actions enabled" : "Read-only role"}
                            </span>
                        </div>

                        <form
                            onSubmit={handleFlagCreate}
                            className="mt-4 grid gap-3 rounded-2xl border border-[color:var(--border)] bg-white/70 p-4 dark:bg-slate-900/60"
                        >
                            <input
                                value={flagForm.key}
                                onChange={(event) => setFlagForm((current) => ({ ...current, key: event.target.value }))}
                                placeholder="Flag key, e.g. generation.enabled"
                                disabled={!canOperate || isSavingFlag}
                                className="rounded-xl border border-[color:var(--border)] bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:bg-slate-950 dark:text-slate-100"
                            />
                            <input
                                value={flagForm.description}
                                onChange={(event) => setFlagForm((current) => ({ ...current, description: event.target.value }))}
                                placeholder="What this flag controls"
                                disabled={!canOperate || isSavingFlag}
                                className="rounded-xl border border-[color:var(--border)] bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:bg-slate-950 dark:text-slate-100"
                            />
                            <div className="grid gap-3 sm:grid-cols-[140px_minmax(0,1fr)]">
                                <select
                                    value={flagForm.scope}
                                    onChange={(event) => setFlagForm((current) => ({ ...current, scope: event.target.value as FeatureFlag["scope"] }))}
                                    disabled={!canOperate || isSavingFlag}
                                    className="rounded-xl border border-[color:var(--border)] bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:bg-slate-950 dark:text-slate-100"
                                >
                                    <option value="global">global</option>
                                    <option value="tenant">tenant</option>
                                    <option value="workspace">workspace</option>
                                </select>
                                <input
                                    value={flagForm.value}
                                    onChange={(event) => setFlagForm((current) => ({ ...current, value: event.target.value }))}
                                    placeholder="Optional value: true, false, 42, or text"
                                    disabled={!canOperate || isSavingFlag}
                                    className="rounded-xl border border-[color:var(--border)] bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:bg-slate-950 dark:text-slate-100"
                                />
                            </div>
                            <button
                                type="submit"
                                disabled={!canOperate || isSavingFlag || !flagForm.key.trim()}
                                className="fc-button-primary px-4 py-2.5 text-sm font-semibold disabled:opacity-60"
                            >
                                {isSavingFlag ? "Saving flag..." : "Create enabled flag"}
                            </button>
                        </form>

                        <div className="mt-4 space-y-3">
                            {sortedFlags.length > 0 ? sortedFlags.map((flag) => (
                                <div
                                    key={flag.key}
                                    className="rounded-2xl border border-[color:var(--border)] bg-white/70 p-4 dark:bg-slate-900/60"
                                >
                                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                        <div>
                                            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{flag.key}</p>
                                            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{flag.description || "No description."}</p>
                                            <p className="mt-2 text-xs text-slate-500 dark:text-slate-300">
                                                Scope: {flag.scope} | Updated {formatTimestamp(flag.updatedAt)}
                                            </p>
                                            {flag.value !== null && flag.value !== undefined ? (
                                                <p className="mt-1 text-xs text-slate-500 dark:text-slate-300">Value: {String(flag.value)}</p>
                                            ) : null}
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => void handleFlagToggle(flag)}
                                            disabled={!canOperate || busyFlagKey === flag.key}
                                            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition disabled:opacity-60 ${flag.enabled ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" : "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300"}`}
                                        >
                                            {busyFlagKey === flag.key ? "Saving..." : flag.enabled ? "Disable" : "Enable"}
                                        </button>
                                    </div>
                                </div>
                            )) : (
                                <p className="mt-4 text-sm text-slate-500 dark:text-slate-300">No feature flags configured yet.</p>
                            )}
                        </div>
                    </article>

                    <article className="fc-surface-strong rounded-[var(--radius-2xl)] p-6">
                        <div className="flex items-center justify-between gap-3">
                            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Release Publisher</h2>
                            <span className="text-xs text-slate-500 dark:text-slate-300">
                                {canOperate ? "Ready to publish" : "Read-only role"}
                            </span>
                        </div>

                        <form
                            onSubmit={handleReleasePublish}
                            className="mt-4 grid gap-3 rounded-2xl border border-[color:var(--border)] bg-white/70 p-4 dark:bg-slate-900/60"
                        >
                            <select
                                value={releaseForm.ownerUserId}
                                onChange={(event) => setReleaseForm((current) => ({ ...current, ownerUserId: event.target.value }))}
                                disabled={!canOperate || isPublishingRelease || props.workspaces.length === 0}
                                className="rounded-xl border border-[color:var(--border)] bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:bg-slate-950 dark:text-slate-100"
                            >
                                {props.workspaces.map((workspace) => (
                                    <option key={workspace.ownerUserId} value={workspace.ownerUserId}>
                                        {workspace.ownerUserId} | r{workspace.revision}
                                    </option>
                                ))}
                            </select>
                            <input
                                value={releaseForm.label}
                                onChange={(event) => setReleaseForm((current) => ({ ...current, label: event.target.value }))}
                                placeholder="Release label, e.g. r42-platform-ready"
                                disabled={!canOperate || isPublishingRelease}
                                className="rounded-xl border border-[color:var(--border)] bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:bg-slate-950 dark:text-slate-100"
                            />
                            <input
                                value={releaseForm.note}
                                onChange={(event) => setReleaseForm((current) => ({ ...current, note: event.target.value }))}
                                placeholder="Optional release note"
                                disabled={!canOperate || isPublishingRelease}
                                className="rounded-xl border border-[color:var(--border)] bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:bg-slate-950 dark:text-slate-100"
                            />
                            <button
                                type="submit"
                                disabled={!canOperate || isPublishingRelease || !releaseForm.ownerUserId || !releaseForm.label.trim()}
                                className="fc-button-primary px-4 py-2.5 text-sm font-semibold disabled:opacity-60"
                            >
                                {isPublishingRelease ? "Publishing..." : "Publish release tag"}
                            </button>
                        </form>

                        <div className="mt-4 space-y-3">
                            {expandedReleaseId ? (
                                <div className="rounded-2xl border border-[color:var(--border)] bg-slate-50/90 p-5 dark:bg-slate-950/50">
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                    <div>
                                        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-300">
                                            Focused Release
                                        </p>
                                            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                                                Shareable link target: `?release={expandedReleaseId}`
                                            </p>
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            <Link
                                                href={`/admin/releases/${encodeURIComponent(expandedReleaseId)}`}
                                                className="fc-button-secondary px-3 py-2 text-xs font-semibold"
                                            >
                                                Open full page
                                            </Link>
                                            {canOperate && focusedRelease?.rollbackReady ? (
                                                <button
                                                    type="button"
                                                    onClick={() => setPendingRollbackReleaseId((current) => current === focusedRelease.id ? null : focusedRelease.id)}
                                                    className="fc-button-secondary px-3 py-2 text-xs font-semibold"
                                                >
                                                    {pendingRollbackReleaseId === focusedRelease.id ? "Close rollback review" : "Review rollback"}
                                                </button>
                                            ) : null}
                                            <button
                                                type="button"
                                                onClick={() => handleReleaseSelection(expandedReleaseId)}
                                                className="fc-button-secondary px-3 py-2 text-xs font-semibold"
                                            >
                                                Clear focus
                                            </button>
                                        </div>
                                    </div>

                                    {isFocusedReleaseLoading ? (
                                        <p className="mt-4 text-sm text-slate-500 dark:text-slate-300">Loading latest release detail...</p>
                                    ) : null}
                                    {focusedReleaseError ? (
                                        <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
                                            {focusedReleaseError}
                                        </div>
                                    ) : null}
                                    {focusedRelease ? (
                                        <div className="mt-4 space-y-4">
                                            <div className="grid gap-4 sm:grid-cols-2">
                                                <div className="rounded-2xl border border-[color:var(--border)] bg-white/80 p-4 dark:bg-slate-900/60">
                                                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{focusedRelease.label}</p>
                                                    <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">Workspace {focusedRelease.ownerUserId}</p>
                                                    <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">Snapshot {focusedRelease.snapshotId}</p>
                                                    <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">Created {formatTimestamp(focusedRelease.createdAt)}</p>
                                                </div>
                                                <div className="rounded-2xl border border-[color:var(--border)] bg-white/80 p-4 dark:bg-slate-900/60">
                                                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-300">Restore Readiness</p>
                                                    <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">
                                                        Rollback {focusedRelease.rollbackReady ? "ready" : "blocked"} | Workspace r{focusedRelease.latestWorkspaceRevision}
                                                    </p>
                                                    <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                                                        Projects {focusedRelease.snapshotProjectCount} | Active versions {focusedRelease.snapshotActiveVersionCount}
                                                    </p>
                                                    <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                                                        Snapshot summary: {focusedRelease.snapshotSummary || "not available"}
                                                    </p>
                                                    {focusedRelease.rollbackReason ? (
                                                        <p className="mt-2 text-xs text-amber-600 dark:text-amber-300">{focusedRelease.rollbackReason}</p>
                                                    ) : null}
                                                </div>
                                            </div>

                                            <div className="rounded-2xl border border-[color:var(--border)] bg-white/80 p-4 dark:bg-slate-900/60">
                                                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-300">Rollback Impact</p>
                                                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${focusedRelease.rollbackImpact.sameAsCurrent ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"}`}>
                                                        {focusedRelease.rollbackImpact.sameAsCurrent ? "Matches current workspace" : "Rollback would change current workspace"}
                                                    </span>
                                                </div>
                                                <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">
                                                    Current workspace: {focusedRelease.rollbackImpact.currentProjectCount} projects | {focusedRelease.rollbackImpact.currentActiveVersionCount} active versions
                                                </p>
                                                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                                                    <div className="rounded-xl border border-[color:var(--border)] bg-slate-50/80 px-3 py-3 dark:bg-slate-950/50">
                                                        <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">Projects changed since release</p>
                                                        <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">
                                                            Added now: {focusedRelease.rollbackImpact.projectsAddedSinceRelease.length} | Missing now: {focusedRelease.rollbackImpact.projectsRemovedSinceRelease.length}
                                                        </p>
                                                        {focusedRelease.rollbackImpact.projectsAddedSinceRelease.slice(0, 4).map((projectId) => (
                                                            <p key={`${focusedRelease.id}-project-added-${projectId}`} className="mt-1 text-xs text-slate-500 dark:text-slate-300">+ {projectId}</p>
                                                        ))}
                                                        {focusedRelease.rollbackImpact.projectsRemovedSinceRelease.slice(0, 4).map((projectId) => (
                                                            <p key={`${focusedRelease.id}-project-removed-${projectId}`} className="mt-1 text-xs text-slate-500 dark:text-slate-300">- {projectId}</p>
                                                        ))}
                                                    </div>
                                                    <div className="rounded-xl border border-[color:var(--border)] bg-slate-50/80 px-3 py-3 dark:bg-slate-950/50">
                                                        <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">Active versions changed since release</p>
                                                        <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">
                                                            Added now: {focusedRelease.rollbackImpact.activeVersionsAddedSinceRelease.length} | Missing now: {focusedRelease.rollbackImpact.activeVersionsRemovedSinceRelease.length}
                                                        </p>
                                                        {focusedRelease.rollbackImpact.activeVersionsAddedSinceRelease.slice(0, 4).map((versionId) => (
                                                            <p key={`${focusedRelease.id}-version-added-${versionId}`} className="mt-1 text-xs text-slate-500 dark:text-slate-300">+ {versionId}</p>
                                                        ))}
                                                        {focusedRelease.rollbackImpact.activeVersionsRemovedSinceRelease.slice(0, 4).map((versionId) => (
                                                            <p key={`${focusedRelease.id}-version-removed-${versionId}`} className="mt-1 text-xs text-slate-500 dark:text-slate-300">- {versionId}</p>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>

                                            {pendingRollbackReleaseId === focusedRelease.id ? (
                                                <div className="rounded-2xl border border-sky-200 bg-sky-50/80 p-4 dark:border-sky-900/60 dark:bg-sky-950/30">
                                                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                                        <div>
                                                            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-sky-700 dark:text-sky-300">
                                                                Rollback Confirmation
                                                            </p>
                                                            <p className="mt-2 text-sm text-slate-700 dark:text-slate-200">
                                                                This will restore workspace <span className="font-semibold">{focusedRelease.ownerUserId}</span> from snapshot <span className="font-semibold">{focusedRelease.snapshotId}</span> and create a new revision.
                                                            </p>
                                                            <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                                                                Expected next revision: r{focusedRelease.latestWorkspaceRevision + 1} | Release label: {focusedRelease.label}
                                                            </p>
                                                        </div>
                                                        <button
                                                            type="button"
                                                            onClick={() => setPendingRollbackReleaseId(null)}
                                                            className="fc-button-secondary px-3 py-2 text-xs font-semibold"
                                                        >
                                                            Cancel review
                                                        </button>
                                                    </div>

                                                    {isPreparingRollbackReview ? (
                                                        <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">Preparing rollback diff summary...</p>
                                                    ) : null}
                                                    {pendingRollbackDetail ? (
                                                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                                                            <div className="rounded-xl border border-sky-200/70 bg-white/80 px-3 py-3 dark:border-sky-900/60 dark:bg-slate-900/60">
                                                                <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">Workspace impact</p>
                                                                <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">
                                                                    Current workspace has {pendingRollbackDetail.rollbackImpact.currentProjectCount} projects and {pendingRollbackDetail.rollbackImpact.currentActiveVersionCount} active versions.
                                                                </p>
                                                                <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                                                                    Snapshot restores {pendingRollbackDetail.snapshotProjectCount} projects and {pendingRollbackDetail.snapshotActiveVersionCount} active versions.
                                                                </p>
                                                                <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                                                                    {pendingRollbackDetail.rollbackImpact.sameAsCurrent
                                                                        ? "This snapshot already matches the current workspace state; rollback will still record a new revision for governance history."
                                                                        : "This snapshot differs from the current workspace; the changes below will be applied in the new revision."}
                                                                </p>
                                                            </div>
                                                            <div className="rounded-xl border border-sky-200/70 bg-white/80 px-3 py-3 dark:border-sky-900/60 dark:bg-slate-900/60">
                                                                <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">Change totals</p>
                                                                <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">
                                                                    Projects added now: {pendingRollbackDetail.rollbackImpact.projectsAddedSinceRelease.length}
                                                                </p>
                                                                <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                                                                    Projects missing now: {pendingRollbackDetail.rollbackImpact.projectsRemovedSinceRelease.length}
                                                                </p>
                                                                <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                                                                    Active versions added now: {pendingRollbackDetail.rollbackImpact.activeVersionsAddedSinceRelease.length}
                                                                </p>
                                                                <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                                                                    Active versions missing now: {pendingRollbackDetail.rollbackImpact.activeVersionsRemovedSinceRelease.length}
                                                                </p>
                                                            </div>
                                                            <div className="rounded-xl border border-sky-200/70 bg-white/80 px-3 py-3 dark:border-sky-900/60 dark:bg-slate-900/60">
                                                                <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">Projects that would be removed</p>
                                                                {pendingRollbackDetail.rollbackImpact.projectsAddedSinceRelease.length > 0 ? (
                                                                    pendingRollbackDetail.rollbackImpact.projectsAddedSinceRelease.slice(0, 6).map((projectId) => (
                                                                        <p key={`${pendingRollbackDetail.id}-confirm-project-added-${projectId}`} className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                                                                            - {projectId}
                                                                        </p>
                                                                    ))
                                                                ) : (
                                                                    <p className="mt-2 text-xs text-slate-500 dark:text-slate-300">No extra current projects would be removed.</p>
                                                                )}
                                                            </div>
                                                            <div className="rounded-xl border border-sky-200/70 bg-white/80 px-3 py-3 dark:border-sky-900/60 dark:bg-slate-900/60">
                                                                <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">Projects that would be restored</p>
                                                                {pendingRollbackDetail.rollbackImpact.projectsRemovedSinceRelease.length > 0 ? (
                                                                    pendingRollbackDetail.rollbackImpact.projectsRemovedSinceRelease.slice(0, 6).map((projectId) => (
                                                                        <p key={`${pendingRollbackDetail.id}-confirm-project-removed-${projectId}`} className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                                                                            + {projectId}
                                                                        </p>
                                                                    ))
                                                                ) : (
                                                                    <p className="mt-2 text-xs text-slate-500 dark:text-slate-300">No missing snapshot projects need to be restored.</p>
                                                                )}
                                                            </div>
                                                        </div>
                                                    ) : null}

                                                    {focusedRelease.rollbackReason ? (
                                                        <p className="mt-4 text-xs text-amber-600 dark:text-amber-300">{focusedRelease.rollbackReason}</p>
                                                    ) : null}

                                                    <div className="mt-4 flex flex-wrap gap-3">
                                                        <button
                                                            type="button"
                                                            onClick={() => void handleReleaseRollback(focusedRelease)}
                                                            disabled={!canOperate || !focusedRelease.rollbackReady || busyReleaseId === focusedRelease.id || isPreparingRollbackReview}
                                                            className="fc-button-primary px-4 py-2.5 text-sm font-semibold disabled:opacity-60"
                                                        >
                                                            {busyReleaseId === focusedRelease.id ? "Rolling back..." : "Confirm rollback"}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => setPendingRollbackReleaseId(null)}
                                                            disabled={busyReleaseId === focusedRelease.id}
                                                            className="fc-button-secondary px-4 py-2.5 text-sm font-semibold disabled:opacity-60"
                                                        >
                                                            Keep current workspace
                                                        </button>
                                                    </div>
                                                </div>
                                            ) : null}
                                        </div>
                                    ) : null}
                                </div>
                            ) : null}
                            {releases.length > 0 ? releases.map((release) => (
                                <div
                                    key={release.id}
                                    className={`rounded-2xl border p-4 text-sm dark:bg-slate-900/60 ${expandedReleaseId === release.id ? "border-sky-300 bg-sky-50/70 dark:border-sky-800 dark:bg-sky-950/20" : "border-[color:var(--border)] bg-white/70"}`}
                                >
                                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                        <div>
                                            <p className="font-semibold text-slate-900 dark:text-slate-100">{release.label}</p>
                                            <p className="mt-1 text-slate-600 dark:text-slate-300">{release.ownerUserId}</p>
                                            <p className="mt-1 text-xs text-slate-500 dark:text-slate-300">Snapshot: {release.snapshotId}</p>
                                            <p className="mt-1 text-xs text-slate-500 dark:text-slate-300">
                                                Stored projects: {release.snapshotProjectCount} | Rollback {release.rollbackReady ? "ready" : "blocked"}
                                            </p>
                                            {release.rollbackReason ? (
                                                <p className="mt-1 text-xs text-amber-600 dark:text-amber-300">{release.rollbackReason}</p>
                                            ) : null}
                                            {release.note ? (
                                                <p className="mt-2 text-xs text-slate-500 dark:text-slate-300">{release.note}</p>
                                            ) : null}
                                        </div>
                                        <div className="flex flex-col items-start gap-2 sm:items-end">
                                            <span className="text-xs text-slate-500 dark:text-slate-300">{formatTimestamp(release.createdAt)}</span>
                                            <div className="flex flex-wrap gap-2 sm:justify-end">
                                                <button
                                                    type="button"
                                                    onClick={() => handleReleaseSelection(release.id)}
                                                    className="fc-button-secondary px-3 py-2 text-xs font-semibold"
                                                >
                                                    {expandedReleaseId === release.id ? "Hide detail" : "Open detail"}
                                                </button>
                                                <Link
                                                    href={`/admin/releases/${encodeURIComponent(release.id)}`}
                                                    className="fc-button-secondary px-3 py-2 text-xs font-semibold"
                                                >
                                                    Full page
                                                </Link>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => handleReleaseRollbackReview(release)}
                                                disabled={!canOperate || !release.rollbackReady || busyReleaseId === release.id}
                                                className="fc-button-secondary px-3 py-2 text-xs font-semibold"
                                            >
                                                {busyReleaseId === release.id ? "Rolling back..." : "Review rollback"}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )) : (
                                <p className="mt-4 text-sm text-slate-500 dark:text-slate-300">No release tags published yet.</p>
                            )}
                        </div>
                    </article>
                </section>

                <section className="grid gap-6 xl:grid-cols-[1.35fr,0.9fr]">
                    <article className="fc-surface-strong rounded-[var(--radius-2xl)] p-6">
                        <div className="flex items-center justify-between gap-3">
                            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Generation Jobs</h2>
                            <div className="flex flex-wrap gap-2">
                                <button
                                    type="button"
                                    onClick={() => void refreshJobs()}
                                    disabled={isRefreshingJobs}
                                    className="fc-button-secondary px-4 py-2.5 text-sm font-semibold disabled:opacity-60"
                                >
                                    {isRefreshingJobs ? "Refreshing..." : "Apply filters"}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setJobQuery("");
                                        setJobStatus("");
                                        setJobOutputMode("");
                                        void refreshJobs({
                                            query: "",
                                            status: "",
                                            outputMode: ""
                                        });
                                    }}
                                    disabled={isRefreshingJobs}
                                    className="fc-button-secondary px-4 py-2.5 text-sm font-semibold disabled:opacity-60"
                                >
                                    Clear
                                </button>
                            </div>
                        </div>
                        <div className="mt-4 grid gap-3 rounded-2xl border border-[color:var(--border)] bg-white/70 p-4 dark:bg-slate-900/60">
                            <input
                                value={jobQuery}
                                onChange={(event) => setJobQuery(event.target.value)}
                                placeholder="Search by job id, project, release intent, error, or artifact path"
                                className="rounded-xl border border-[color:var(--border)] bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:bg-slate-950 dark:text-slate-100"
                            />
                            <div className="grid gap-3 sm:grid-cols-2">
                                <select
                                    value={jobStatus}
                                    onChange={(event) => setJobStatus(event.target.value as "" | GenerationJob["status"])}
                                    className="rounded-xl border border-[color:var(--border)] bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:bg-slate-950 dark:text-slate-100"
                                >
                                    <option value="">All statuses</option>
                                    <option value="queued">queued</option>
                                    <option value="running">running</option>
                                    <option value="succeeded">succeeded</option>
                                    <option value="failed">failed</option>
                                </select>
                                <select
                                    value={jobOutputMode}
                                    onChange={(event) => setJobOutputMode(event.target.value as "" | "virtual_spec" | "runnable_scaffold")}
                                    className="rounded-xl border border-[color:var(--border)] bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:bg-slate-950 dark:text-slate-100"
                                >
                                    <option value="">All output modes</option>
                                    <option value="virtual_spec">virtual_spec</option>
                                    <option value="runnable_scaffold">runnable_scaffold</option>
                                </select>
                            </div>
                        </div>
                        {expandedJobId ? (
                            <div className="mt-4 rounded-2xl border border-[color:var(--border)] bg-slate-50/90 p-5 dark:bg-slate-950/50">
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                    <div>
                                        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-300">
                                            Focused Job
                                        </p>
                                        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                                            Shareable link target: `?job={expandedJobId}`
                                        </p>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        <Link
                                            href={`/admin/jobs/${encodeURIComponent(expandedJobId)}`}
                                            className="fc-button-secondary px-3 py-2 text-xs font-semibold"
                                        >
                                            Open full page
                                        </Link>
                                        <button
                                            type="button"
                                            onClick={() => handleJobSelection(expandedJobId)}
                                            className="fc-button-secondary px-3 py-2 text-xs font-semibold"
                                        >
                                            Clear focus
                                        </button>
                                    </div>
                                </div>

                                {isFocusedJobLoading ? (
                                    <p className="mt-4 text-sm text-slate-500 dark:text-slate-300">Loading latest job detail...</p>
                                ) : null}
                                {focusedJobError ? (
                                    <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
                                        {focusedJobError}
                                    </div>
                                ) : null}
                                {focusedJob ? (
                                    <div className="mt-4 grid gap-4 sm:grid-cols-2">
                                        <div className="rounded-2xl border border-[color:var(--border)] bg-white/80 p-4 dark:bg-slate-900/60">
                                            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{focusedJob.id}</p>
                                            <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">
                                                Status {focusedJob.status} | Output {focusedJob.outputMode}
                                            </p>
                                            <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                                                Project {focusedJob.projectId || "unknown"} | Version {focusedJob.versionId || "unknown"}
                                            </p>
                                            <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                                                Snapshot {focusedJob.workspaceSnapshotId || "n/a"}
                                            </p>
                                            <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                                                Updated {formatTimestamp(focusedJob.updatedAt)}
                                            </p>
                                        </div>
                                        <div className="rounded-2xl border border-[color:var(--border)] bg-white/80 p-4 dark:bg-slate-900/60">
                                            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-300">
                                                Quality Signals
                                            </p>
                                            <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">
                                                Preflight {focusedJob.preflightReport ? (focusedJob.preflightReport.pass ? "passed" : "blocked") : "not recorded"}
                                            </p>
                                            <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                                                Remediation hints {focusedJob.remediationHints?.length ?? 0} | Files {focusedJob.artifactManifest?.fileCount ?? 0}
                                            </p>
                                            <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                                                Release intent {focusedJob.releaseIntent || "not set"}
                                            </p>
                                            {focusedJob.errorMessage ? (
                                                <p className="mt-2 text-xs text-rose-600 dark:text-rose-300">
                                                    {focusedJob.errorCode || "ERROR"}: {focusedJob.errorMessage}
                                                </p>
                                            ) : null}
                                        </div>
                                    </div>
                                ) : null}
                            </div>
                        ) : null}
                        <div className="mt-4 space-y-3">
                            {jobs.length > 0 ? jobs.map((job) => (
                                <div
                                    key={job.id}
                                    className={`rounded-2xl border p-4 text-sm dark:bg-slate-900/60 ${expandedJobId === job.id ? "border-sky-300 bg-sky-50/70 dark:border-sky-800 dark:bg-sky-950/20" : "border-[color:var(--border)] bg-white/70"}`}
                                >
                                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                        <div className="flex flex-wrap items-center gap-3">
                                            <p className="font-semibold text-slate-900 dark:text-slate-100">{job.id}</p>
                                            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${jobStatusClasses(job.status)}`}>
                                                {job.status}
                                            </span>
                                            <span className="text-xs text-slate-500 dark:text-slate-300">{job.outputMode}</span>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => handleJobSelection(job.id)}
                                            className="fc-button-secondary px-3 py-2 text-xs font-semibold"
                                        >
                                            {expandedJobId === job.id ? "Hide detail" : "Open detail"}
                                        </button>
                                        <Link
                                            href={`/admin/jobs/${encodeURIComponent(job.id)}`}
                                            className="fc-button-secondary px-3 py-2 text-xs font-semibold"
                                        >
                                            Full page
                                        </Link>
                                    </div>
                                    <p className="mt-2 text-slate-600 dark:text-slate-300">
                                        {job.projectId || "unknown project"} | {job.versionId || "unknown version"}
                                    </p>
                                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-300">
                                        Snapshot: {job.workspaceSnapshotId || "n/a"} | Updated {formatTimestamp(job.updatedAt)}
                                    </p>
                                    {job.artifactManifest ? (
                                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-300">
                                            Files: {job.artifactManifest.fileCount} | Template: {job.artifactManifest.templateKind || "auto"}
                                        </p>
                                    ) : null}
                                    {job.errorMessage ? (
                                        <p className="mt-2 text-xs text-rose-600 dark:text-rose-300">
                                            {job.errorCode || "ERROR"}: {job.errorMessage}
                                        </p>
                                    ) : null}

                                    {expandedJobId === job.id ? (
                                        <div className="mt-4 space-y-3 rounded-2xl border border-[color:var(--border)] bg-slate-50/90 p-4 dark:bg-slate-950/50">
                                            <div className="grid gap-3 sm:grid-cols-2">
                                                <div>
                                                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-300">
                                                        Lifecycle
                                                    </p>
                                                    <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">Created: {formatTimestamp(job.createdAt)}</p>
                                                    <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">Updated: {formatTimestamp(job.updatedAt)}</p>
                                                    <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">Release intent: {job.releaseIntent || "not set"}</p>
                                                </div>
                                                <div>
                                                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-300">
                                                        Artifacts
                                                    </p>
                                                    <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">Workspace snapshot: {job.workspaceSnapshotId || "n/a"}</p>
                                                    <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">Template: {job.templateKind || "auto"}</p>
                                                    <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">File count: {job.artifactManifest?.fileCount ?? 0}</p>
                                                </div>
                                            </div>

                                            {job.preflightReport ? (
                                                <div>
                                                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-300">
                                                        Preflight
                                                    </p>
                                                    <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">
                                                        {job.preflightReport.pass ? "Passed" : "Blocked"} | Coverage {job.preflightReport.planCoveragePct}% | Missing deps {job.preflightReport.missingDepsCount}
                                                    </p>
                                                    {job.preflightReport.issues.length > 0 ? (
                                                        <div className="mt-2 space-y-2">
                                                            {job.preflightReport.issues.slice(0, 4).map((issue) => (
                                                                <div
                                                                    key={`${job.id}-${issue.code}-${issue.message}`}
                                                                    className="rounded-xl border border-[color:var(--border)] bg-white/80 px-3 py-2 text-xs dark:bg-slate-900/60"
                                                                >
                                                                    <p className="font-semibold text-slate-900 dark:text-slate-100">{issue.code}</p>
                                                                    <p className="mt-1 text-slate-600 dark:text-slate-300">{issue.message}</p>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    ) : null}
                                                </div>
                                            ) : null}

                                            {job.remediationHints && job.remediationHints.length > 0 ? (
                                                <div>
                                                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-300">
                                                        Remediation
                                                    </p>
                                                    <div className="mt-2 space-y-2">
                                                        {job.remediationHints.slice(0, 4).map((hint) => (
                                                            <div
                                                                key={`${job.id}-${hint.code}-${hint.message}`}
                                                                className="rounded-xl border border-[color:var(--border)] bg-white/80 px-3 py-2 text-xs dark:bg-slate-900/60"
                                                            >
                                                                <p className="font-semibold text-slate-900 dark:text-slate-100">
                                                                    {hint.code} | {hint.severity}
                                                                </p>
                                                                <p className="mt-1 text-slate-600 dark:text-slate-300">{hint.message}</p>
                                                                {hint.action ? (
                                                                    <p className="mt-1 text-slate-500 dark:text-slate-300">{hint.action}</p>
                                                                ) : null}
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            ) : null}

                                            {job.artifactManifest?.files?.length ? (
                                                <div>
                                                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-300">
                                                        Artifact preview
                                                    </p>
                                                    <div className="mt-2 space-y-1">
                                                        {job.artifactManifest.files.slice(0, 6).map((file) => (
                                                            <p key={`${job.id}-${file.path}`} className="text-xs text-slate-600 dark:text-slate-300">
                                                                {file.nodeType === "folder" ? "[dir]" : "[file]"} {file.path}
                                                            </p>
                                                        ))}
                                                    </div>
                                                </div>
                                            ) : null}
                                        </div>
                                    ) : null}
                                </div>
                            )) : (
                                <p className="mt-4 text-sm text-slate-500 dark:text-slate-300">No generation jobs tracked yet.</p>
                            )}
                        </div>
                    </article>

                    <div className="space-y-6">
                        <AdminObservabilityPanel initialSnapshot={props.observabilitySnapshot} />
                        <AdminOperationsPanel initialEvents={props.operationEvents} />
                        <AdminAuditPanel initialEvents={props.auditEvents} />
                        {expandedWebhookId ? (
                            <article className="fc-surface-strong rounded-[var(--radius-2xl)] p-6">
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                    <div>
                                        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Focused Webhook</h2>
                                        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                                            Shareable link target: `?webhook={expandedWebhookId}`
                                        </p>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        <Link
                                            href={`/admin/webhooks/stripe/${encodeURIComponent(expandedWebhookId)}`}
                                            className="fc-button-secondary px-3 py-2 text-xs font-semibold"
                                        >
                                            Open full page
                                        </Link>
                                        <button
                                            type="button"
                                            onClick={() => handleWebhookSelection(expandedWebhookId)}
                                            className="fc-button-secondary px-3 py-2 text-xs font-semibold"
                                        >
                                            Clear focus
                                        </button>
                                    </div>
                                </div>

                                {isFocusedWebhookLoading ? (
                                    <p className="mt-4 text-sm text-slate-500 dark:text-slate-300">Loading latest webhook detail...</p>
                                ) : null}
                                {focusedWebhookError ? (
                                    <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
                                        {focusedWebhookError}
                                    </div>
                                ) : null}
                                {focusedWebhook ? (
                                    <div className="mt-4 space-y-3">
                                        <div className="rounded-2xl border border-[color:var(--border)] bg-white/80 p-4 text-sm dark:bg-slate-900/60">
                                            <p className="font-semibold text-slate-900 dark:text-slate-100">{focusedWebhook.eventName}</p>
                                            <p className="mt-1 text-xs text-slate-500 dark:text-slate-300">{focusedWebhook.eventId}</p>
                                            <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">
                                                Processed {formatTimestamp(focusedWebhook.processedAt)} | Replays {focusedWebhook.replayCount || 0}
                                            </p>
                                            <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                                                Last replay {focusedWebhook.lastReplayStatus || "n/a"} | {focusedWebhook.lastReplayedAt ? formatTimestamp(focusedWebhook.lastReplayedAt) : "Never"}
                                            </p>
                                            {focusedWebhook.lastReplayError ? (
                                                <p className="mt-2 text-xs text-rose-600 dark:text-rose-300">{focusedWebhook.lastReplayError}</p>
                                            ) : null}
                                        </div>
                                        <div className="rounded-2xl border border-[color:var(--border)] bg-white/80 p-4 dark:bg-slate-900/60">
                                            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-300">Payload Preview</p>
                                            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words text-xs text-slate-600 dark:text-slate-300">
                                                {focusedWebhook.payload.slice(0, 1600) || "No payload stored."}
                                            </pre>
                                        </div>
                                    </div>
                                ) : null}
                            </article>
                        ) : null}
                        <AdminStripeWebhookPanel
                            initialEvents={props.webhookEvents}
                            canOperate={canOperate}
                            focusedEventId={expandedWebhookId}
                            onSelectEvent={handleWebhookSelection}
                        />

                        <article className="fc-surface-strong rounded-[var(--radius-2xl)] p-6">
                            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Tracked Workspaces</h2>
                            <div className="mt-4 space-y-3">
                                {props.workspaces.length > 0 ? props.workspaces.map((workspace) => (
                                    <div
                                        key={workspace.ownerUserId}
                                        className="rounded-2xl border border-[color:var(--border)] bg-white/70 p-4 text-sm dark:bg-slate-900/60"
                                    >
                                        <p className="font-semibold text-slate-900 dark:text-slate-100">{workspace.ownerUserId}</p>
                                        <p className="mt-1 text-slate-600 dark:text-slate-300">
                                            Revision {workspace.revision} | {workspace.projectCount} projects
                                        </p>
                                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-300">{workspace.latestSnapshotSummary}</p>
                                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-300">Updated {formatTimestamp(workspace.updatedAt)}</p>
                                    </div>
                                )) : (
                                    <p className="mt-4 text-sm text-slate-500 dark:text-slate-300">No workspaces tracked yet.</p>
                                )}
                            </div>
                        </article>

                        <article className="fc-surface-strong rounded-[var(--radius-2xl)] p-6">
                            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Tenants</h2>
                            <div className="mt-4 space-y-3">
                                {props.tenants.length > 0 ? props.tenants.map((tenant) => (
                                    <div
                                        key={tenant.id}
                                        className="rounded-2xl border border-[color:var(--border)] bg-white/70 p-4 text-sm dark:bg-slate-900/60"
                                    >
                                        <p className="font-semibold text-slate-900 dark:text-slate-100">{tenant.name}</p>
                                        <p className="mt-1 text-slate-600 dark:text-slate-300">{tenant.slug} | {tenant.status}</p>
                                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-300">Workspaces: {tenant.workspaceCount}</p>
                                    </div>
                                )) : (
                                    <p className="mt-4 text-sm text-slate-500 dark:text-slate-300">No tenants provisioned yet.</p>
                                )}
                            </div>
                        </article>
                    </div>
                </section>
            </div>
        </main>
    );
}
