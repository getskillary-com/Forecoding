"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useTransition, type FormEvent } from "react";
import { AdminAuditPanel } from "@/components/AdminAuditPanel";
import { AdminObservabilityPanel } from "@/components/AdminObservabilityPanel";
import { AdminOperationsPanel } from "@/components/AdminOperationsPanel";
import { AdminStripeWebhookPanel } from "@/components/AdminStripeWebhookPanel";
import type { AdminCapability, AdminRole } from "@/lib/admin";
import type { RuntimePreflightResult } from "@/lib/runtime-preflight";
import type {
    AuditEvent,
    BillingEvent,
    FeatureFlag,
    GenerationJob,
    Org,
    ObservabilitySnapshot,
    ProjectPurchase,
    TaskRun,
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
    approvalStatus?: "pending" | "approved" | "rejected";
    approvalNote?: string | null;
    approvedBy?: string | null;
    approvedAt?: number | null;
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
    tenantId?: string | null;
    revision: number;
    projectCount: number;
    updatedAt: number;
    latestSnapshotSummary: string;
};

type AdminUserSummary = {
    uid: string;
    email: string;
    tenantId: string | null;
    status: "active" | "suspended";
    statusReason: string | null;
    name: string | null;
    sessionVersion: number;
    statusUpdatedAt: number | null;
    createdAt: number | null;
    updatedAt: number | null;
};

type AdminTaskRunSummary = {
    id: string;
    ownerUserId: string;
    tenantId: string | null;
    projectId: string;
    projectName: string;
    versionId: string;
    versionName: string;
    taskId: string;
    taskTitle: string;
    taskOwner: string;
    taskDefinitionStatus: "pending" | "ready" | "blocked" | null;
    runStatus: TaskRun["status"];
    attempt: number | null;
    startedAt: number | null;
    finishedAt: number | null;
    resultSummary: string | null;
    remediationHint: string | null;
    rollbackExecuted: boolean;
    updatedAt: number;
};

type Props = {
    email: string;
    role: AdminRole;
    capabilities: AdminCapability[];
    runtimePreflight: RuntimePreflightResult;
    auditEvents: AuditEvent[];
    operationEvents: AuditEvent[];
    observabilitySnapshot: ObservabilitySnapshot;
    featureFlags: FeatureFlag[];
    jobs: GenerationJob[];
    taskRuns: AdminTaskRunSummary[];
    billingEvents: BillingEvent[];
    purchases: ProjectPurchase[];
    orgs: Org[];
    tenants: Tenant[];
    users: AdminUserSummary[];
    releases: ReleaseSummary[];
    workspaces: WorkspaceEnvelopeSummary[];
    webhookEvents: WebhookEventRecord[];
};

function formatTimestamp(value: number) {
    return new Date(value).toLocaleString();
}

function formatMoneyCents(amountCents: number, currency: string) {
    const normalized = (currency || "usd").toUpperCase();
    try {
        return new Intl.NumberFormat(undefined, {
            style: "currency",
            currency: normalized
        }).format((amountCents || 0) / 100);
    } catch {
        return `${(amountCents || 0) / 100} ${normalized}`;
    }
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

function buildFlagIdentity(flag: Pick<FeatureFlag, "key" | "scope" | "scopeId">) {
    return `${flag.key}::${flag.scope}::${flag.scopeId || "global"}`;
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

function taskRunStatusClasses(status: TaskRun["status"]) {
    if (status === "succeeded") {
        return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300";
    }
    if (status === "failed" || status === "blocked") {
        return "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300";
    }
    if (status === "running") {
        return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300";
    }
    return "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300";
}

function normalizeReleaseApprovalStatus(status?: ReleaseSummary["approvalStatus"]) {
    if (status === "pending" || status === "rejected") {
        return status;
    }
    return "approved";
}

function releaseApprovalBadgeClasses(status?: ReleaseSummary["approvalStatus"]) {
    const normalized = normalizeReleaseApprovalStatus(status);
    if (normalized === "approved") {
        return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300";
    }
    if (normalized === "rejected") {
        return "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300";
    }
    return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300";
}

function releaseApprovalLabel(status?: ReleaseSummary["approvalStatus"]) {
    const normalized = normalizeReleaseApprovalStatus(status);
    if (normalized === "approved") return "Approved";
    if (normalized === "rejected") return "Rejected";
    return "Pending";
}

type GovernanceFlagControl = {
    key: string;
    label: string;
    description: string;
    fallbackEnabled: boolean;
};

const GOVERNANCE_FLAG_CONTROLS: GovernanceFlagControl[] = [
    {
        key: "generation.enabled",
        label: "Generation",
        description: "Controls scaffold generation for non-admin users.",
        fallbackEnabled: true
    },
    {
        key: "releases.publish.enabled",
        label: "Release publish",
        description: "Controls release tag publishing operations.",
        fallbackEnabled: true
    },
    {
        key: "releases.approval.enabled",
        label: "Release approval",
        description: "Controls release approve/reject operations.",
        fallbackEnabled: true
    },
    {
        key: "releases.rollback.enabled",
        label: "Release rollback",
        description: "Controls rollback execution for release tags.",
        fallbackEnabled: true
    },
    {
        key: "stripe.webhook_replay.enabled",
        label: "Webhook replay",
        description: "Controls Stripe webhook replay from admin console.",
        fallbackEnabled: true
    }
];

function governanceFlagActionLabel(key: string, enabled: boolean) {
    if (key === "generation.enabled") {
        return enabled ? "Freeze generation" : "Resume generation";
    }
    if (key.startsWith("releases.")) {
        return enabled ? "Pause operation" : "Resume operation";
    }
    if (key === "stripe.webhook_replay.enabled") {
        return enabled ? "Pause replay" : "Resume replay";
    }
    return enabled ? "Disable" : "Enable";
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
    const [taskRuns, setTaskRuns] = useState(props.taskRuns);
    const [billingEvents, setBillingEvents] = useState(props.billingEvents);
    const [purchases, setPurchases] = useState(props.purchases);
    const [orgs, setOrgs] = useState(props.orgs);
    const [tenants, setTenants] = useState(props.tenants);
    const [users, setUsers] = useState(props.users);
    const [workspaces, setWorkspaces] = useState(props.workspaces);
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
        scopeId: "",
        value: ""
    });
    const [releaseForm, setReleaseForm] = useState({
        ownerUserId: props.workspaces[0]?.ownerUserId || "",
        label: "",
        note: ""
    });
    const [busyFlagKey, setBusyFlagKey] = useState<string | null>(null);
    const [busyReleaseId, setBusyReleaseId] = useState<string | null>(null);
    const [busyReleaseApprovalId, setBusyReleaseApprovalId] = useState<string | null>(null);
    const [busyOrgId, setBusyOrgId] = useState<string | null>(null);
    const [busyTenantId, setBusyTenantId] = useState<string | null>(null);
    const [busyTenantOrgId, setBusyTenantOrgId] = useState<string | null>(null);
    const [busyUserId, setBusyUserId] = useState<string | null>(null);
    const [busyTaskReplayId, setBusyTaskReplayId] = useState<string | null>(null);
    const [busyWorkspaceOwnerId, setBusyWorkspaceOwnerId] = useState<string | null>(null);
    const [orgStatusDrafts, setOrgStatusDrafts] = useState<Record<string, Org["status"]>>({});
    const [tenantStatusDrafts, setTenantStatusDrafts] = useState<Record<string, Tenant["status"]>>({});
    const [tenantOrgDrafts, setTenantOrgDrafts] = useState<Record<string, string>>({});
    const [userStatusDrafts, setUserStatusDrafts] = useState<Record<string, AdminUserSummary["status"]>>({});
    const [userReasonDrafts, setUserReasonDrafts] = useState<Record<string, string>>({});
    const [workspaceTenantDrafts, setWorkspaceTenantDrafts] = useState<Record<string, string>>({});
    const [releaseApprovalNote, setReleaseApprovalNote] = useState("");
    const [pendingRollbackReleaseId, setPendingRollbackReleaseId] = useState<string | null>(null);
    const [isSavingFlag, setIsSavingFlag] = useState(false);
    const [isPublishingRelease, setIsPublishingRelease] = useState(false);
    const [isRefreshingJobs, setIsRefreshingJobs] = useState(false);
    const [isRefreshingTaskRuns, setIsRefreshingTaskRuns] = useState(false);
    const [isRefreshingBilling, setIsRefreshingBilling] = useState(false);
    const [isSubmittingRefund, setIsSubmittingRefund] = useState(false);
    const [jobQuery, setJobQuery] = useState("");
    const [jobStatus, setJobStatus] = useState<"" | GenerationJob["status"]>("");
    const [jobOutputMode, setJobOutputMode] = useState<"" | "virtual_spec" | "runnable_scaffold">("");
    const [taskRunQuery, setTaskRunQuery] = useState("");
    const [taskRunStatus, setTaskRunStatus] = useState<"" | TaskRun["status"]>("");
    const [taskRunTenantId, setTaskRunTenantId] = useState("");
    const [taskRunOwnerUserId, setTaskRunOwnerUserId] = useState("");
    const [billingQuery, setBillingQuery] = useState("");
    const [billingProvider, setBillingProvider] = useState<"" | BillingEvent["provider"]>("");
    const [billingStatus, setBillingStatus] = useState<"" | BillingEvent["status"]>("");
    const [billingTenantId, setBillingTenantId] = useState("");
    const [billingWorkspaceSnapshotId, setBillingWorkspaceSnapshotId] = useState("");
    const [purchaseQuery, setPurchaseQuery] = useState("");
    const [purchaseProvider, setPurchaseProvider] = useState<"" | ProjectPurchase["provider"]>("");
    const [purchaseStatus, setPurchaseStatus] = useState<"" | ProjectPurchase["status"]>("");
    const [purchaseTenantId, setPurchaseTenantId] = useState("");
    const [purchaseWorkspaceSnapshotId, setPurchaseWorkspaceSnapshotId] = useState("");
    const [userQuery, setUserQuery] = useState("");
    const [userStatusFilter, setUserStatusFilter] = useState<"" | AdminUserSummary["status"]>("");
    const [userTenantIdFilter, setUserTenantIdFilter] = useState("");
    const [isRefreshingUsers, setIsRefreshingUsers] = useState(false);
    const [refundForm, setRefundForm] = useState({
        userId: "",
        projectId: "",
        paymentIntentId: "",
        amountCents: "",
        reason: "" as "" | "duplicate" | "fraudulent" | "requested_by_customer",
        note: "",
        manualOnly: false
    });
    const [feedback, setFeedback] = useState<{ tone: "success" | "error"; message: string } | null>(null);

    const capabilitySet = useMemo(() => new Set(props.capabilities), [props.capabilities]);
    const canManageFlags = capabilitySet.has("feature_flags_write");
    const canManageOrgs = capabilitySet.has("orgs_manage");
    const canManageBilling = capabilitySet.has("billing_manage");
    const canManageUsers = capabilitySet.has("users_manage");
    const canManageTasks = capabilitySet.has("tasks_manage");
    const canPublishReleases = capabilitySet.has("releases_publish");
    const canApproveReleases = capabilitySet.has("releases_approve");
    const canRollbackReleases = capabilitySet.has("releases_rollback");
    const canReplayWebhooks = capabilitySet.has("webhooks_replay");
    const canManageTenants = capabilitySet.has("tenants_manage");
    const runtimePreflightErrorCount = props.runtimePreflight.issues.filter((issue) => issue.severity === "error").length;
    const runtimePreflightWarningCount = props.runtimePreflight.issues.filter((issue) => issue.severity === "warning").length;
    const statusTone = feedback?.tone === "error"
        ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300"
        : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300";

    const sortedFlags = useMemo(
        () => [...featureFlags].sort((left, right) => {
            const leftIdentity = `${left.key}::${left.scope}::${left.scopeId || ""}`;
            const rightIdentity = `${right.key}::${right.scope}::${right.scopeId || ""}`;
            return leftIdentity.localeCompare(rightIdentity);
        }),
        [featureFlags]
    );

    const sortedBillingEvents = useMemo(
        () => [...billingEvents].sort((left, right) => right.createdAt - left.createdAt),
        [billingEvents]
    );

    const sortedPurchases = useMemo(
        () => [...purchases].sort((left, right) => right.updatedAt - left.updatedAt),
        [purchases]
    );

    const sortedUsers = useMemo(
        () => [...users].sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0)),
        [users]
    );

    const sortedTaskRuns = useMemo(
        () => [...taskRuns].sort((left, right) => right.updatedAt - left.updatedAt),
        [taskRuns]
    );

    const governanceFlagStates = useMemo(() => {
        return GOVERNANCE_FLAG_CONTROLS.map((control) => {
            const globalFlags = featureFlags
                .filter((flag) => flag.key === control.key && flag.scope === "global")
                .sort((left, right) => right.updatedAt - left.updatedAt);
            const selected = globalFlags[0] || null;
            const enabled = selected ? selected.enabled : control.fallbackEnabled;
            return {
                ...control,
                flag: selected,
                enabled,
                identity: buildFlagIdentity({
                    key: control.key,
                    scope: "global",
                    scopeId: null
                })
            };
        });
    }, [featureFlags]);

    useEffect(() => {
        setReleaseApprovalNote("");
    }, [expandedReleaseId]);

    useEffect(() => {
        if (flagForm.scope === "global") {
            if (flagForm.scopeId) {
                setFlagForm((current) => ({ ...current, scopeId: "" }));
            }
            return;
        }

        if (flagForm.scope === "tenant") {
            if (flagForm.scopeId) return;
            const defaultTenantId = tenants[0]?.id || "";
            if (defaultTenantId) {
                setFlagForm((current) => current.scope === "tenant" && !current.scopeId
                    ? { ...current, scopeId: defaultTenantId }
                    : current);
            }
            return;
        }

        if (flagForm.scope === "workspace") {
            if (flagForm.scopeId) return;
            const defaultWorkspaceId = workspaces[0]?.ownerUserId || "";
            if (defaultWorkspaceId) {
                setFlagForm((current) => current.scope === "workspace" && !current.scopeId
                    ? { ...current, scopeId: defaultWorkspaceId }
                    : current);
            }
        }
    }, [flagForm.scope, flagForm.scopeId, tenants, workspaces]);
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

    const refreshTaskRuns = async (overrides?: {
        query?: string;
        status?: "" | TaskRun["status"];
        tenantId?: string;
        ownerUserId?: string;
    }) => {
        setIsRefreshingTaskRuns(true);
        setFeedback(null);
        try {
            const nextQuery = (overrides?.query ?? taskRunQuery).trim();
            const nextStatus = overrides?.status ?? taskRunStatus;
            const nextTenantId = (overrides?.tenantId ?? taskRunTenantId).trim();
            const nextOwnerUserId = (overrides?.ownerUserId ?? taskRunOwnerUserId).trim();

            const params = new URLSearchParams();
            if (nextQuery) params.set("query", nextQuery);
            if (nextStatus) params.set("status", nextStatus);
            if (nextTenantId) params.set("tenantId", nextTenantId);
            if (nextOwnerUserId) params.set("ownerUserId", nextOwnerUserId);
            params.set("limit", "20");

            const response = await fetch(`/api/admin/tasks/runs?${params.toString()}`, {
                cache: "no-store"
            });
            const payload = (await response.json()) as {
                taskRuns?: AdminTaskRunSummary[];
                error?: string;
            };
            if (!response.ok || !Array.isArray(payload.taskRuns)) {
                throw new Error(payload.error || "Failed to refresh task runs.");
            }
            setTaskRuns(payload.taskRuns);
            setFeedback({
                tone: "success",
                message: "Task run records refreshed."
            });
        } catch (error) {
            setFeedback({
                tone: "error",
                message: error instanceof Error ? error.message : "Failed to refresh task runs."
            });
        } finally {
            setIsRefreshingTaskRuns(false);
        }
    };

    const handleTaskRunReplay = async (
        taskRun: AdminTaskRunSummary,
        mode: "strict" | "retry_failed"
    ) => {
        if (!canManageTasks) return;

        setBusyTaskReplayId(taskRun.id);
        setFeedback(null);
        try {
            const response = await fetch("/api/admin/tasks/runs/replay", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    ownerUserId: taskRun.ownerUserId,
                    projectId: taskRun.projectId,
                    versionId: taskRun.versionId,
                    mode
                })
            });
            const payload = (await response.json()) as {
                ok?: boolean;
                runCount?: number;
                revision?: number | null;
                error?: string;
            };
            if (!response.ok || !payload.ok) {
                throw new Error(payload.error || "Failed to replay task DAG.");
            }

            setFeedback({
                tone: "success",
                message: `Task DAG replayed for ${taskRun.projectId}/${taskRun.versionId} (${mode}), ${payload.runCount ?? 0} run(s) appended${payload.revision ? `, revision r${payload.revision}` : ""}.`
            });
            await refreshTaskRuns({
                query: taskRunQuery,
                status: taskRunStatus,
                tenantId: taskRunTenantId,
                ownerUserId: taskRunOwnerUserId
            });
            refreshAll();
        } catch (error) {
            setFeedback({
                tone: "error",
                message: error instanceof Error ? error.message : "Failed to replay task DAG."
            });
        } finally {
            setBusyTaskReplayId(null);
        }
    };

    const refreshBillingData = async (overrides?: {
        billingQuery?: string;
        billingProvider?: "" | BillingEvent["provider"];
        billingStatus?: "" | BillingEvent["status"];
        billingTenantId?: string;
        billingWorkspaceSnapshotId?: string;
        purchaseQuery?: string;
        purchaseProvider?: "" | ProjectPurchase["provider"];
        purchaseStatus?: "" | ProjectPurchase["status"];
        purchaseTenantId?: string;
        purchaseWorkspaceSnapshotId?: string;
    }) => {
        setIsRefreshingBilling(true);
        setFeedback(null);
        try {
            const nextBillingQuery = (overrides?.billingQuery ?? billingQuery).trim();
            const nextBillingProvider = overrides?.billingProvider ?? billingProvider;
            const nextBillingStatus = overrides?.billingStatus ?? billingStatus;
            const nextBillingTenantId = (overrides?.billingTenantId ?? billingTenantId).trim();
            const nextBillingWorkspaceSnapshotId = (overrides?.billingWorkspaceSnapshotId ?? billingWorkspaceSnapshotId).trim();

            const nextPurchaseQuery = (overrides?.purchaseQuery ?? purchaseQuery).trim();
            const nextPurchaseProvider = overrides?.purchaseProvider ?? purchaseProvider;
            const nextPurchaseStatus = overrides?.purchaseStatus ?? purchaseStatus;
            const nextPurchaseTenantId = (overrides?.purchaseTenantId ?? purchaseTenantId).trim();
            const nextPurchaseWorkspaceSnapshotId = (overrides?.purchaseWorkspaceSnapshotId ?? purchaseWorkspaceSnapshotId).trim();

            const billingParams = new URLSearchParams();
            if (nextBillingQuery) billingParams.set("query", nextBillingQuery);
            if (nextBillingProvider) billingParams.set("provider", nextBillingProvider);
            if (nextBillingStatus) billingParams.set("status", nextBillingStatus);
            if (nextBillingTenantId) billingParams.set("tenantId", nextBillingTenantId);
            if (nextBillingWorkspaceSnapshotId) billingParams.set("workspaceSnapshotId", nextBillingWorkspaceSnapshotId);
            billingParams.set("limit", "20");

            const purchaseParams = new URLSearchParams();
            if (nextPurchaseQuery) purchaseParams.set("query", nextPurchaseQuery);
            if (nextPurchaseProvider) purchaseParams.set("provider", nextPurchaseProvider);
            if (nextPurchaseStatus) purchaseParams.set("status", nextPurchaseStatus);
            if (nextPurchaseTenantId) purchaseParams.set("tenantId", nextPurchaseTenantId);
            if (nextPurchaseWorkspaceSnapshotId) purchaseParams.set("workspaceSnapshotId", nextPurchaseWorkspaceSnapshotId);
            purchaseParams.set("limit", "20");

            const [eventsResponse, purchasesResponse] = await Promise.all([
                fetch(`/api/admin/billing/events?${billingParams.toString()}`, { cache: "no-store" }),
                fetch(`/api/admin/billing/purchases?${purchaseParams.toString()}`, { cache: "no-store" })
            ]);

            const eventsPayload = (await eventsResponse.json()) as { events?: BillingEvent[]; error?: string };
            const purchasesPayload = (await purchasesResponse.json()) as { purchases?: ProjectPurchase[]; error?: string };

            if (!eventsResponse.ok || !Array.isArray(eventsPayload.events)) {
                throw new Error(eventsPayload.error || "Failed to refresh billing events.");
            }
            if (!purchasesResponse.ok || !Array.isArray(purchasesPayload.purchases)) {
                throw new Error(purchasesPayload.error || "Failed to refresh purchases.");
            }

            setBillingEvents(eventsPayload.events);
            setPurchases(purchasesPayload.purchases);
            setFeedback({ tone: "success", message: "Billing lifecycle data refreshed." });
        } catch (error) {
            setFeedback({
                tone: "error",
                message: error instanceof Error ? error.message : "Failed to refresh billing lifecycle data."
            });
        } finally {
            setIsRefreshingBilling(false);
        }
    };

    const refreshUsers = async (overrides?: {
        query?: string;
        status?: "" | AdminUserSummary["status"];
        tenantId?: string;
    }) => {
        setIsRefreshingUsers(true);
        setFeedback(null);
        try {
            const nextQuery = (overrides?.query ?? userQuery).trim();
            const nextStatus = overrides?.status ?? userStatusFilter;
            const nextTenantId = (overrides?.tenantId ?? userTenantIdFilter).trim();

            const params = new URLSearchParams();
            if (nextQuery) params.set("query", nextQuery);
            if (nextStatus) params.set("status", nextStatus);
            if (nextTenantId) params.set("tenantId", nextTenantId);
            params.set("limit", "20");

            const response = await fetch(`/api/admin/users?${params.toString()}`, {
                cache: "no-store"
            });
            const payload = (await response.json()) as { users?: AdminUserSummary[]; error?: string };
            if (!response.ok || !Array.isArray(payload.users)) {
                throw new Error(payload.error || "Failed to refresh users.");
            }
            setUsers(payload.users);
            setFeedback({
                tone: "success",
                message: "User governance list refreshed."
            });
        } catch (error) {
            setFeedback({
                tone: "error",
                message: error instanceof Error ? error.message : "Failed to refresh users."
            });
        } finally {
            setIsRefreshingUsers(false);
        }
    };

    const handleUserStatusSave = async (uid: string) => {
        if (!canManageUsers) return;

        const user = users.find((item) => item.uid === uid);
        if (!user) return;

        const nextStatus = userStatusDrafts[uid] || user.status;
        const nextReason = (userReasonDrafts[uid] ?? user.statusReason ?? "").trim();
        if (nextStatus === user.status && nextReason === (user.statusReason || "")) {
            setFeedback({
                tone: "success",
                message: `User ${user.email || user.uid} is already ${user.status}.`
            });
            return;
        }

        setBusyUserId(uid);
        setFeedback(null);
        try {
            const response = await fetch("/api/admin/users", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    uid,
                    status: nextStatus,
                    reason: nextReason || undefined
                })
            });
            const payload = (await response.json()) as {
                user?: AdminUserSummary;
                error?: string;
            };
            if (!response.ok || !payload.user) {
                throw new Error(payload.error || "Failed to update user status.");
            }

            setUsers((current) => current.map((item) => item.uid === payload.user?.uid ? payload.user as AdminUserSummary : item));
            setUserStatusDrafts((current) => {
                const next = { ...current };
                delete next[uid];
                return next;
            });
            setUserReasonDrafts((current) => {
                const next = { ...current };
                delete next[uid];
                return next;
            });

            setFeedback({
                tone: "success",
                message: `User ${payload.user.email || payload.user.uid} updated to ${payload.user.status}.`
            });
            refreshAll();
        } catch (error) {
            setFeedback({
                tone: "error",
                message: error instanceof Error ? error.message : "Failed to update user status."
            });
        } finally {
            setBusyUserId(null);
        }
    };

    const prepareRefundForPurchase = (purchase: ProjectPurchase) => {
        setRefundForm((current) => ({
            ...current,
            userId: purchase.userId,
            projectId: purchase.projectId,
            paymentIntentId: purchase.paymentIntentId || "",
            amountCents: purchase.amount > 0 ? String(purchase.amount) : "",
            note: current.note,
            manualOnly: purchase.provider === "manual" ? true : current.manualOnly
        }));
    };

    const handleRefundSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!canManageBilling) return;

        setIsSubmittingRefund(true);
        setFeedback(null);
        try {
            const amountCentsRaw = refundForm.amountCents.trim();
            const parsedAmountCents = amountCentsRaw ? Number.parseInt(amountCentsRaw, 10) : NaN;
            if (amountCentsRaw && (!Number.isFinite(parsedAmountCents) || parsedAmountCents <= 0)) {
                throw new Error("Refund amount must be a positive integer in cents.");
            }

            const userId = refundForm.userId.trim();
            const projectId = refundForm.projectId.trim();
            const paymentIntentId = refundForm.paymentIntentId.trim();
            if ((!userId || !projectId) && !paymentIntentId) {
                throw new Error("Provide (userId + projectId) or paymentIntentId for refund.");
            }

            const body: Record<string, unknown> = {
                manualOnly: refundForm.manualOnly
            };
            if (userId && projectId) {
                body.userId = userId;
                body.projectId = projectId;
            }
            if (paymentIntentId) {
                body.paymentIntentId = paymentIntentId;
            }
            if (amountCentsRaw) {
                body.amountCents = parsedAmountCents;
            }
            if (refundForm.reason) {
                body.reason = refundForm.reason;
            }
            if (refundForm.note.trim()) {
                body.note = refundForm.note.trim();
            }

            const response = await fetch("/api/admin/billing/refund", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body)
            });
            const payload = (await response.json()) as {
                ok?: boolean;
                alreadyRefunded?: boolean;
                purchase?: ProjectPurchase;
                billingEvent?: BillingEvent;
                error?: string;
            };
            if (!response.ok || !payload.purchase) {
                throw new Error(payload.error || "Failed to submit refund request.");
            }

            if (payload.billingEvent) {
                setBillingEvents((current) => [payload.billingEvent as BillingEvent, ...current]
                    .sort((left, right) => right.createdAt - left.createdAt)
                    .slice(0, 20));
            }
            setPurchases((current) => {
                const exists = current.some((item) => item.id === payload.purchase?.id);
                const next = exists
                    ? current.map((item) => item.id === payload.purchase?.id ? payload.purchase as ProjectPurchase : item)
                    : [payload.purchase as ProjectPurchase, ...current];
                return next
                    .sort((left, right) => right.updatedAt - left.updatedAt)
                    .slice(0, 20);
            });

            setFeedback({
                tone: "success",
                message: payload.alreadyRefunded
                    ? `Purchase ${payload.purchase.id} was already refunded.`
                    : `Refund recorded for ${payload.purchase.userId}:${payload.purchase.projectId}.`
            });

            if (!payload.alreadyRefunded) {
                setRefundForm({
                    userId: "",
                    projectId: "",
                    paymentIntentId: "",
                    amountCents: "",
                    reason: "",
                    note: "",
                    manualOnly: false
                });
            }
            refreshAll();
        } catch (error) {
            setFeedback({
                tone: "error",
                message: error instanceof Error ? error.message : "Failed to submit refund request."
            });
        } finally {
            setIsSubmittingRefund(false);
        }
    };

    const upsertFlag = async (input: {
        key: string;
        description: string;
        enabled: boolean;
        scope: FeatureFlag["scope"];
        scopeId?: string | null;
        value?: string | number | boolean | null;
    }) => {
        setFeedback(null);
        const scopeId = (input.scopeId || "").trim() || null;
        const identity = buildFlagIdentity({
            key: input.key,
            scope: input.scope,
            scopeId
        });
        setBusyFlagKey(identity);
        try {
            const res = await fetch("/api/admin/flags", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    ...input,
                    scopeId
                })
            });
            const payload = (await res.json()) as { flag?: FeatureFlag; error?: string };
            if (!res.ok || !payload.flag) {
                throw new Error(payload.error || "Failed to save feature flag.");
            }
            const savedFlag = payload.flag;
            const savedIdentity = buildFlagIdentity(savedFlag);

            setFeatureFlags((current) => {
                const exists = current.some((flag) => buildFlagIdentity(flag) === savedIdentity);
                return exists
                    ? current.map((flag) => buildFlagIdentity(flag) === savedIdentity ? savedFlag : flag)
                    : [savedFlag, ...current];
            });
            setFeedback({
                tone: "success",
                message: `Feature flag ${savedFlag.key} (${savedFlag.scope}${savedFlag.scopeId ? `:${savedFlag.scopeId}` : ""}) saved.`
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
        if (!canManageFlags) return;

        setIsSavingFlag(true);
        try {
            await upsertFlag({
                key: flagForm.key.trim(),
                description: flagForm.description.trim(),
                enabled: true,
                scope: flagForm.scope,
                scopeId: flagForm.scope === "global" ? null : flagForm.scopeId.trim() || null,
                value: normalizeFlagValue(flagForm.value)
            });
            setFlagForm({
                key: "",
                description: "",
                scope: "global",
                scopeId: "",
                value: ""
            });
        } finally {
            setIsSavingFlag(false);
        }
    };

    const handleFlagToggle = async (flag: FeatureFlag) => {
        if (!canManageFlags) return;

        await upsertFlag({
            key: flag.key,
            description: flag.description,
            enabled: !flag.enabled,
            scope: flag.scope,
            scopeId: flag.scopeId ?? null,
            value: flag.value ?? null
        });
    };

    const handleGovernanceFlagToggle = async (
        controlKey: string,
        nextEnabled: boolean
    ) => {
        if (!canManageFlags) return;

        const control = governanceFlagStates.find((item) => item.key === controlKey);
        if (!control) return;

        await upsertFlag({
            key: control.key,
            description: control.flag?.description || control.description,
            enabled: nextEnabled,
            scope: "global",
            scopeId: null,
            value: control.flag?.value ?? null
        });
    };

    const handleReleasePublish = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!canPublishReleases) return;

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

    const applyReleaseUpdate = (release: ReleaseSummary) => {
        setReleases((current) => {
            const exists = current.some((item) => item.id === release.id);
            const next = exists
                ? current.map((item) => item.id === release.id ? { ...item, ...release } : item)
                : [release, ...current];
            return next
                .sort((left, right) => right.createdAt - left.createdAt)
                .slice(0, 12);
        });
        setFocusedRelease((current) => current?.id === release.id
            ? { ...current, ...release }
            : current);
        if (normalizeReleaseApprovalStatus(release.approvalStatus) !== "approved") {
            setPendingRollbackReleaseId((current) => current === release.id ? null : current);
        }
    };

    const handleReleaseApproval = async (
        release: ReleaseSummary | ReleaseDetail,
        decision: "approved" | "rejected"
    ) => {
        if (!canApproveReleases) return;

        setBusyReleaseApprovalId(release.id);
        setFeedback(null);
        try {
            const res = await fetch("/api/admin/releases/approve", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    ownerUserId: release.ownerUserId,
                    releaseTagId: release.id,
                    decision,
                    note: releaseApprovalNote.trim() || undefined
                })
            });
            const payload = (await res.json()) as { release?: ReleaseSummary; error?: string };
            if (!res.ok || !payload.release) {
                throw new Error(payload.error || "Failed to update release approval.");
            }

            applyReleaseUpdate(payload.release);
            setReleaseApprovalNote("");
            setFeedback({
                tone: "success",
                message: `${payload.release.label} marked as ${releaseApprovalLabel(payload.release.approvalStatus).toLowerCase()}.`
            });
            refreshAll();
        } catch (error) {
            setFeedback({
                tone: "error",
                message: error instanceof Error ? error.message : "Failed to update release approval."
            });
        } finally {
            setBusyReleaseApprovalId(null);
        }
    };

    const handleReleaseRollbackReview = (release: ReleaseSummary) => {
        if (!canRollbackReleases || !release.rollbackReady) return;

        setPendingRollbackReleaseId(release.id);
        if (expandedReleaseId !== release.id) {
            setExpandedReleaseId(release.id);
            setFocusedReleaseError(null);
            syncFocusSearchParam("release", release.id);
        }
    };

    const handleReleaseRollback = async (release: ReleaseSummary | ReleaseDetail) => {
        if (!canRollbackReleases || !release.rollbackReady) return;

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

    const handleTenantStatusSave = async (tenantId: string) => {
        if (!canManageTenants) return;

        const tenant = tenants.find((item) => item.id === tenantId);
        if (!tenant) return;

        const nextStatus = tenantStatusDrafts[tenantId] || tenant.status;
        if (nextStatus === tenant.status) {
            setFeedback({
                tone: "success",
                message: `Tenant ${tenant.slug} is already ${tenant.status}.`
            });
            return;
        }

        setBusyTenantId(tenantId);
        setFeedback(null);
        try {
            const response = await fetch("/api/admin/tenants", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    tenantId,
                    status: nextStatus
                })
            });
            const payload = (await response.json()) as { tenant?: Tenant; error?: string };
            if (!response.ok || !payload.tenant) {
                throw new Error(payload.error || "Failed to update tenant status.");
            }
            setTenants((current) => current.map((item) => item.id === payload.tenant?.id ? payload.tenant : item));
            setTenantStatusDrafts((current) => {
                const next = { ...current };
                delete next[tenantId];
                return next;
            });
            setFeedback({
                tone: "success",
                message: `Tenant ${payload.tenant.slug} updated to ${payload.tenant.status}.`
            });
            refreshAll();
        } catch (error) {
            setFeedback({
                tone: "error",
                message: error instanceof Error ? error.message : "Failed to update tenant status."
            });
        } finally {
            setBusyTenantId(null);
        }
    };

    const handleOrgStatusSave = async (orgId: string) => {
        if (!canManageOrgs) return;

        const org = orgs.find((item) => item.id === orgId);
        if (!org) return;

        const nextStatus = orgStatusDrafts[orgId] || org.status;
        if (nextStatus === org.status) {
            setFeedback({
                tone: "success",
                message: `Organization ${org.slug} is already ${org.status}.`
            });
            return;
        }

        setBusyOrgId(orgId);
        setFeedback(null);
        try {
            const response = await fetch("/api/admin/orgs", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    orgId,
                    status: nextStatus
                })
            });
            const payload = (await response.json()) as { org?: Org; error?: string };
            if (!response.ok || !payload.org) {
                throw new Error(payload.error || "Failed to update organization status.");
            }
            setOrgs((current) => current.map((item) => item.id === payload.org?.id ? payload.org : item));
            setOrgStatusDrafts((current) => {
                const next = { ...current };
                delete next[orgId];
                return next;
            });
            setFeedback({
                tone: "success",
                message: `Organization ${payload.org.slug} updated to ${payload.org.status}.`
            });
            refreshAll();
        } catch (error) {
            setFeedback({
                tone: "error",
                message: error instanceof Error ? error.message : "Failed to update organization status."
            });
        } finally {
            setBusyOrgId(null);
        }
    };

    const handleTenantOrgSave = async (tenantId: string) => {
        if (!canManageOrgs) return;

        const tenant = tenants.find((item) => item.id === tenantId);
        if (!tenant) return;

        const nextOrgId = (tenantOrgDrafts[tenantId] ?? tenant.orgId ?? "").trim();
        const normalizedNextOrgId = nextOrgId || null;
        const currentOrgId = tenant.orgId ?? null;

        if (normalizedNextOrgId === currentOrgId) {
            setFeedback({
                tone: "success",
                message: `Tenant ${tenant.slug} is already bound to ${currentOrgId || "unassigned"}.`
            });
            return;
        }

        setBusyTenantOrgId(tenantId);
        setFeedback(null);
        try {
            const response = await fetch("/api/admin/orgs/bind-tenant", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    tenantId,
                    orgId: normalizedNextOrgId
                })
            });
            const payload = (await response.json()) as {
                ok?: boolean;
                tenant?: Tenant;
                impactedOrgs?: Org[];
                error?: string;
            };
            if (!response.ok || !payload.ok || !payload.tenant) {
                throw new Error(payload.error || "Failed to bind tenant organization.");
            }

            setTenants((current) => current.map((item) => item.id === payload.tenant?.id ? payload.tenant : item));
            if (Array.isArray(payload.impactedOrgs) && payload.impactedOrgs.length > 0) {
                setOrgs((current) => {
                    const next = [...current];
                    payload.impactedOrgs?.forEach((org) => {
                        const index = next.findIndex((item) => item.id === org.id);
                        if (index >= 0) {
                            next[index] = org;
                        } else {
                            next.push(org);
                        }
                    });
                    return next.sort((left, right) => right.updatedAt - left.updatedAt);
                });
            }
            setTenantOrgDrafts((current) => {
                const next = { ...current };
                delete next[tenantId];
                return next;
            });
            setFeedback({
                tone: "success",
                message: `Tenant ${payload.tenant.slug} moved to ${payload.tenant.orgId || "unassigned"}.`
            });
            refreshAll();
        } catch (error) {
            setFeedback({
                tone: "error",
                message: error instanceof Error ? error.message : "Failed to bind tenant organization."
            });
        } finally {
            setBusyTenantOrgId(null);
        }
    };

    const handleWorkspaceTenantSave = async (ownerUserId: string) => {
        if (!canManageTenants) return;

        const workspace = workspaces.find((item) => item.ownerUserId === ownerUserId);
        if (!workspace) return;

        const nextTenantId = (workspaceTenantDrafts[ownerUserId] || workspace.tenantId || "").trim();
        if (!nextTenantId) {
            setFeedback({
                tone: "error",
                message: "Select a tenant before saving workspace assignment."
            });
            return;
        }

        if (nextTenantId === (workspace.tenantId || "")) {
            setFeedback({
                tone: "success",
                message: `Workspace ${ownerUserId} is already assigned to tenant ${nextTenantId}.`
            });
            return;
        }

        setBusyWorkspaceOwnerId(ownerUserId);
        setFeedback(null);
        try {
            const response = await fetch("/api/admin/tenants/rebind", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    ownerUserId,
                    tenantId: nextTenantId
                })
            });
            const payload = (await response.json()) as {
                ok?: boolean;
                tenantId?: string;
                workspaceRevision?: number | null;
                error?: string;
            };
            if (!response.ok || !payload.ok) {
                throw new Error(payload.error || "Failed to rebind workspace tenant.");
            }

            setWorkspaces((current) => current.map((item) => (
                item.ownerUserId === ownerUserId
                    ? {
                        ...item,
                        tenantId: payload.tenantId || nextTenantId
                    }
                    : item
            )));
            setWorkspaceTenantDrafts((current) => {
                const next = { ...current };
                delete next[ownerUserId];
                return next;
            });
            setFeedback({
                tone: "success",
                message: `Workspace ${ownerUserId} moved to tenant ${payload.tenantId || nextTenantId}${payload.workspaceRevision ? ` (r${payload.workspaceRevision})` : ""}.`
            });
            refreshAll();
        } catch (error) {
            setFeedback({
                tone: "error",
                message: error instanceof Error ? error.message : "Failed to rebind workspace tenant."
            });
        } finally {
            setBusyWorkspaceOwnerId(null);
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
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-300">Billing Events</p>
                        <p className="mt-2 text-3xl font-semibold text-slate-900 dark:text-slate-100">{sortedBillingEvents.length}</p>
                        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Provider event ledger entries visible for current filters.</p>
                    </article>
                    <article className="fc-surface-strong rounded-[var(--radius-2xl)] p-5">
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-300">Purchases</p>
                        <p className="mt-2 text-3xl font-semibold text-slate-900 dark:text-slate-100">{sortedPurchases.length}</p>
                        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Checkout-to-refund lifecycle records linked to projects.</p>
                    </article>
                    <article className="fc-surface-strong rounded-[var(--radius-2xl)] p-5">
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-300">Users</p>
                        <p className="mt-2 text-3xl font-semibold text-slate-900 dark:text-slate-100">{sortedUsers.length}</p>
                        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Identity records available for status governance.</p>
                    </article>
                    <article className="fc-surface-strong rounded-[var(--radius-2xl)] p-5">
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-300">Task Runs</p>
                        <p className="mt-2 text-3xl font-semibold text-slate-900 dark:text-slate-100">{sortedTaskRuns.length}</p>
                        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Recent workspace DAG executions across versions.</p>
                    </article>
                    <article className="fc-surface-strong rounded-[var(--radius-2xl)] p-5">
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-300">Tracked Workspaces</p>
                        <p className="mt-2 text-3xl font-semibold text-slate-900 dark:text-slate-100">{workspaces.length}</p>
                        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Workspace envelopes with revision-aware summaries.</p>
                    </article>
                    <article className="fc-surface-strong rounded-[var(--radius-2xl)] p-5 md:col-span-2 xl:col-span-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-300">Stripe Webhooks</p>
                        <p className="mt-2 text-3xl font-semibold text-slate-900 dark:text-slate-100">{props.webhookEvents.length}</p>
                        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Stored webhook payloads that can be replayed safely from the admin console.</p>
                    </article>
                    <article className="fc-surface-strong rounded-[var(--radius-2xl)] p-5 md:col-span-2 xl:col-span-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-300">Runtime Preflight</p>
                            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${props.runtimePreflight.pass ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" : "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300"}`}>
                                {props.runtimePreflight.pass ? "Pass" : "Action required"}
                            </span>
                        </div>
                        <p className="mt-2 text-3xl font-semibold text-slate-900 dark:text-slate-100">
                            {runtimePreflightErrorCount} error(s) | {runtimePreflightWarningCount} warning(s)
                        </p>
                        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                            Checked {formatTimestamp(props.runtimePreflight.checkedAt)}. Environment and provider prerequisites for auth, AI, Stripe, and governance.
                        </p>
                        {props.runtimePreflight.issues.length > 0 ? (
                            <div className="mt-3 grid gap-2 md:grid-cols-2">
                                {props.runtimePreflight.issues.slice(0, 6).map((issue) => (
                                    <div
                                        key={`${issue.code}-${issue.envKey || "none"}-${issue.message}`}
                                        className={`rounded-xl border px-3 py-2 text-xs ${issue.severity === "error" ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300" : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300"}`}
                                    >
                                        <p className="font-semibold">{issue.code}{issue.envKey ? ` (${issue.envKey})` : ""}</p>
                                        <p className="mt-1">{issue.message}</p>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-300">All required runtime preflight checks passed.</p>
                        )}
                    </article>
                </section>

                <section className="grid gap-6 xl:grid-cols-2">
                    <article className="fc-surface-strong rounded-[var(--radius-2xl)] p-6">
                        <div className="flex items-center justify-between gap-3">
                            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Feature Flags</h2>
                            <span className="text-xs text-slate-500 dark:text-slate-300">
                                {canManageFlags ? "Flag write enabled" : "Read-only role for flags"}
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
                                disabled={!canManageFlags || isSavingFlag}
                                className="rounded-xl border border-[color:var(--border)] bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:bg-slate-950 dark:text-slate-100"
                            />
                            <input
                                value={flagForm.description}
                                onChange={(event) => setFlagForm((current) => ({ ...current, description: event.target.value }))}
                                placeholder="What this flag controls"
                                disabled={!canManageFlags || isSavingFlag}
                                className="rounded-xl border border-[color:var(--border)] bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:bg-slate-950 dark:text-slate-100"
                            />
                            <div className="grid gap-3 sm:grid-cols-[140px_minmax(0,1fr)]">
                                <select
                                    value={flagForm.scope}
                                    onChange={(event) => {
                                        const nextScope = event.target.value as FeatureFlag["scope"];
                                        setFlagForm((current) => ({
                                            ...current,
                                            scope: nextScope,
                                            scopeId: nextScope === "global" ? "" : current.scopeId
                                        }));
                                    }}
                                    disabled={!canManageFlags || isSavingFlag}
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
                                    disabled={!canManageFlags || isSavingFlag}
                                    className="rounded-xl border border-[color:var(--border)] bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:bg-slate-950 dark:text-slate-100"
                                />
                            </div>
                            {flagForm.scope !== "global" ? (
                                flagForm.scope === "tenant" ? (
                                    <select
                                        value={flagForm.scopeId}
                                        onChange={(event) => setFlagForm((current) => ({ ...current, scopeId: event.target.value }))}
                                        disabled={!canManageFlags || isSavingFlag || tenants.length === 0}
                                        className="rounded-xl border border-[color:var(--border)] bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:bg-slate-950 dark:text-slate-100"
                                    >
                                        <option value="">Select tenant scope</option>
                                        {tenants.map((tenant) => (
                                            <option key={tenant.id} value={tenant.id}>
                                                {tenant.id} ({tenant.status})
                                            </option>
                                        ))}
                                    </select>
                                ) : (
                                    <select
                                        value={flagForm.scopeId}
                                        onChange={(event) => setFlagForm((current) => ({ ...current, scopeId: event.target.value }))}
                                        disabled={!canManageFlags || isSavingFlag || workspaces.length === 0}
                                        className="rounded-xl border border-[color:var(--border)] bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:bg-slate-950 dark:text-slate-100"
                                    >
                                        <option value="">Select workspace scope</option>
                                        {workspaces.map((workspace) => (
                                            <option key={workspace.ownerUserId} value={workspace.ownerUserId}>
                                                {workspace.ownerUserId} ({workspace.tenantId || "unassigned"})
                                            </option>
                                        ))}
                                    </select>
                                )
                            ) : null}
                            <button
                                type="submit"
                                disabled={
                                    !canManageFlags
                                    || isSavingFlag
                                    || !flagForm.key.trim()
                                    || (flagForm.scope !== "global" && !flagForm.scopeId.trim())
                                }
                                className="fc-button-primary px-4 py-2.5 text-sm font-semibold disabled:opacity-60"
                            >
                                {isSavingFlag ? "Saving flag..." : "Create enabled flag"}
                            </button>
                        </form>

                        <div className="mt-4 rounded-2xl border border-[color:var(--border)] bg-white/70 p-4 dark:bg-slate-900/60">
                            <div className="flex items-center justify-between gap-3">
                                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-300">
                                    Governance Quick Controls
                                </p>
                                <span className="text-xs text-slate-500 dark:text-slate-300">
                                    {canManageFlags ? "One-click pause/resume enabled" : "Read-only"}
                                </span>
                            </div>
                            <div className="mt-3 space-y-2">
                                {governanceFlagStates.map((control) => (
                                    <div
                                        key={control.key}
                                        className="rounded-xl border border-[color:var(--border)] bg-white/80 p-3 dark:bg-slate-900/60"
                                    >
                                        <div className="flex flex-wrap items-start justify-between gap-2">
                                            <div>
                                                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{control.label}</p>
                                                <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{control.description}</p>
                                                <p className="mt-1 text-xs text-slate-500 dark:text-slate-300">
                                                    Key: {control.key} | Effective state: {control.enabled ? "enabled" : "disabled"}
                                                </p>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => void handleGovernanceFlagToggle(control.key, !control.enabled)}
                                                disabled={!canManageFlags || busyFlagKey === control.identity}
                                                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition disabled:opacity-60 ${control.enabled ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"}`}
                                            >
                                                {busyFlagKey === control.identity
                                                    ? "Saving..."
                                                    : governanceFlagActionLabel(control.key, control.enabled)}
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="mt-4 space-y-3">
                            {sortedFlags.length > 0 ? sortedFlags.map((flag) => (
                                <div
                                    key={buildFlagIdentity(flag)}
                                    className="rounded-2xl border border-[color:var(--border)] bg-white/70 p-4 dark:bg-slate-900/60"
                                >
                                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                        <div>
                                            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{flag.key}</p>
                                            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{flag.description || "No description."}</p>
                                            <p className="mt-2 text-xs text-slate-500 dark:text-slate-300">
                                                Scope: {flag.scope}{flag.scopeId ? `:${flag.scopeId}` : ""} | Updated {formatTimestamp(flag.updatedAt)}
                                            </p>
                                            {flag.value !== null && flag.value !== undefined ? (
                                                <p className="mt-1 text-xs text-slate-500 dark:text-slate-300">Value: {String(flag.value)}</p>
                                            ) : null}
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => void handleFlagToggle(flag)}
                                            disabled={!canManageFlags || busyFlagKey === buildFlagIdentity(flag)}
                                            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition disabled:opacity-60 ${flag.enabled ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" : "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300"}`}
                                        >
                                            {busyFlagKey === buildFlagIdentity(flag) ? "Saving..." : flag.enabled ? "Disable" : "Enable"}
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
                                {canPublishReleases
                                    ? canApproveReleases
                                        ? "Publish + approval enabled"
                                        : "Ready to publish"
                                    : "Publish disabled for this role"}
                            </span>
                        </div>

                        <form
                            onSubmit={handleReleasePublish}
                            className="mt-4 grid gap-3 rounded-2xl border border-[color:var(--border)] bg-white/70 p-4 dark:bg-slate-900/60"
                        >
                            <select
                                value={releaseForm.ownerUserId}
                                onChange={(event) => setReleaseForm((current) => ({ ...current, ownerUserId: event.target.value }))}
                                disabled={!canPublishReleases || isPublishingRelease || workspaces.length === 0}
                                className="rounded-xl border border-[color:var(--border)] bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:bg-slate-950 dark:text-slate-100"
                            >
                                {workspaces.map((workspace) => (
                                    <option key={workspace.ownerUserId} value={workspace.ownerUserId}>
                                        {workspace.ownerUserId} | r{workspace.revision}
                                    </option>
                                ))}
                            </select>
                            <input
                                value={releaseForm.label}
                                onChange={(event) => setReleaseForm((current) => ({ ...current, label: event.target.value }))}
                                placeholder="Release label, e.g. r42-platform-ready"
                                disabled={!canPublishReleases || isPublishingRelease}
                                className="rounded-xl border border-[color:var(--border)] bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:bg-slate-950 dark:text-slate-100"
                            />
                            <input
                                value={releaseForm.note}
                                onChange={(event) => setReleaseForm((current) => ({ ...current, note: event.target.value }))}
                                placeholder="Optional release note"
                                disabled={!canPublishReleases || isPublishingRelease}
                                className="rounded-xl border border-[color:var(--border)] bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:bg-slate-950 dark:text-slate-100"
                            />
                            <button
                                type="submit"
                                disabled={!canPublishReleases || isPublishingRelease || !releaseForm.ownerUserId || !releaseForm.label.trim()}
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
                                            {canRollbackReleases && focusedRelease?.rollbackReady ? (
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
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{focusedRelease.label}</p>
                                                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${releaseApprovalBadgeClasses(focusedRelease.approvalStatus)}`}>
                                                            {releaseApprovalLabel(focusedRelease.approvalStatus)}
                                                        </span>
                                                    </div>
                                                    <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">Workspace {focusedRelease.ownerUserId}</p>
                                                    <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">Snapshot {focusedRelease.snapshotId}</p>
                                                    <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">Created {formatTimestamp(focusedRelease.createdAt)}</p>
                                                    {focusedRelease.approvedAt ? (
                                                        <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                                                            Decision at {formatTimestamp(focusedRelease.approvedAt)}
                                                            {focusedRelease.approvedBy ? ` by ${focusedRelease.approvedBy}` : ""}
                                                        </p>
                                                    ) : null}
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
                                                    <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                                                        Approval status: {releaseApprovalLabel(focusedRelease.approvalStatus)}
                                                    </p>
                                                    {focusedRelease.approvalNote ? (
                                                        <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                                                            Approval note: {focusedRelease.approvalNote}
                                                        </p>
                                                    ) : null}
                                                    {focusedRelease.rollbackReason ? (
                                                        <p className="mt-2 text-xs text-amber-600 dark:text-amber-300">{focusedRelease.rollbackReason}</p>
                                                    ) : null}
                                                </div>
                                            </div>

                                            <div className="rounded-2xl border border-[color:var(--border)] bg-white/80 p-4 dark:bg-slate-900/60">
                                                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                                    <div>
                                                        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-300">Release Approval</p>
                                                        <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">
                                                            Current state: {releaseApprovalLabel(focusedRelease.approvalStatus)}
                                                        </p>
                                                        <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                                                            Rollback is available only for approved releases with persisted snapshot payloads.
                                                        </p>
                                                    </div>
                                                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${releaseApprovalBadgeClasses(focusedRelease.approvalStatus)}`}>
                                                        {releaseApprovalLabel(focusedRelease.approvalStatus)}
                                                    </span>
                                                </div>
                                                <textarea
                                                    value={releaseApprovalNote}
                                                    onChange={(event) => setReleaseApprovalNote(event.target.value)}
                                                    placeholder="Optional approval note for audit trail"
                                                    disabled={!canApproveReleases || busyReleaseApprovalId === focusedRelease.id}
                                                    className="mt-3 min-h-[72px] w-full rounded-xl border border-[color:var(--border)] bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:bg-slate-950 dark:text-slate-100"
                                                />
                                                <div className="mt-3 flex flex-wrap gap-3">
                                                    <button
                                                        type="button"
                                                        onClick={() => void handleReleaseApproval(focusedRelease, "approved")}
                                                        disabled={!canApproveReleases || busyReleaseApprovalId === focusedRelease.id}
                                                        className="fc-button-primary px-4 py-2.5 text-sm font-semibold disabled:opacity-60"
                                                    >
                                                        {busyReleaseApprovalId === focusedRelease.id ? "Saving decision..." : "Approve release"}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => void handleReleaseApproval(focusedRelease, "rejected")}
                                                        disabled={!canApproveReleases || busyReleaseApprovalId === focusedRelease.id}
                                                        className="fc-button-secondary px-4 py-2.5 text-sm font-semibold disabled:opacity-60"
                                                    >
                                                        {busyReleaseApprovalId === focusedRelease.id ? "Saving decision..." : "Reject release"}
                                                    </button>
                                                    {!canApproveReleases ? (
                                                        <p className="text-xs text-slate-500 dark:text-slate-300">Approval actions are disabled for this role.</p>
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
                                                            disabled={!canRollbackReleases || !focusedRelease.rollbackReady || busyReleaseId === focusedRelease.id || busyReleaseApprovalId === focusedRelease.id || isPreparingRollbackReview}
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
                                            <div className="flex flex-wrap items-center gap-2">
                                                <p className="font-semibold text-slate-900 dark:text-slate-100">{release.label}</p>
                                                <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${releaseApprovalBadgeClasses(release.approvalStatus)}`}>
                                                    {releaseApprovalLabel(release.approvalStatus)}
                                                </span>
                                            </div>
                                            <p className="mt-1 text-slate-600 dark:text-slate-300">{release.ownerUserId}</p>
                                            <p className="mt-1 text-xs text-slate-500 dark:text-slate-300">Snapshot: {release.snapshotId}</p>
                                            <p className="mt-1 text-xs text-slate-500 dark:text-slate-300">
                                                Stored projects: {release.snapshotProjectCount} | Rollback {release.rollbackReady ? "ready" : "blocked"}
                                            </p>
                                            <p className="mt-1 text-xs text-slate-500 dark:text-slate-300">
                                                Approval: {releaseApprovalLabel(release.approvalStatus)}
                                            </p>
                                            {release.approvedAt ? (
                                                <p className="mt-1 text-xs text-slate-500 dark:text-slate-300">
                                                    Decision: {formatTimestamp(release.approvedAt)}{release.approvedBy ? ` by ${release.approvedBy}` : ""}
                                                </p>
                                            ) : null}
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
                                                disabled={!canRollbackReleases || !release.rollbackReady || busyReleaseId === release.id || busyReleaseApprovalId === release.id}
                                                className="fc-button-secondary px-3 py-2 text-xs font-semibold disabled:opacity-60"
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
                                                Tenant {focusedJob.tenantId || "unassigned"} | Status {focusedJob.tenantStatus || "unknown"}
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
                                        Tenant: {job.tenantId || "unassigned"} ({job.tenantStatus || "unknown"})
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
                                                    <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">Tenant: {job.tenantId || "unassigned"} ({job.tenantStatus || "unknown"})</p>
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

                    <article className="fc-surface-strong rounded-[var(--radius-2xl)] p-6">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                                <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Task Runs</h2>
                                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                                    {canManageTasks
                                        ? "Workspace DAG execution history with operator replay controls."
                                        : "Workspace DAG execution history across projects and versions."}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => void refreshTaskRuns()}
                                disabled={isRefreshingTaskRuns}
                                className="fc-button-secondary px-3 py-2 text-xs font-semibold disabled:opacity-60"
                            >
                                {isRefreshingTaskRuns ? "Refreshing..." : "Refresh task runs"}
                            </button>
                        </div>

                        <div className="mt-4 grid gap-2 sm:grid-cols-2">
                            <input
                                value={taskRunQuery}
                                onChange={(event) => setTaskRunQuery(event.target.value)}
                                placeholder="Search task/project/version"
                                className="rounded-xl border border-[color:var(--border)] bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:bg-slate-950 dark:text-slate-100 sm:col-span-2"
                            />
                            <select
                                value={taskRunStatus}
                                onChange={(event) => setTaskRunStatus(event.target.value as "" | TaskRun["status"])}
                                className="rounded-xl border border-[color:var(--border)] bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:bg-slate-950 dark:text-slate-100"
                            >
                                <option value="">Any status</option>
                                <option value="queued">queued</option>
                                <option value="running">running</option>
                                <option value="succeeded">succeeded</option>
                                <option value="failed">failed</option>
                                <option value="blocked">blocked</option>
                            </select>
                            <select
                                value={taskRunTenantId}
                                onChange={(event) => setTaskRunTenantId(event.target.value)}
                                className="rounded-xl border border-[color:var(--border)] bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:bg-slate-950 dark:text-slate-100"
                            >
                                <option value="">Any tenant</option>
                                {tenants.map((tenant) => (
                                    <option key={tenant.id} value={tenant.id}>
                                        {tenant.id} ({tenant.status})
                                    </option>
                                ))}
                            </select>
                            <input
                                value={taskRunOwnerUserId}
                                onChange={(event) => setTaskRunOwnerUserId(event.target.value)}
                                placeholder="ownerUserId (optional)"
                                className="rounded-xl border border-[color:var(--border)] bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:bg-slate-950 dark:text-slate-100 sm:col-span-2"
                            />
                        </div>

                        <div className="mt-4 space-y-3">
                            {sortedTaskRuns.length > 0 ? sortedTaskRuns.map((run) => (
                                <div
                                    key={run.id}
                                    className="rounded-2xl border border-[color:var(--border)] bg-white/70 p-4 text-sm dark:bg-slate-900/60"
                                >
                                    <div className="flex flex-wrap items-start justify-between gap-2">
                                        <div>
                                            <p className="font-semibold text-slate-900 dark:text-slate-100">
                                                {run.taskTitle} ({run.taskId})
                                            </p>
                                            <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                                                Owner {run.ownerUserId} | Tenant {run.tenantId || "unassigned"}
                                            </p>
                                            <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                                                {run.projectName} / {run.versionName}
                                            </p>
                                        </div>
                                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${taskRunStatusClasses(run.runStatus)}`}>
                                            {run.runStatus}
                                        </span>
                                    </div>
                                    <p className="mt-2 text-xs text-slate-500 dark:text-slate-300">
                                        Updated {formatTimestamp(run.updatedAt)} | Task owner {run.taskOwner} | Attempt {run.attempt ?? 1}
                                    </p>
                                    {canManageTasks ? (
                                        <div className="mt-2 flex flex-wrap gap-2">
                                            <button
                                                type="button"
                                                onClick={() => void handleTaskRunReplay(run, "retry_failed")}
                                                disabled={busyTaskReplayId === run.id || run.runStatus === "running"}
                                                className="fc-button-secondary px-3 py-1.5 text-[11px] font-semibold disabled:opacity-60"
                                            >
                                                {busyTaskReplayId === run.id ? "Running..." : "Replay failed"}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => void handleTaskRunReplay(run, "strict")}
                                                disabled={busyTaskReplayId === run.id || run.runStatus === "running"}
                                                className="fc-button-secondary px-3 py-1.5 text-[11px] font-semibold disabled:opacity-60"
                                            >
                                                {busyTaskReplayId === run.id ? "Running..." : "Replay strict"}
                                            </button>
                                        </div>
                                    ) : null}
                                    {run.resultSummary ? (
                                        <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{run.resultSummary}</p>
                                    ) : null}
                                    {run.remediationHint ? (
                                        <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">{run.remediationHint}</p>
                                    ) : null}
                                </div>
                            )) : (
                                <p className="mt-4 text-sm text-slate-500 dark:text-slate-300">No task runs matched current filters.</p>
                            )}
                        </div>
                    </article>

                    <div className="space-y-6">
                        <AdminObservabilityPanel initialSnapshot={props.observabilitySnapshot} />
                        <AdminOperationsPanel initialEvents={props.operationEvents} />
                        <AdminAuditPanel initialEvents={props.auditEvents} />
                        <article className="fc-surface-strong rounded-[var(--radius-2xl)] p-6">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                <div>
                                    <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Billing Lifecycle</h2>
                                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                                        {canManageBilling
                                            ? "Monitor payment events, purchase states, and issue refunds."
                                            : "Read-only billing ledger visibility for operators and viewers."}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => void refreshBillingData()}
                                    disabled={isRefreshingBilling}
                                    className="fc-button-secondary px-3 py-2 text-xs font-semibold disabled:opacity-60"
                                >
                                    {isRefreshingBilling ? "Refreshing..." : "Refresh billing"}
                                </button>
                            </div>

                            <div className="mt-4 grid gap-4 lg:grid-cols-2">
                                <div className="rounded-2xl border border-[color:var(--border)] bg-white/70 p-4 dark:bg-slate-900/60">
                                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-300">Event Filters</p>
                                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                        <input
                                            value={billingQuery}
                                            onChange={(event) => setBillingQuery(event.target.value)}
                                            placeholder="Search events"
                                            className="rounded-xl border border-[color:var(--border)] bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:bg-slate-950 dark:text-slate-100 sm:col-span-2"
                                        />
                                        <select
                                            value={billingProvider}
                                            onChange={(event) => setBillingProvider(event.target.value as "" | BillingEvent["provider"])}
                                            className="rounded-xl border border-[color:var(--border)] bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:bg-slate-950 dark:text-slate-100"
                                        >
                                            <option value="">Any provider</option>
                                            <option value="stripe">stripe</option>
                                            <option value="manual">manual</option>
                                        </select>
                                        <select
                                            value={billingStatus}
                                            onChange={(event) => setBillingStatus(event.target.value as "" | BillingEvent["status"])}
                                            className="rounded-xl border border-[color:var(--border)] bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:bg-slate-950 dark:text-slate-100"
                                        >
                                            <option value="">Any status</option>
                                            <option value="pending">pending</option>
                                            <option value="succeeded">succeeded</option>
                                            <option value="failed">failed</option>
                                            <option value="refunded">refunded</option>
                                        </select>
                                        <select
                                            value={billingTenantId}
                                            onChange={(event) => setBillingTenantId(event.target.value)}
                                            className="rounded-xl border border-[color:var(--border)] bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:bg-slate-950 dark:text-slate-100 sm:col-span-2"
                                        >
                                            <option value="">Any tenant</option>
                                            {tenants.map((tenant) => (
                                                <option key={tenant.id} value={tenant.id}>
                                                    {tenant.id} ({tenant.status})
                                                </option>
                                            ))}
                                        </select>
                                        <input
                                            value={billingWorkspaceSnapshotId}
                                            onChange={(event) => setBillingWorkspaceSnapshotId(event.target.value)}
                                            placeholder="workspaceSnapshotId (optional)"
                                            className="rounded-xl border border-[color:var(--border)] bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:bg-slate-950 dark:text-slate-100 sm:col-span-2"
                                        />
                                    </div>
                                </div>

                                <div className="rounded-2xl border border-[color:var(--border)] bg-white/70 p-4 dark:bg-slate-900/60">
                                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-300">Purchase Filters</p>
                                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                        <input
                                            value={purchaseQuery}
                                            onChange={(event) => setPurchaseQuery(event.target.value)}
                                            placeholder="Search purchases"
                                            className="rounded-xl border border-[color:var(--border)] bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:bg-slate-950 dark:text-slate-100 sm:col-span-2"
                                        />
                                        <select
                                            value={purchaseProvider}
                                            onChange={(event) => setPurchaseProvider(event.target.value as "" | ProjectPurchase["provider"])}
                                            className="rounded-xl border border-[color:var(--border)] bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:bg-slate-950 dark:text-slate-100"
                                        >
                                            <option value="">Any provider</option>
                                            <option value="stripe">stripe</option>
                                            <option value="manual">manual</option>
                                        </select>
                                        <select
                                            value={purchaseStatus}
                                            onChange={(event) => setPurchaseStatus(event.target.value as "" | ProjectPurchase["status"])}
                                            className="rounded-xl border border-[color:var(--border)] bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:bg-slate-950 dark:text-slate-100"
                                        >
                                            <option value="">Any status</option>
                                            <option value="PENDING">PENDING</option>
                                            <option value="SUCCEEDED">SUCCEEDED</option>
                                            <option value="FAILED">FAILED</option>
                                            <option value="CANCELLED">CANCELLED</option>
                                            <option value="REFUNDED">REFUNDED</option>
                                        </select>
                                        <select
                                            value={purchaseTenantId}
                                            onChange={(event) => setPurchaseTenantId(event.target.value)}
                                            className="rounded-xl border border-[color:var(--border)] bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:bg-slate-950 dark:text-slate-100 sm:col-span-2"
                                        >
                                            <option value="">Any tenant</option>
                                            {tenants.map((tenant) => (
                                                <option key={tenant.id} value={tenant.id}>
                                                    {tenant.id} ({tenant.status})
                                                </option>
                                            ))}
                                        </select>
                                        <input
                                            value={purchaseWorkspaceSnapshotId}
                                            onChange={(event) => setPurchaseWorkspaceSnapshotId(event.target.value)}
                                            placeholder="workspaceSnapshotId (optional)"
                                            className="rounded-xl border border-[color:var(--border)] bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:bg-slate-950 dark:text-slate-100 sm:col-span-2"
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="mt-4 grid gap-4 lg:grid-cols-2">
                                <div className="rounded-2xl border border-[color:var(--border)] bg-white/70 p-4 dark:bg-slate-900/60">
                                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-300">Latest Events</p>
                                    <div className="mt-3 space-y-2">
                                        {sortedBillingEvents.length > 0 ? sortedBillingEvents.slice(0, 8).map((event) => (
                                            <div key={event.id} className="rounded-xl border border-[color:var(--border)] bg-white/80 px-3 py-2 text-xs dark:bg-slate-900/60">
                                                <p className="font-semibold text-slate-900 dark:text-slate-100">{event.eventType}</p>
                                                <p className="mt-1 text-slate-600 dark:text-slate-300">
                                                    {event.provider} | {event.status} | {formatMoneyCents(event.amountCents, event.currency)}
                                                </p>
                                                <p className="mt-1 text-slate-500 dark:text-slate-300">
                                                    {event.userId || "unknown user"} | {event.relatedProjectId || "unknown project"} | {event.tenantId || "unassigned tenant"}
                                                </p>
                                                <p className="mt-1 text-slate-500 dark:text-slate-300">
                                                    Snapshot {event.workspaceSnapshotId || "n/a"} | Revision {typeof event.workspaceRevision === "number" ? `r${event.workspaceRevision}` : "n/a"}
                                                </p>
                                                <p className="mt-1 text-slate-500 dark:text-slate-300">{formatTimestamp(event.createdAt)}</p>
                                            </div>
                                        )) : (
                                            <p className="text-sm text-slate-500 dark:text-slate-300">No billing events for current filters.</p>
                                        )}
                                    </div>
                                </div>

                                <div className="rounded-2xl border border-[color:var(--border)] bg-white/70 p-4 dark:bg-slate-900/60">
                                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-300">Latest Purchases</p>
                                    <div className="mt-3 space-y-2">
                                        {sortedPurchases.length > 0 ? sortedPurchases.slice(0, 8).map((purchase) => (
                                            <div key={purchase.id} className="rounded-xl border border-[color:var(--border)] bg-white/80 px-3 py-2 text-xs dark:bg-slate-900/60">
                                                <p className="font-semibold text-slate-900 dark:text-slate-100">
                                                    {purchase.userId}:{purchase.projectId}
                                                </p>
                                                <p className="mt-1 text-slate-600 dark:text-slate-300">
                                                    {purchase.provider} | {purchase.status} | {formatMoneyCents(purchase.amount, purchase.currency)}
                                                </p>
                                                <p className="mt-1 text-slate-500 dark:text-slate-300">
                                                    Tenant {purchase.tenantId || "unassigned"} | PI {purchase.paymentIntentId || "n/a"}
                                                </p>
                                                <p className="mt-1 text-slate-500 dark:text-slate-300">
                                                    Snapshot {purchase.workspaceSnapshotId || "n/a"} | Revision {typeof purchase.workspaceRevision === "number" ? `r${purchase.workspaceRevision}` : "n/a"}
                                                </p>
                                                <p className="mt-1 text-slate-500 dark:text-slate-300">Updated {formatTimestamp(purchase.updatedAt)}</p>
                                                {canManageBilling && purchase.status === "SUCCEEDED" ? (
                                                    <button
                                                        type="button"
                                                        onClick={() => prepareRefundForPurchase(purchase)}
                                                        className="mt-2 fc-button-secondary px-3 py-1.5 text-[11px] font-semibold"
                                                    >
                                                        Prepare refund
                                                    </button>
                                                ) : null}
                                            </div>
                                        )) : (
                                            <p className="text-sm text-slate-500 dark:text-slate-300">No purchases for current filters.</p>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {canManageBilling ? (
                                <form
                                    onSubmit={handleRefundSubmit}
                                    className="mt-4 rounded-2xl border border-[color:var(--border)] bg-white/70 p-4 dark:bg-slate-900/60"
                                >
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-300">Refund Action</p>
                                        <p className="text-xs text-slate-500 dark:text-slate-300">Use project pair or payment intent</p>
                                    </div>
                                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                        <input
                                            value={refundForm.userId}
                                            onChange={(event) => setRefundForm((current) => ({ ...current, userId: event.target.value }))}
                                            placeholder="userId"
                                            className="rounded-xl border border-[color:var(--border)] bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:bg-slate-950 dark:text-slate-100"
                                        />
                                        <input
                                            value={refundForm.projectId}
                                            onChange={(event) => setRefundForm((current) => ({ ...current, projectId: event.target.value }))}
                                            placeholder="projectId"
                                            className="rounded-xl border border-[color:var(--border)] bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:bg-slate-950 dark:text-slate-100"
                                        />
                                        <input
                                            value={refundForm.paymentIntentId}
                                            onChange={(event) => setRefundForm((current) => ({ ...current, paymentIntentId: event.target.value }))}
                                            placeholder="paymentIntentId (optional if user/project provided)"
                                            className="rounded-xl border border-[color:var(--border)] bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:bg-slate-950 dark:text-slate-100 sm:col-span-2"
                                        />
                                        <input
                                            value={refundForm.amountCents}
                                            onChange={(event) => setRefundForm((current) => ({ ...current, amountCents: event.target.value }))}
                                            placeholder="Amount in cents (optional)"
                                            className="rounded-xl border border-[color:var(--border)] bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:bg-slate-950 dark:text-slate-100"
                                        />
                                        <select
                                            value={refundForm.reason}
                                            onChange={(event) => setRefundForm((current) => ({ ...current, reason: event.target.value as "" | "duplicate" | "fraudulent" | "requested_by_customer" }))}
                                            className="rounded-xl border border-[color:var(--border)] bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:bg-slate-950 dark:text-slate-100"
                                        >
                                            <option value="">Reason (optional)</option>
                                            <option value="requested_by_customer">requested_by_customer</option>
                                            <option value="duplicate">duplicate</option>
                                            <option value="fraudulent">fraudulent</option>
                                        </select>
                                        <input
                                            value={refundForm.note}
                                            onChange={(event) => setRefundForm((current) => ({ ...current, note: event.target.value }))}
                                            placeholder="Operator note (optional)"
                                            className="rounded-xl border border-[color:var(--border)] bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:bg-slate-950 dark:text-slate-100 sm:col-span-2"
                                        />
                                    </div>
                                    <label className="mt-3 flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                                        <input
                                            type="checkbox"
                                            checked={refundForm.manualOnly}
                                            onChange={(event) => setRefundForm((current) => ({ ...current, manualOnly: event.target.checked }))}
                                            className="h-4 w-4 rounded border-[color:var(--border)]"
                                        />
                                        Manual only (skip Stripe API call, record refund locally)
                                    </label>
                                    <button
                                        type="submit"
                                        disabled={isSubmittingRefund}
                                        className="mt-3 fc-button-primary px-4 py-2.5 text-sm font-semibold disabled:opacity-60"
                                    >
                                        {isSubmittingRefund ? "Submitting..." : "Submit refund"}
                                    </button>
                                </form>
                            ) : (
                                <p className="mt-4 text-sm text-slate-500 dark:text-slate-300">
                                    Refund submission requires `billing_manage` capability.
                                </p>
                            )}
                        </article>
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
                            canReplay={canReplayWebhooks}
                            focusedEventId={expandedWebhookId}
                            onSelectEvent={handleWebhookSelection}
                        />

                        <article className="fc-surface-strong rounded-[var(--radius-2xl)] p-6">
                            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Tracked Workspaces</h2>
                            <div className="mt-4 space-y-3">
                                {workspaces.length > 0 ? workspaces.map((workspace) => (
                                    <div
                                        key={workspace.ownerUserId}
                                        className="rounded-2xl border border-[color:var(--border)] bg-white/70 p-4 text-sm dark:bg-slate-900/60"
                                    >
                                        <p className="font-semibold text-slate-900 dark:text-slate-100">{workspace.ownerUserId}</p>
                                        <p className="mt-1 text-slate-600 dark:text-slate-300">
                                            Tenant {workspace.tenantId || "unassigned"} | Revision {workspace.revision} | {workspace.projectCount} projects
                                        </p>
                                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-300">{workspace.latestSnapshotSummary}</p>
                                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-300">Updated {formatTimestamp(workspace.updatedAt)}</p>
                                        <div className="mt-3 flex flex-wrap items-center gap-2">
                                            <Link
                                                href={`/admin/workspaces/${encodeURIComponent(workspace.ownerUserId)}`}
                                                className="fc-button-secondary px-3 py-2 text-xs font-semibold"
                                            >
                                                Open revision diff
                                            </Link>
                                        </div>
                                        {canManageTenants ? (
                                            <div className="mt-3 flex flex-wrap items-center gap-2">
                                                <select
                                                    value={workspaceTenantDrafts[workspace.ownerUserId] || workspace.tenantId || ""}
                                                    onChange={(event) => {
                                                        const nextTenantId = event.target.value;
                                                        setWorkspaceTenantDrafts((current) => ({
                                                            ...current,
                                                            [workspace.ownerUserId]: nextTenantId
                                                        }));
                                                    }}
                                                    disabled={busyWorkspaceOwnerId === workspace.ownerUserId}
                                                    className="rounded-xl border border-[color:var(--border)] bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:bg-slate-950 dark:text-slate-100"
                                                >
                                                    <option value="">Select tenant</option>
                                                    {tenants.map((tenant) => (
                                                        <option key={tenant.id} value={tenant.id}>
                                                            {tenant.id} ({tenant.status})
                                                        </option>
                                                    ))}
                                                </select>
                                                <button
                                                    type="button"
                                                    onClick={() => void handleWorkspaceTenantSave(workspace.ownerUserId)}
                                                    disabled={
                                                        busyWorkspaceOwnerId === workspace.ownerUserId
                                                        || !(workspaceTenantDrafts[workspace.ownerUserId] || workspace.tenantId || "").trim()
                                                        || (workspaceTenantDrafts[workspace.ownerUserId] || workspace.tenantId || "") === (workspace.tenantId || "")
                                                    }
                                                    className="fc-button-secondary px-3 py-2 text-xs font-semibold disabled:opacity-60"
                                                >
                                                    {busyWorkspaceOwnerId === workspace.ownerUserId ? "Saving..." : "Save tenant"}
                                                </button>
                                            </div>
                                        ) : null}
                                    </div>
                                )) : (
                                    <p className="mt-4 text-sm text-slate-500 dark:text-slate-300">No workspaces tracked yet.</p>
                                )}
                            </div>
                        </article>

                        <article className="fc-surface-strong rounded-[var(--radius-2xl)] p-6">
                            <div className="flex items-center justify-between gap-3">
                                <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Tenants</h2>
                                <span className="text-xs text-slate-500 dark:text-slate-300">
                                    {canManageTenants || canManageOrgs ? "Tenant governance controls enabled" : "Read-only tenant view"}
                                </span>
                            </div>
                            <div className="mt-4 space-y-3">
                                {tenants.length > 0 ? tenants.map((tenant) => (
                                    <div
                                        key={tenant.id}
                                        className="rounded-2xl border border-[color:var(--border)] bg-white/70 p-4 text-sm dark:bg-slate-900/60"
                                    >
                                        <div className="flex flex-wrap items-start justify-between gap-3">
                                            <div>
                                                <p className="font-semibold text-slate-900 dark:text-slate-100">{tenant.name}</p>
                                                <p className="mt-1 text-slate-600 dark:text-slate-300">{tenant.slug} | {tenant.status}</p>
                                                <p className="mt-1 text-xs text-slate-500 dark:text-slate-300">Organization: {tenant.orgId || "unassigned"}</p>
                                                <p className="mt-1 text-xs text-slate-500 dark:text-slate-300">Workspaces: {tenant.workspaceCount}</p>
                                            </div>
                                            {canManageTenants || canManageOrgs ? (
                                                <div className="space-y-2">
                                                    {canManageTenants ? (
                                                        <div className="flex flex-wrap items-center gap-2">
                                                            <select
                                                                value={tenantStatusDrafts[tenant.id] || tenant.status}
                                                                onChange={(event) => {
                                                                    const nextStatus = event.target.value as Tenant["status"];
                                                                    setTenantStatusDrafts((current) => ({
                                                                        ...current,
                                                                        [tenant.id]: nextStatus
                                                                    }));
                                                                }}
                                                                disabled={busyTenantId === tenant.id}
                                                                className="rounded-xl border border-[color:var(--border)] bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:bg-slate-950 dark:text-slate-100"
                                                            >
                                                                <option value="active">active</option>
                                                                <option value="trial">trial</option>
                                                                <option value="suspended">suspended</option>
                                                            </select>
                                                            <button
                                                                type="button"
                                                                onClick={() => void handleTenantStatusSave(tenant.id)}
                                                                disabled={busyTenantId === tenant.id || (tenantStatusDrafts[tenant.id] || tenant.status) === tenant.status}
                                                                className="fc-button-secondary px-3 py-2 text-xs font-semibold disabled:opacity-60"
                                                            >
                                                                {busyTenantId === tenant.id ? "Saving..." : "Save status"}
                                                            </button>
                                                        </div>
                                                    ) : null}
                                                    {canManageOrgs ? (
                                                        <div className="flex flex-wrap items-center gap-2">
                                                            <select
                                                                value={tenantOrgDrafts[tenant.id] ?? tenant.orgId ?? ""}
                                                                onChange={(event) => {
                                                                    const nextOrgId = event.target.value;
                                                                    setTenantOrgDrafts((current) => ({
                                                                        ...current,
                                                                        [tenant.id]: nextOrgId
                                                                    }));
                                                                }}
                                                                disabled={busyTenantOrgId === tenant.id}
                                                                className="rounded-xl border border-[color:var(--border)] bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:bg-slate-950 dark:text-slate-100"
                                                            >
                                                                <option value="">Unassigned org</option>
                                                                {orgs.map((org) => (
                                                                    <option key={org.id} value={org.id}>
                                                                        {org.id} ({org.status})
                                                                    </option>
                                                                ))}
                                                            </select>
                                                            <button
                                                                type="button"
                                                                onClick={() => void handleTenantOrgSave(tenant.id)}
                                                                disabled={busyTenantOrgId === tenant.id || (tenantOrgDrafts[tenant.id] ?? tenant.orgId ?? "") === (tenant.orgId ?? "")}
                                                                className="fc-button-secondary px-3 py-2 text-xs font-semibold disabled:opacity-60"
                                                            >
                                                                {busyTenantOrgId === tenant.id ? "Saving..." : "Save org"}
                                                            </button>
                                                        </div>
                                                    ) : null}
                                                </div>
                                            ) : null}
                                        </div>
                                    </div>
                                )) : (
                                    <p className="mt-4 text-sm text-slate-500 dark:text-slate-300">No tenants provisioned yet.</p>
                                )}
                            </div>
                        </article>

                        <article className="fc-surface-strong rounded-[var(--radius-2xl)] p-6">
                            <div className="flex items-center justify-between gap-3">
                                <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Organizations</h2>
                                <span className="text-xs text-slate-500 dark:text-slate-300">
                                    {canManageOrgs ? "Org lifecycle management enabled" : "Read-only org view"}
                                </span>
                            </div>
                            <div className="mt-4 space-y-3">
                                {orgs.length > 0 ? orgs.map((org) => (
                                    <div
                                        key={org.id}
                                        className="rounded-2xl border border-[color:var(--border)] bg-white/70 p-4 text-sm dark:bg-slate-900/60"
                                    >
                                        <div className="flex flex-wrap items-start justify-between gap-3">
                                            <div>
                                                <p className="font-semibold text-slate-900 dark:text-slate-100">{org.name}</p>
                                                <p className="mt-1 text-slate-600 dark:text-slate-300">{org.slug} | {org.status}</p>
                                                <p className="mt-1 text-xs text-slate-500 dark:text-slate-300">Tenants: {org.tenantCount}</p>
                                            </div>
                                            {canManageOrgs ? (
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <select
                                                        value={orgStatusDrafts[org.id] || org.status}
                                                        onChange={(event) => {
                                                            const nextStatus = event.target.value as Org["status"];
                                                            setOrgStatusDrafts((current) => ({
                                                                ...current,
                                                                [org.id]: nextStatus
                                                            }));
                                                        }}
                                                        disabled={busyOrgId === org.id}
                                                        className="rounded-xl border border-[color:var(--border)] bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:bg-slate-950 dark:text-slate-100"
                                                    >
                                                        <option value="active">active</option>
                                                        <option value="suspended">suspended</option>
                                                    </select>
                                                    <button
                                                        type="button"
                                                        onClick={() => void handleOrgStatusSave(org.id)}
                                                        disabled={busyOrgId === org.id || (orgStatusDrafts[org.id] || org.status) === org.status}
                                                        className="fc-button-secondary px-3 py-2 text-xs font-semibold disabled:opacity-60"
                                                    >
                                                        {busyOrgId === org.id ? "Saving..." : "Save status"}
                                                    </button>
                                                </div>
                                            ) : null}
                                        </div>
                                    </div>
                                )) : (
                                    <p className="mt-4 text-sm text-slate-500 dark:text-slate-300">No organizations provisioned yet.</p>
                                )}
                            </div>
                        </article>

                        <article className="fc-surface-strong rounded-[var(--radius-2xl)] p-6">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                <div>
                                    <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Users</h2>
                                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                                        {canManageUsers
                                            ? "Account status controls available (active/suspended)."
                                            : "Read-only user status visibility."}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => void refreshUsers()}
                                    disabled={isRefreshingUsers}
                                    className="fc-button-secondary px-3 py-2 text-xs font-semibold disabled:opacity-60"
                                >
                                    {isRefreshingUsers ? "Refreshing..." : "Refresh users"}
                                </button>
                            </div>

                            <div className="mt-4 grid gap-2 sm:grid-cols-3">
                                <input
                                    value={userQuery}
                                    onChange={(event) => setUserQuery(event.target.value)}
                                    placeholder="Search uid/email"
                                    className="rounded-xl border border-[color:var(--border)] bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:bg-slate-950 dark:text-slate-100"
                                />
                                <select
                                    value={userStatusFilter}
                                    onChange={(event) => setUserStatusFilter(event.target.value as "" | AdminUserSummary["status"])}
                                    className="rounded-xl border border-[color:var(--border)] bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:bg-slate-950 dark:text-slate-100"
                                >
                                    <option value="">Any status</option>
                                    <option value="active">active</option>
                                    <option value="suspended">suspended</option>
                                </select>
                                <select
                                    value={userTenantIdFilter}
                                    onChange={(event) => setUserTenantIdFilter(event.target.value)}
                                    className="rounded-xl border border-[color:var(--border)] bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:bg-slate-950 dark:text-slate-100"
                                >
                                    <option value="">Any tenant</option>
                                    {tenants.map((tenant) => (
                                        <option key={tenant.id} value={tenant.id}>
                                            {tenant.id} ({tenant.status})
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className="mt-4 space-y-3">
                                {sortedUsers.length > 0 ? sortedUsers.map((user) => (
                                    <div
                                        key={user.uid}
                                        className="rounded-2xl border border-[color:var(--border)] bg-white/70 p-4 text-sm dark:bg-slate-900/60"
                                    >
                                        <div className="flex flex-wrap items-start justify-between gap-3">
                                            <div>
                                                <p className="font-semibold text-slate-900 dark:text-slate-100">
                                                    {user.email || "(no email)"} | {user.status}
                                                </p>
                                                <p className="mt-1 text-xs text-slate-500 dark:text-slate-300">{user.uid}</p>
                                                <p className="mt-1 text-xs text-slate-500 dark:text-slate-300">
                                                    Tenant: {user.tenantId || "unassigned"} | Session version: {user.sessionVersion}
                                                </p>
                                                <p className="mt-1 text-xs text-slate-500 dark:text-slate-300">
                                                    Updated {user.updatedAt ? formatTimestamp(user.updatedAt) : "n/a"}
                                                </p>
                                                {user.statusReason ? (
                                                    <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                                                        Reason: {user.statusReason}
                                                    </p>
                                                ) : null}
                                            </div>
                                            {canManageUsers ? (
                                                <div className="space-y-2">
                                                    <select
                                                        value={userStatusDrafts[user.uid] || user.status}
                                                        onChange={(event) => {
                                                            const nextStatus = event.target.value as AdminUserSummary["status"];
                                                            setUserStatusDrafts((current) => ({
                                                                ...current,
                                                                [user.uid]: nextStatus
                                                            }));
                                                        }}
                                                        disabled={busyUserId === user.uid}
                                                        className="rounded-xl border border-[color:var(--border)] bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:bg-slate-950 dark:text-slate-100"
                                                    >
                                                        <option value="active">active</option>
                                                        <option value="suspended">suspended</option>
                                                    </select>
                                                    <input
                                                        value={userReasonDrafts[user.uid] ?? user.statusReason ?? ""}
                                                        onChange={(event) => {
                                                            const nextReason = event.target.value;
                                                            setUserReasonDrafts((current) => ({
                                                                ...current,
                                                                [user.uid]: nextReason
                                                            }));
                                                        }}
                                                        disabled={busyUserId === user.uid}
                                                        placeholder="Reason (optional)"
                                                        className="w-full rounded-xl border border-[color:var(--border)] bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:bg-slate-950 dark:text-slate-100"
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={() => void handleUserStatusSave(user.uid)}
                                                        disabled={
                                                            busyUserId === user.uid
                                                            || (
                                                                (userStatusDrafts[user.uid] || user.status) === user.status
                                                                && ((userReasonDrafts[user.uid] ?? user.statusReason ?? "").trim() === (user.statusReason || ""))
                                                            )
                                                        }
                                                        className="fc-button-secondary w-full px-3 py-2 text-xs font-semibold disabled:opacity-60"
                                                    >
                                                        {busyUserId === user.uid ? "Saving..." : "Save user status"}
                                                    </button>
                                                </div>
                                            ) : null}
                                        </div>
                                    </div>
                                )) : (
                                    <p className="mt-4 text-sm text-slate-500 dark:text-slate-300">No users matched current filters.</p>
                                )}
                            </div>
                        </article>
                    </div>
                </section>
            </div>
        </main>
    );
}
