import type {
    PrdDelta,
    ProgressEventType,
    ProgressEventV1,
    ProgressStateV1,
    ProgressTemplateV1,
    ReadinessChecklist,
    ReadinessRequirementKey,
    ReadinessRequirementStatus
} from "@/types";

export const PROGRESS_TEMPLATE_VERSION = "readiness_v1" as const;
const PROGRESS_TEMPLATE_SCHEMA_VERSION = "progress_template_v1" as const;
const PROGRESS_STATE_SCHEMA_VERSION = "progress_state_v1" as const;
const DEFAULT_MAX_PROGRESS_EVENTS = 240;

function clipText(value: string, maxChars: number) {
    if (value.length <= maxChars) return value;
    return value.slice(0, maxChars);
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
        || value === "readiness.recomputed"
        || value === "task.run.updated"
        || value === "generation.gate.changed"
        || value === "workspace.patch.applied"
        ? value
        : null;
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

export function createEmptyProgressTemplate(updatedAt: number = Date.now()): ProgressTemplateV1 {
    return {
        version: PROGRESS_TEMPLATE_SCHEMA_VERSION,
        templateVersion: PROGRESS_TEMPLATE_VERSION,
        taxonomy: "readiness",
        criteria: [],
        requirements: [],
        updatedAt
    };
}

export function createEmptyProgressState(updatedAt: number = Date.now()): ProgressStateV1 {
    return {
        version: PROGRESS_STATE_SCHEMA_VERSION,
        templateVersion: PROGRESS_TEMPLATE_VERSION,
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
    updatedAt: number = Date.now()
): ProgressTemplateV1 {
    const requirements = readiness.criteria.flatMap((criterion) =>
        criterion.requirements.map((requirement) => ({
            key: requirement.key,
            label: requirement.label
        }))
    );

    return {
        version: PROGRESS_TEMPLATE_SCHEMA_VERSION,
        templateVersion: PROGRESS_TEMPLATE_VERSION,
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
    if (candidate.templateVersion !== PROGRESS_TEMPLATE_VERSION) return null;
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
        templateVersion: PROGRESS_TEMPLATE_VERSION,
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
}): ProgressStateV1 {
    const readiness = input.readiness;
    const updatedAt = typeof input.updatedAt === "number" && Number.isFinite(input.updatedAt)
        ? Math.round(input.updatedAt)
        : Date.now();
    const requirementStatuses: Partial<Record<ReadinessRequirementKey, ReadinessRequirementStatus>> = {};

    for (const criterion of readiness.criteria) {
        for (const requirement of criterion.requirements) {
            const status = normalizeRequirementStatus(requirement.status);
            if (!status) continue;
            requirementStatuses[requirement.key] = status;
        }
    }

    const changedRequirementKeys = Array.from(
        new Set(
            (input.prdDeltas || [])
                .map((delta) => delta.requirementKey)
                .filter((key): key is ReadinessRequirementKey => Boolean(key))
        )
    ).slice(-24);

    const primaryBlocker = readiness.blockingIssues[0] || null;
    const currentFocus = (input.currentFocus || "").trim() || readiness.nextMilestone || primaryBlocker;

    return {
        version: PROGRESS_STATE_SCHEMA_VERSION,
        templateVersion: PROGRESS_TEMPLATE_VERSION,
        score: readiness.score,
        functionalReady: readiness.functionalReady,
        uiReady: readiness.uiReady,
        paymentReady: readiness.paymentReady,
        blockingIssues: readiness.blockingIssues.slice(0, 12),
        nextMilestone: clipText(readiness.nextMilestone || "", 240),
        primaryBlocker: primaryBlocker ? clipText(primaryBlocker, 240) : null,
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
    if (candidate.templateVersion !== PROGRESS_TEMPLATE_VERSION) return null;

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
        templateVersion: PROGRESS_TEMPLATE_VERSION,
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
