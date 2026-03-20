import type {
    ArchitectureStage,
    PrdDelta,
    ProgressEventType,
    ProgressEventV1,
    ProgressStateV1,
    ProgressTemplateV1,
    ProgressTemplateVersion,
    ReadinessChecklist,
    ReadinessRequirementKey,
    ReadinessRequirementStatus,
    UnifiedProgressNextActionV1,
    UnifiedProgressStateV1
} from "@/types";

export const LEGACY_PROGRESS_TEMPLATE_VERSION = "readiness_v1" as const;
export const PROGRESS_TEMPLATE_VERSION = "readiness_v2" as const;
const PROGRESS_TEMPLATE_SCHEMA_VERSION = "progress_template_v1" as const;
const PROGRESS_STATE_SCHEMA_VERSION = "progress_state_v1" as const;
const UNIFIED_PROGRESS_STATE_SCHEMA_VERSION = "unified_progress_state_v1" as const;
const DEFAULT_MAX_PROGRESS_EVENTS = 240;
const SUPPORTED_PROGRESS_TEMPLATE_VERSIONS: ProgressTemplateVersion[] = [
    LEGACY_PROGRESS_TEMPLATE_VERSION,
    PROGRESS_TEMPLATE_VERSION
];

function clipText(value: string, maxChars: number) {
    if (value.length <= maxChars) return value;
    return value.slice(0, maxChars);
}

function normalizeArchitectureStage(value: unknown): ArchitectureStage | null {
    return value === "context" ||
        value === "boundaries" ||
        value === "decisions" ||
        value === "guardrails" ||
        value === "ready_to_generate"
        ? value
        : null;
}

function normalizeRequirementStatus(value: unknown): ReadinessRequirementStatus | null {
    return value === "missing" || value === "partial" || value === "confirmed" || value === "waived"
        ? value
        : null;
}

function normalizeMetadata(value: unknown): Record<string, string> | undefined {
    if (!value || typeof value !== "object") return undefined;
    const next: Record<string, string> = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
        if (typeof raw !== "string") continue;
        const normalizedKey = key.trim();
        if (!normalizedKey) continue;
        next[normalizedKey] = clipText(raw.trim(), 400);
    }
    return Object.keys(next).length > 0 ? next : undefined;
}

function normalizeProgressEventType(value: unknown): ProgressEventType | null {
    return value === "requirement.focused"
        || value === "requirement.filled"
        || value === "requirement.confirmed"
        || value === "requirement.updated"
        || value === "readiness.recomputed"
        || value === "stage.changed"
        || value === "gate.changed"
        || value === "scaffold.prompted"
        || value === "scaffold.triggered"
        || value === "task.run.updated"
        || value === "generation.gate.changed"
        || value === "workspace.patch.applied"
        ? value
        : null;
}

function normalizeProgressTemplateVersion(value: unknown): ProgressTemplateVersion {
    return isProgressTemplateVersion(value) ? value : PROGRESS_TEMPLATE_VERSION;
}

function inferStageFromReadiness(readiness: ReadinessChecklist): ArchitectureStage {
    const criterionByKey = new Map(readiness.criteria.map((criterion) => [criterion.key, criterion]));

    if (criterionByKey.get("business_context")?.status !== "confirmed") {
        return "context";
    }
    if (criterionByKey.get("boundaries")?.status !== "confirmed") {
        return "boundaries";
    }
    if (criterionByKey.get("decisions")?.status !== "confirmed") {
        return "decisions";
    }
    if (
        criterionByKey.get("guardrails")?.status !== "confirmed" ||
        criterionByKey.get("ui")?.status !== "confirmed"
    ) {
        return "guardrails";
    }
    return "ready_to_generate";
}

function collectRequirementStatuses(readiness: ReadinessChecklist) {
    const statuses: Partial<Record<ReadinessRequirementKey, ReadinessRequirementStatus>> = {};
    for (const criterion of readiness.criteria) {
        for (const requirement of criterion.requirements) {
            const status = normalizeRequirementStatus(requirement.status);
            if (!status) continue;
            statuses[requirement.key] = status;
        }
    }
    return statuses;
}

function countPendingRequirements(statuses: Partial<Record<ReadinessRequirementKey, ReadinessRequirementStatus>>) {
    let pending = 0;
    for (const status of Object.values(statuses)) {
        if (status === "missing" || status === "partial") {
            pending += 1;
        }
    }
    return pending;
}

function getPrimaryPendingRequirementKey(readiness: ReadinessChecklist): ReadinessRequirementKey | null {
    for (const criterion of readiness.criteria) {
        for (const requirement of criterion.requirements) {
            if (requirement.status === "missing" || requirement.status === "partial") {
                return requirement.key;
            }
        }
    }
    return null;
}

function buildUnifiedNextAction(input: {
    canGenerate: boolean;
    blockers: string[];
    pendingRequirementKey: ReadinessRequirementKey | null;
    workspaceSnapshotId?: string | null;
    revision?: number | null;
    conflictEscalated?: boolean;
}): UnifiedProgressNextActionV1 {
    if (input.conflictEscalated) {
        return {
            type: "resolve_conflict",
            enabled: true,
            detail: input.blockers[0] || "Resolve workspace conflict before continuing.",
            requirementKey: input.pendingRequirementKey,
            workspaceSnapshotId: input.workspaceSnapshotId ?? null,
            revision: typeof input.revision === "number" ? input.revision : null
        };
    }

    if (input.canGenerate) {
        return {
            type: "generate_scaffold",
            enabled: true,
            detail: "Generation gate is ready.",
            requirementKey: null,
            workspaceSnapshotId: input.workspaceSnapshotId ?? null,
            revision: typeof input.revision === "number" ? input.revision : null
        };
    }

    return {
        type: "collect_requirement",
        enabled: true,
        detail: input.blockers[0] || "Collect the next missing requirement.",
        requirementKey: input.pendingRequirementKey,
        workspaceSnapshotId: input.workspaceSnapshotId ?? null,
        revision: typeof input.revision === "number" ? input.revision : null
    };
}

export function isProgressTemplateVersion(value: unknown): value is ProgressTemplateVersion {
    return typeof value === "string" && SUPPORTED_PROGRESS_TEMPLATE_VERSIONS.includes(value as ProgressTemplateVersion);
}

export function isProgressTemplateEnabled(value: unknown) {
    return isProgressTemplateVersion(value);
}

export function createProgressEventId(prefix = "progress") {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createProgressEvent(input: {
    type: ProgressEventType;
    projectId?: string | null;
    versionId?: string | null;
    requirementKey?: ReadinessRequirementKey | null;
    questionKey?: string | null;
    sourceMessageId?: string | null;
    summary?: string | null;
    metadata?: Record<string, string>;
    createdAt?: number;
}): ProgressEventV1 {
    return {
        id: createProgressEventId(),
        type: input.type,
        createdAt: typeof input.createdAt === "number" && Number.isFinite(input.createdAt)
            ? input.createdAt
            : Date.now(),
        projectId: typeof input.projectId === "string" && input.projectId.trim() ? input.projectId.trim() : undefined,
        versionId: typeof input.versionId === "string" && input.versionId.trim() ? input.versionId.trim() : undefined,
        requirementKey: input.requirementKey ?? undefined,
        questionKey: typeof input.questionKey === "string" && input.questionKey.trim() ? input.questionKey.trim() : undefined,
        sourceMessageId: typeof input.sourceMessageId === "string" && input.sourceMessageId.trim() ? input.sourceMessageId.trim() : undefined,
        summary: typeof input.summary === "string" && input.summary.trim() ? clipText(input.summary.trim(), 320) : undefined,
        metadata: normalizeMetadata(input.metadata)
    };
}

export function normalizeProgressEvents(value: unknown): ProgressEventV1[] {
    if (!Array.isArray(value)) return [];

    return value
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
        .reduce<ProgressEventV1[]>((acc, item) => {
            const type = normalizeProgressEventType(item.type);
            const id = typeof item.id === "string" && item.id.trim() ? item.id.trim() : "";
            if (!type || !id) return acc;
            const createdAt =
                typeof item.createdAt === "number" && Number.isFinite(item.createdAt)
                    ? Math.round(item.createdAt)
                    : Date.now();
            acc.push({
                id,
                type,
                createdAt,
                projectId: typeof item.projectId === "string" && item.projectId.trim() ? item.projectId.trim() : undefined,
                versionId: typeof item.versionId === "string" && item.versionId.trim() ? item.versionId.trim() : undefined,
                requirementKey: (item.requirementKey as ReadinessRequirementKey | null | undefined) ?? undefined,
                questionKey: typeof item.questionKey === "string" && item.questionKey.trim() ? item.questionKey.trim() : undefined,
                sourceMessageId: typeof item.sourceMessageId === "string" && item.sourceMessageId.trim() ? item.sourceMessageId.trim() : undefined,
                summary: typeof item.summary === "string" && item.summary.trim() ? clipText(item.summary.trim(), 320) : undefined,
                metadata: normalizeMetadata(item.metadata)
            });
            return acc;
        }, []);
}

export function appendProgressEvents(
    existing: ProgressEventV1[] | undefined,
    incoming: ProgressEventV1[] | undefined,
    maxEvents: number = DEFAULT_MAX_PROGRESS_EVENTS
): ProgressEventV1[] {
    const merged = [...(existing || []), ...(incoming || [])];
    if (merged.length === 0) return [];

    const byId = new Map<string, ProgressEventV1>();
    for (const event of merged) {
        if (!event?.id) continue;
        byId.set(event.id, event);
    }

    return Array.from(byId.values())
        .sort((left, right) => left.createdAt - right.createdAt)
        .slice(-Math.max(1, maxEvents));
}

export function resolveProgressCursor(events: ProgressEventV1[] | undefined): string {
    const list = events || [];
    const last = list[list.length - 1];
    return last?.id || "";
}

export function createEmptyProgressTemplate(
    updatedAt: number = Date.now(),
    templateVersion: ProgressTemplateVersion = PROGRESS_TEMPLATE_VERSION
): ProgressTemplateV1 {
    return {
        version: PROGRESS_TEMPLATE_SCHEMA_VERSION,
        templateVersion,
        taxonomy: "readiness",
        criteria: [],
        requirements: [],
        updatedAt
    };
}

export function createEmptyProgressState(
    updatedAt: number = Date.now(),
    templateVersion: ProgressTemplateVersion = PROGRESS_TEMPLATE_VERSION
): ProgressStateV1 {
    return {
        version: PROGRESS_STATE_SCHEMA_VERSION,
        templateVersion,
        score: 0,
        functionalReady: false,
        uiReady: false,
        paymentReady: false,
        blockingIssues: [],
        nextMilestone: "",
        primaryBlocker: null,
        currentFocus: null,
        requirementStatuses: {},
        changedRequirementKeys: [],
        updatedAt
    };
}

export function createProgressTemplateFromReadiness(
    readiness: ReadinessChecklist,
    updatedAt: number = Date.now(),
    templateVersion: ProgressTemplateVersion = PROGRESS_TEMPLATE_VERSION
): ProgressTemplateV1 {
    const requirements = readiness.criteria.flatMap((criterion) =>
        criterion.requirements.map((requirement) => ({
            key: requirement.key,
            label: requirement.label
        }))
    );

    return {
        version: PROGRESS_TEMPLATE_SCHEMA_VERSION,
        templateVersion,
        taxonomy: "readiness",
        criteria: readiness.criteria.map((criterion) => ({
            key: criterion.key,
            label: criterion.label,
            requirementKeys: criterion.requirements.map((requirement) => requirement.key)
        })),
        requirements,
        updatedAt
    };
}

export function normalizeProgressTemplate(value: unknown): ProgressTemplateV1 | null {
    if (!value || typeof value !== "object") return null;
    const candidate = value as Partial<ProgressTemplateV1>;
    if (candidate.version !== PROGRESS_TEMPLATE_SCHEMA_VERSION) return null;
    if (!isProgressTemplateVersion(candidate.templateVersion)) return null;
    if (candidate.taxonomy !== "readiness") return null;

    const criteria = Array.isArray(candidate.criteria)
        ? candidate.criteria
            .filter((item): item is ProgressTemplateV1["criteria"][number] => Boolean(item && typeof item === "object"))
            .map((item) => ({
                key: item.key,
                label: typeof item.label === "string" ? item.label : "",
                requirementKeys: Array.isArray(item.requirementKeys)
                    ? item.requirementKeys.filter((key): key is ReadinessRequirementKey => typeof key === "string" && key.trim().length > 0)
                    : []
            }))
        : [];

    const requirements = Array.isArray(candidate.requirements)
        ? candidate.requirements
            .filter((item): item is ProgressTemplateV1["requirements"][number] => Boolean(item && typeof item === "object"))
            .map((item) => ({
                key: item.key,
                label: typeof item.label === "string" ? item.label : ""
            }))
        : [];

    return {
        version: PROGRESS_TEMPLATE_SCHEMA_VERSION,
        templateVersion: candidate.templateVersion,
        taxonomy: "readiness",
        criteria,
        requirements,
        updatedAt:
            typeof candidate.updatedAt === "number" && Number.isFinite(candidate.updatedAt)
                ? Math.round(candidate.updatedAt)
                : Date.now()
    };
}

export function createProgressStateFromReadiness(input: {
    readiness: ReadinessChecklist;
    prdDeltas?: PrdDelta[] | undefined;
    currentFocus?: string | null;
    updatedAt?: number;
    templateVersion?: ProgressTemplateVersion;
}): ProgressStateV1 {
    const readiness = input.readiness;
    const updatedAt = typeof input.updatedAt === "number" && Number.isFinite(input.updatedAt)
        ? Math.round(input.updatedAt)
        : Date.now();
    const requirementStatuses = collectRequirementStatuses(readiness);

    const changedRequirementKeys = Array.from(
        new Set(
            (input.prdDeltas || [])
                .map((delta) => delta.requirementKey)
                .filter((key): key is ReadinessRequirementKey => Boolean(key))
        )
    ).slice(-24);

    const primaryBlocker = readiness.blockingIssues[0] || null;
    const currentFocus = (input.currentFocus || "").trim() || readiness.nextMilestone || primaryBlocker;
    const pendingCount = countPendingRequirements(requirementStatuses);

    return {
        version: PROGRESS_STATE_SCHEMA_VERSION,
        templateVersion: input.templateVersion ?? PROGRESS_TEMPLATE_VERSION,
        score: pendingCount === 0 ? 100 : readiness.score,
        functionalReady: pendingCount === 0 ? true : readiness.functionalReady,
        uiReady: pendingCount === 0 ? true : readiness.uiReady,
        paymentReady: pendingCount === 0 ? true : readiness.paymentReady,
        blockingIssues: pendingCount === 0 ? [] : readiness.blockingIssues.slice(0, 12),
        nextMilestone: pendingCount === 0
            ? ""
            : clipText(readiness.nextMilestone || "", 240),
        primaryBlocker: pendingCount === 0
            ? null
            : (primaryBlocker ? clipText(primaryBlocker, 240) : null),
        currentFocus: currentFocus ? clipText(currentFocus, 240) : null,
        requirementStatuses,
        changedRequirementKeys,
        updatedAt
    };
}

export function normalizeProgressState(value: unknown): ProgressStateV1 | null {
    if (!value || typeof value !== "object") return null;
    const candidate = value as Partial<ProgressStateV1> & { requirementStatuses?: Record<string, unknown> };
    if (candidate.version !== PROGRESS_STATE_SCHEMA_VERSION) return null;
    if (!isProgressTemplateVersion(candidate.templateVersion)) return null;

    const requirementStatuses: Partial<Record<ReadinessRequirementKey, ReadinessRequirementStatus>> = {};
    for (const [key, raw] of Object.entries(candidate.requirementStatuses || {})) {
        const status = normalizeRequirementStatus(raw);
        if (!status) continue;
        requirementStatuses[key as ReadinessRequirementKey] = status;
    }

    const changedRequirementKeys = Array.isArray(candidate.changedRequirementKeys)
        ? candidate.changedRequirementKeys
            .filter((key): key is ReadinessRequirementKey => typeof key === "string" && key.trim().length > 0)
            .slice(-24)
        : [];

    return {
        version: PROGRESS_STATE_SCHEMA_VERSION,
        templateVersion: candidate.templateVersion,
        score: typeof candidate.score === "number" ? candidate.score : 0,
        functionalReady: candidate.functionalReady === true,
        uiReady: candidate.uiReady === true,
        paymentReady: candidate.paymentReady === true,
        blockingIssues: Array.isArray(candidate.blockingIssues)
            ? candidate.blockingIssues.filter((item): item is string => typeof item === "string").slice(0, 12)
            : [],
        nextMilestone: typeof candidate.nextMilestone === "string" ? clipText(candidate.nextMilestone, 240) : "",
        primaryBlocker: typeof candidate.primaryBlocker === "string" ? clipText(candidate.primaryBlocker, 240) : null,
        currentFocus: typeof candidate.currentFocus === "string" ? clipText(candidate.currentFocus, 240) : null,
        requirementStatuses,
        changedRequirementKeys,
        updatedAt:
            typeof candidate.updatedAt === "number" && Number.isFinite(candidate.updatedAt)
                ? Math.round(candidate.updatedAt)
                : Date.now()
    };
}

export function createUnifiedProgressProjection(input: {
    readiness: ReadinessChecklist;
    stage?: ArchitectureStage | null;
    progressEvents?: ProgressEventV1[] | null;
    workspaceSnapshotId?: string | null;
    revision?: number | null;
    updatedAt?: number;
    currentFocus?: string | null;
    conflictEscalated?: boolean;
    templateVersion?: ProgressTemplateVersion;
}): UnifiedProgressStateV1 {
    const updatedAt = typeof input.updatedAt === "number" && Number.isFinite(input.updatedAt)
        ? Math.round(input.updatedAt)
        : Date.now();
    const requirementStatuses = collectRequirementStatuses(input.readiness);
    const pendingCount = countPendingRequirements(requirementStatuses);
    const derivedStage = inferStageFromReadiness(input.readiness);
    const stage = pendingCount === 0
        ? "ready_to_generate"
        : (normalizeArchitectureStage(input.stage) || derivedStage);
    const blockers = pendingCount === 0
        ? []
        : (input.readiness.blockingIssues.length > 0
            ? input.readiness.blockingIssues.slice(0, 12)
            : ["Collect the highest-impact missing requirement before generation."]);
    const readinessScore = pendingCount === 0
        ? 100
        : Math.max(0, Math.min(99, Math.round(input.readiness.score)));
    const canGenerate = pendingCount === 0;
    const pendingRequirementKey = getPrimaryPendingRequirementKey(input.readiness);
    const progressCursor = resolveProgressCursor(normalizeProgressEvents(input.progressEvents || []));
    const primaryFocus = (input.currentFocus || "").trim() || input.readiness.nextMilestone || blockers[0] || "";

    return {
        version: UNIFIED_PROGRESS_STATE_SCHEMA_VERSION,
        templateVersion: input.templateVersion ?? PROGRESS_TEMPLATE_VERSION,
        pendingCount,
        readinessScore,
        stage,
        canGenerate,
        blockers,
        currentFocus: primaryFocus ? clipText(primaryFocus, 240) : null,
        requirementStatuses,
        nextAction: buildUnifiedNextAction({
            canGenerate,
            blockers,
            pendingRequirementKey,
            workspaceSnapshotId: input.workspaceSnapshotId,
            revision: input.revision,
            conflictEscalated: input.conflictEscalated === true
        }),
        progressCursor: progressCursor || null,
        updatedAt
    };
}

export function normalizeUnifiedProgressState(value: unknown): UnifiedProgressStateV1 | null {
    if (!value || typeof value !== "object") return null;
    const candidate = value as Partial<UnifiedProgressStateV1> & {
        requirementStatuses?: Record<string, unknown>;
        nextAction?: Partial<UnifiedProgressNextActionV1>;
    };
    if (candidate.version !== UNIFIED_PROGRESS_STATE_SCHEMA_VERSION) return null;
    if (!isProgressTemplateVersion(candidate.templateVersion)) return null;

    const requirementStatuses: Partial<Record<ReadinessRequirementKey, ReadinessRequirementStatus>> = {};
    for (const [key, raw] of Object.entries(candidate.requirementStatuses || {})) {
        const status = normalizeRequirementStatus(raw);
        if (!status) continue;
        requirementStatuses[key as ReadinessRequirementKey] = status;
    }

    const normalizedBlockers = Array.isArray(candidate.blockers)
        ? candidate.blockers.filter((item): item is string => typeof item === "string").slice(0, 12)
        : [];
    const normalizedStage = normalizeArchitectureStage(candidate.stage) || "context";
    const normalizedPendingCount =
        typeof candidate.pendingCount === "number" && Number.isFinite(candidate.pendingCount)
            ? Math.max(0, Math.round(candidate.pendingCount))
            : countPendingRequirements(requirementStatuses);
    const normalizedCanGenerate = normalizedPendingCount === 0
        ? true
        : candidate.canGenerate === true;
    const normalizedReadinessScore =
        typeof candidate.readinessScore === "number" && Number.isFinite(candidate.readinessScore)
            ? Math.max(0, Math.min(100, Math.round(candidate.readinessScore)))
            : (normalizedCanGenerate ? 100 : 0);
    const nextActionType = candidate.nextAction?.type === "generate_scaffold" ||
        candidate.nextAction?.type === "collect_requirement" ||
        candidate.nextAction?.type === "resolve_conflict"
        ? candidate.nextAction.type
        : (normalizedCanGenerate ? "generate_scaffold" : "collect_requirement");

    return {
        version: UNIFIED_PROGRESS_STATE_SCHEMA_VERSION,
        templateVersion: candidate.templateVersion,
        pendingCount: normalizedPendingCount,
        readinessScore: normalizedCanGenerate ? 100 : normalizedReadinessScore,
        stage: normalizedCanGenerate ? "ready_to_generate" : normalizedStage,
        canGenerate: normalizedCanGenerate,
        blockers: normalizedCanGenerate ? [] : normalizedBlockers,
        currentFocus: typeof candidate.currentFocus === "string" ? clipText(candidate.currentFocus, 240) : null,
        requirementStatuses,
        nextAction: {
            type: nextActionType,
            enabled: candidate.nextAction?.enabled !== false,
            detail: typeof candidate.nextAction?.detail === "string"
                ? clipText(candidate.nextAction.detail, 240)
                : (normalizedCanGenerate ? "Generation gate is ready." : "Collect the next missing requirement."),
            requirementKey: candidate.nextAction?.requirementKey ?? null,
            workspaceSnapshotId: typeof candidate.nextAction?.workspaceSnapshotId === "string"
                ? candidate.nextAction.workspaceSnapshotId
                : null,
            revision: typeof candidate.nextAction?.revision === "number"
                ? Math.max(0, Math.round(candidate.nextAction.revision))
                : null
        },
        progressCursor: typeof candidate.progressCursor === "string" ? candidate.progressCursor : null,
        updatedAt:
            typeof candidate.updatedAt === "number" && Number.isFinite(candidate.updatedAt)
                ? Math.round(candidate.updatedAt)
                : Date.now()
    };
}

export function buildProgressProjectionFromReadiness(input: {
    readiness: ReadinessChecklist;
    prdDeltas?: PrdDelta[] | undefined;
    currentFocus?: string | null;
    stage?: ArchitectureStage | null;
    progressEvents?: ProgressEventV1[] | undefined;
    workspaceSnapshotId?: string | null;
    revision?: number | null;
    templateVersion?: ProgressTemplateVersion;
    updatedAt?: number;
    conflictEscalated?: boolean;
}) {
    const templateVersion = normalizeProgressTemplateVersion(input.templateVersion);
    const updatedAt = typeof input.updatedAt === "number" && Number.isFinite(input.updatedAt)
        ? Math.round(input.updatedAt)
        : Date.now();
    const progressEvents = appendProgressEvents([], input.progressEvents || []);
    const progressTemplate = createProgressTemplateFromReadiness(input.readiness, updatedAt, templateVersion);
    const progressState = createProgressStateFromReadiness({
        readiness: input.readiness,
        prdDeltas: input.prdDeltas,
        currentFocus: input.currentFocus,
        updatedAt,
        templateVersion
    });
    const unifiedProgressState = createUnifiedProgressProjection({
        readiness: input.readiness,
        stage: input.stage,
        progressEvents,
        workspaceSnapshotId: input.workspaceSnapshotId,
        revision: input.revision,
        updatedAt,
        currentFocus: input.currentFocus,
        conflictEscalated: input.conflictEscalated,
        templateVersion
    });

    return {
        progressTemplateVersion: templateVersion,
        progressTemplate,
        progressState,
        unifiedProgressState,
        progressEvents,
        progressCursor: resolveProgressCursor(progressEvents)
    };
}
