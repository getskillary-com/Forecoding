import { adminDb } from "@/lib/firebase-admin";
import type { DocumentData, DocumentReference, Transaction } from "firebase-admin/firestore";
import { createHash } from "node:crypto";
import { toDateOrNull } from "./firestore-utils";
import { recordAuditEvent } from "./audit-events";
import { syncTenantWorkspaceCount } from "./tenants";
import {
    buildWorkspaceReleaseTag,
    createEmptyWorkspaceEnvelope,
    createNextWorkspaceEnvelope,
    normalizeWorkspaceEnvelope
} from "@/lib/workspace-envelope";
import { normalizeProjects } from "@/lib/project-language";
import {
    appendProgressEvents,
    normalizeProgressEvents,
    normalizeProgressState,
    resolveProgressCursor
} from "@/lib/progress-template";
import type {
    AcceptanceCase,
    Attachment,
    AssumptionRecord,
    ContractSpec,
    FileNode,
    GenerationResponse,
    Message,
    Project,
    ProjectVersion,
    ProjectVersionData,
    ProgressStateV1,
    ReleaseTag,
    RequirementRecord,
    TaskDefinition,
    TaskRun,
    WorkspacePatchOperation,
    WorkspaceChangeKind,
    WorkspaceEnvelope
} from "@/types";

export type WorkspaceReleaseTagSummary = ReleaseTag & {
    ownerUserId: string;
    rollbackReady: boolean;
    rollbackReason?: string | null;
    snapshotProjectCount: number;
};

export type WorkspaceReleaseTagDetail = WorkspaceReleaseTagSummary & {
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

export type WorkspaceReleaseRollbackResult =
    | {
        ok: true;
        release: ReleaseTag;
        envelope: WorkspaceEnvelope;
        restoredRevision: number;
        restoredSnapshotId: string;
        projectCount: number;
    }
    | {
        ok: false;
        code:
            | "WORKSPACE_NOT_FOUND"
            | "RELEASE_NOT_FOUND"
            | "RELEASE_NOT_APPROVED"
            | "SNAPSHOT_NOT_FOUND"
            | "SNAPSHOT_PAYLOAD_UNAVAILABLE";
        message: string;
    };

type TaskRunStatus = TaskRun["status"];

type WorkspaceImpactDiffList = {
    added: string[];
    removed: string[];
    changed: string[];
};

type WorkspaceImpactStatusDiffList = WorkspaceImpactDiffList & {
    statusChanged: string[];
};

type TaskRunStatusCounts = Record<TaskRunStatus, number>;

export type WorkspaceRevisionTimelineItem = {
    revisionId: string;
    revisionNumber: number;
    snapshotId: string;
    createdAt: number;
    summary: string;
    kind: WorkspaceChangeKind;
    actorId?: string | null;
    actorEmail?: string | null;
    projectCount: number;
    activeVersionCount: number;
    hasSnapshotPayload: boolean;
};

export type WorkspaceRevisionOverview = {
    ownerUserId: string;
    tenantId: string | null;
    revision: number;
    projectCount: number;
    updatedAt: number;
    revisions: WorkspaceRevisionTimelineItem[];
};

export type WorkspaceRevisionDiff = {
    ownerUserId: string;
    tenantId: string | null;
    source: WorkspaceRevisionTimelineItem;
    target: WorkspaceRevisionTimelineItem;
    impact: {
        projectIds: WorkspaceImpactDiffList;
        activeVersionIds: WorkspaceImpactDiffList;
        modules: WorkspaceImpactDiffList;
        routes: WorkspaceImpactDiffList;
        contracts: WorkspaceImpactDiffList;
        tests: WorkspaceImpactDiffList;
        requirements: WorkspaceImpactStatusDiffList;
        assumptions: WorkspaceImpactStatusDiffList;
        acceptanceCases: WorkspaceImpactStatusDiffList;
        taskDefinitions: WorkspaceImpactStatusDiffList;
        taskRuns: {
            sourceCount: number;
            targetCount: number;
            statusDelta: TaskRunStatusCounts;
        };
        billing: {
            paymentStatusChanged: Array<{
                projectId: string;
                sourceStatus: "paid" | "unpaid" | "unknown";
                targetStatus: "paid" | "unpaid" | "unknown";
            }>;
            sourceEventCount: number;
            targetEventCount: number;
            addedEvents: string[];
            removedEvents: string[];
        };
    };
};

export type WorkspaceRevisionDiffResult =
    | {
        ok: true;
        diff: WorkspaceRevisionDiff;
    }
    | {
        ok: false;
        code:
            | "WORKSPACE_NOT_FOUND"
            | "INSUFFICIENT_REVISION_HISTORY"
            | "REVISION_NOT_FOUND"
            | "SNAPSHOT_NOT_FOUND"
            | "SNAPSHOT_PAYLOAD_UNAVAILABLE";
        message: string;
        availableRevisionIds?: string[];
    };

type WorkspaceDoc = {
    userId: string;
    tenantId: string | null;
    projects: Project[];
    revision: number;
    envelope: WorkspaceEnvelope;
    createdAt: Date | null;
    updatedAt: Date | null;
};

type WorkspaceSaveConflict = {
    ok: false;
    conflict: true;
    currentEnvelope: WorkspaceEnvelope;
};

type WorkspaceSaveSuccess = {
    ok: true;
    envelope: WorkspaceEnvelope;
};

export type WorkspacePatchSaveConflict = {
    ok: false;
    conflict: true;
    code: "WORKSPACE_PATCH_CONFLICT";
    message: string;
    currentEnvelope: WorkspaceEnvelope;
};

export type WorkspacePatchSaveSuccess = {
    ok: true;
    envelope: WorkspaceEnvelope;
    idempotent: boolean;
    rebaseCount: number;
    appliedOperations: number;
    progressCursor: string | null;
};

const WORKSPACE_DOCUMENT_WRITE_LIMIT_BYTES = 1_000_000;
const WORKSPACE_MIN_REVISION_HISTORY_FOR_COMPACTION = 8;
const WORKSPACE_MIN_SNAPSHOTS_FOR_COMPACTION = 4;
const WORKSPACE_MAX_MESSAGE_CHARS = 6_000;
const WORKSPACE_MAX_TEXT_ATTACHMENT_CHARS = 3_000;
const WORKSPACE_MAX_FILE_TREE_NODES = 220;
const WORKSPACE_REDUCED_MESSAGE_COUNT = 80;

export class WorkspaceRevisionConflictError extends Error {
    currentEnvelope: WorkspaceEnvelope;

    constructor(currentEnvelope: WorkspaceEnvelope) {
        super("Workspace revision conflict.");
        this.currentEnvelope = currentEnvelope;
    }
}

export class WorkspaceDocumentTooLargeError extends Error {
    estimatedBytes: number;
    limitBytes: number;

    constructor(estimatedBytes: number, limitBytes: number) {
        super("Workspace document exceeds storage size limits.");
        this.estimatedBytes = estimatedBytes;
        this.limitBytes = limitBytes;
    }
}

class WorkspacePatchConflictError extends Error {
    currentEnvelope: WorkspaceEnvelope;
    code: "WORKSPACE_PATCH_CONFLICT";

    constructor(message: string, currentEnvelope: WorkspaceEnvelope) {
        super(message);
        this.currentEnvelope = currentEnvelope;
        this.code = "WORKSPACE_PATCH_CONFLICT";
    }
}

function workspacesCollection() {
    return adminDb.collection("workspaces");
}

function uniqueIds(values: string[]) {
    return Array.from(new Set(values.filter(Boolean)));
}

function areProjectListsEquivalent(left: Project[], right: Project[]) {
    try {
        return JSON.stringify(normalizeProjects(left)) === JSON.stringify(normalizeProjects(right));
    } catch {
        return false;
    }
}

function buildWorkspaceOperationDigest(operations: WorkspacePatchOperation[]) {
    const payload = JSON.stringify(operations);
    return createHash("sha1").update(payload, "utf8").digest("hex");
}

function findRevisionByIdempotencyKey(envelope: WorkspaceEnvelope, idempotencyKey: string) {
    if (!idempotencyKey) return null;
    return envelope.revisionHistory.find((revision) => revision.changeSet.idempotencyKey === idempotencyKey) || null;
}

function normalizeWorkspacePatchOperations(operations: WorkspacePatchOperation[]): WorkspacePatchOperation[] {
    const normalized: WorkspacePatchOperation[] = [];
    for (const operation of operations) {
        if (operation.type === "replace_projects") {
            normalized.push({
                type: "replace_projects",
                projects: normalizeProjects(operation.projects)
            });
            continue;
        }
        if (operation.type === "upsert_project") {
            const normalizedProject = normalizeProjects([operation.project])[0];
            if (!normalizedProject?.id) continue;
            normalized.push({
                type: "upsert_project",
                project: normalizedProject
            });
            continue;
        }
        if (operation.type === "remove_project") {
            const projectId = operation.projectId.trim();
            if (!projectId) continue;
            normalized.push({
                type: "remove_project",
                projectId
            });
            continue;
        }
        if (operation.type === "append_progress_events") {
            const normalizedProgressState = normalizeProgressState(operation.progressState as unknown) as ProgressStateV1 | null;
            normalized.push({
                type: "append_progress_events",
                projectId: operation.projectId.trim(),
                versionId: operation.versionId.trim(),
                events: normalizeProgressEvents(operation.events as unknown),
                progressState: normalizedProgressState ?? undefined
            });
        }
    }
    return normalized;
}

function applyAppendProgressEventsOperation(input: {
    projects: Project[];
    operation: Extract<WorkspacePatchOperation, { type: "append_progress_events" }>;
}): {
    projects: Project[];
    progressCursor: string | null;
    applied: boolean;
} {
    const operation = input.operation;
    const projectId = operation.projectId.trim();
    const versionId = operation.versionId.trim();
    if (!projectId || !versionId) {
        throw new Error("append_progress_events requires projectId and versionId.");
    }
    const incomingEvents = normalizeProgressEvents(operation.events);
    if (incomingEvents.length === 0 && !operation.progressState) {
        return {
            projects: input.projects,
            progressCursor: null,
            applied: false
        };
    }

    let touchedProject = false;
    let touchedVersion = false;
    let latestCursor: string | null = null;
    const nextProjects = input.projects.map((project) => {
        if (project.id !== projectId) return project;
        touchedProject = true;
        let projectVersionTouched = false;
        const nextVersions = project.versions.map((version) => {
            if (version.id !== versionId) return version;
            touchedVersion = true;
            projectVersionTouched = true;
            const currentEvents = normalizeProgressEvents(version.data.progressEvents);
            const nextEvents = appendProgressEvents(currentEvents, incomingEvents);
            latestCursor = resolveProgressCursor(nextEvents) || null;
            return {
                ...version,
                data: {
                    ...version.data,
                    progressEvents: nextEvents,
                    progressState: operation.progressState ?? version.data.progressState,
                    progressCursor: latestCursor || version.data.progressCursor
                }
            };
        });
        return {
            ...project,
            updatedAt: projectVersionTouched ? Date.now() : project.updatedAt,
            versions: nextVersions
        };
    });

    if (!touchedProject) {
        throw new Error(`append_progress_events projectId ${projectId} was not found in workspace.`);
    }
    if (!touchedVersion) {
        throw new Error(`append_progress_events versionId ${versionId} was not found in project ${projectId}.`);
    }

    return {
        projects: nextProjects,
        progressCursor: latestCursor,
        applied: true
    };
}

function applyWorkspacePatchOperations(input: {
    envelope: WorkspaceEnvelope;
    operations: WorkspacePatchOperation[];
}): {
    projects: Project[];
    appliedOperations: number;
    progressCursor: string | null;
} {
    let projects = normalizeProjects(input.envelope.projects);
    let appliedOperations = 0;
    let progressCursor: string | null = null;

    for (const operation of normalizeWorkspacePatchOperations(input.operations)) {
        if (operation.type === "replace_projects") {
            projects = normalizeProjects(operation.projects);
            appliedOperations += 1;
            continue;
        }
        if (operation.type === "upsert_project") {
            const existingIndex = projects.findIndex((project) => project.id === operation.project.id);
            if (existingIndex < 0) {
                projects = [operation.project, ...projects];
                appliedOperations += 1;
                continue;
            }

            const existingProject = projects[existingIndex];
            if (areProjectListsEquivalent([existingProject], [operation.project])) {
                continue;
            }

            const nextProjects = [...projects];
            nextProjects[existingIndex] = operation.project;
            projects = nextProjects;
            appliedOperations += 1;
            continue;
        }
        if (operation.type === "remove_project") {
            const nextProjects = projects.filter((project) => project.id !== operation.projectId);
            if (nextProjects.length === projects.length) {
                continue;
            }
            projects = nextProjects;
            appliedOperations += 1;
            continue;
        }
        if (operation.type === "append_progress_events") {
            const applied = applyAppendProgressEventsOperation({
                projects,
                operation
            });
            projects = applied.projects;
            if (applied.applied) {
                appliedOperations += 1;
            }
            if (applied.progressCursor) {
                progressCursor = applied.progressCursor;
            }
            continue;
        }
    }

    return {
        projects,
        appliedOperations,
        progressCursor
    };
}

function resolveProgressCursorFromEnvelope(
    envelope: WorkspaceEnvelope,
    projectId?: string | null,
    versionId?: string | null
) {
    const scopedProjectId = (projectId || "").trim();
    const scopedVersionId = (versionId || "").trim();
    const preferredProject = scopedProjectId
        ? envelope.projects.find((project) => project.id === scopedProjectId) || null
        : null;

    if (preferredProject) {
        const preferredVersion = scopedVersionId
            ? preferredProject.versions.find((version) => version.id === scopedVersionId) || null
            : preferredProject.versions[preferredProject.versions.length - 1] || null;
        if (preferredVersion?.data?.progressCursor) {
            return preferredVersion.data.progressCursor;
        }
    }

    for (const project of envelope.projects) {
        const latestVersion = project.versions[project.versions.length - 1];
        if (latestVersion?.data?.progressCursor) {
            return latestVersion.data.progressCursor;
        }
    }

    return null;
}

function diffIds(source: string[], compareTo: string[]) {
    const compareSet = new Set(compareTo);
    return uniqueIds(source).filter((value) => !compareSet.has(value));
}

function buildCurrentActiveVersionIds(envelope: WorkspaceEnvelope) {
    return uniqueIds(
        envelope.projects
            .map((project) => project.versions[project.versions.length - 1]?.id || "")
    );
}

function sortStrings(values: Iterable<string>) {
    return Array.from(new Set(Array.from(values).filter(Boolean))).sort((left, right) => left.localeCompare(right));
}

function buildMapDiff(source: Map<string, string>, target: Map<string, string>): WorkspaceImpactDiffList {
    const sourceKeys = new Set(source.keys());
    const targetKeys = new Set(target.keys());

    const added = sortStrings(Array.from(targetKeys).filter((key) => !sourceKeys.has(key)));
    const removed = sortStrings(Array.from(sourceKeys).filter((key) => !targetKeys.has(key)));
    const changed = sortStrings(
        Array.from(sourceKeys)
            .filter((key) => targetKeys.has(key))
            .filter((key) => source.get(key) !== target.get(key))
    );

    return { added, removed, changed };
}

function buildStatusDiff(
    source: Map<string, string>,
    target: Map<string, string>,
    sourceStatuses: Map<string, string>,
    targetStatuses: Map<string, string>
): WorkspaceImpactStatusDiffList {
    const base = buildMapDiff(source, target);
    const sharedKeys = Array.from(sourceStatuses.keys()).filter((key) => targetStatuses.has(key));
    const statusChanged = sortStrings(
        sharedKeys.filter((key) => sourceStatuses.get(key) !== targetStatuses.get(key))
    );
    return {
        ...base,
        statusChanged
    };
}

function createEmptyTaskRunStatusCounts(): TaskRunStatusCounts {
    return {
        queued: 0,
        running: 0,
        succeeded: 0,
        failed: 0,
        blocked: 0
    };
}

function sumTaskRunStatusCounts(source: TaskRunStatusCounts): number {
    return source.queued + source.running + source.succeeded + source.failed + source.blocked;
}

function buildTaskRunStatusDelta(source: TaskRunStatusCounts, target: TaskRunStatusCounts): TaskRunStatusCounts {
    return {
        queued: target.queued - source.queued,
        running: target.running - source.running,
        succeeded: target.succeeded - source.succeeded,
        failed: target.failed - source.failed,
        blocked: target.blocked - source.blocked
    };
}

function safeText(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

function safeArray(value: unknown) {
    return Array.isArray(value) ? value : [];
}

function buildFingerprint(parts: unknown[]) {
    return parts
        .map((part) => {
            if (part === null || part === undefined) return "";
            if (typeof part === "string") return part.trim();
            if (typeof part === "number" || typeof part === "boolean") return String(part);
            try {
                return JSON.stringify(part);
            } catch {
                return String(part);
            }
        })
        .join("|");
}

function getLatestProjectVersion(project: Project): ProjectVersion | null {
    if (!Array.isArray(project.versions) || project.versions.length === 0) return null;
    return project.versions[project.versions.length - 1] || null;
}

function withProjectPrefix(projectId: string, key: string) {
    return `${projectId}:${key}`;
}

function pushContractSpecSignals(
    projectId: string,
    map: Map<string, string>,
    contractSpecs: ContractSpec[] | undefined
) {
    for (const spec of contractSpecs || []) {
        const identity = withProjectPrefix(projectId, `contract:${safeText(spec.id) || safeText(spec.name)}`);
        const fingerprint = buildFingerprint([
            safeText(spec.name),
            safeText(spec.kind),
            safeText(spec.producer),
            safeText(spec.consumer),
            safeText(spec.schemaSummary),
            safeText(spec.status)
        ]);
        if (identity && fingerprint) {
            map.set(identity, fingerprint);
        }
    }
}

function pushRequirementSignals(
    projectId: string,
    map: Map<string, string>,
    statusMap: Map<string, string>,
    requirements: RequirementRecord[] | undefined
) {
    for (const record of requirements || []) {
        const id = withProjectPrefix(projectId, `requirement:${safeText(record.id) || safeText(record.title)}`);
        const status = safeText(record.status) || "unknown";
        const fingerprint = buildFingerprint([
            safeText(record.title),
            safeText(record.summary),
            status,
            safeArray(record.riskNotes)
        ]);
        if (!id || !fingerprint) continue;
        map.set(id, fingerprint);
        statusMap.set(id, status);
    }
}

function pushAssumptionSignals(
    projectId: string,
    map: Map<string, string>,
    statusMap: Map<string, string>,
    assumptions: AssumptionRecord[] | undefined
) {
    for (const assumption of assumptions || []) {
        const id = withProjectPrefix(projectId, `assumption:${safeText(assumption.id) || safeText(assumption.statement)}`);
        const status = safeText(assumption.status) || "unknown";
        const fingerprint = buildFingerprint([
            safeText(assumption.statement),
            status
        ]);
        if (!id || !fingerprint) continue;
        map.set(id, fingerprint);
        statusMap.set(id, status);
    }
}

function pushAcceptanceSignals(
    projectId: string,
    map: Map<string, string>,
    statusMap: Map<string, string>,
    acceptanceCases: AcceptanceCase[] | undefined
) {
    for (const acceptanceCase of acceptanceCases || []) {
        const id = withProjectPrefix(projectId, `acceptance:${safeText(acceptanceCase.id) || safeText(acceptanceCase.title)}`);
        const status = safeText(acceptanceCase.status) || "unknown";
        const fingerprint = buildFingerprint([
            safeText(acceptanceCase.title),
            safeText(acceptanceCase.scenario),
            status
        ]);
        if (!id || !fingerprint) continue;
        map.set(id, fingerprint);
        statusMap.set(id, status);
    }
}

function pushTaskDefinitionSignals(
    projectId: string,
    map: Map<string, string>,
    statusMap: Map<string, string>,
    taskDefinitions: TaskDefinition[] | undefined
) {
    for (const definition of taskDefinitions || []) {
        const id = withProjectPrefix(projectId, `task:${safeText(definition.id) || safeText(definition.title)}`);
        const status = safeText(definition.status) || "unknown";
        const fingerprint = buildFingerprint([
            safeText(definition.title),
            safeText(definition.owner),
            status,
            safeArray(definition.dependsOn),
            safeText(definition.inputSummary),
            safeText(definition.outputSummary),
            safeText(definition.verifyCommand),
            safeText(definition.rollbackHint)
        ]);
        if (!id || !fingerprint) continue;
        map.set(id, fingerprint);
        statusMap.set(id, status);
    }
}

type WorkspaceSignalSnapshot = {
    projectIds: string[];
    activeVersionIds: string[];
    modules: Map<string, string>;
    routes: Map<string, string>;
    contracts: Map<string, string>;
    tests: Map<string, string>;
    requirements: Map<string, string>;
    requirementStatuses: Map<string, string>;
    assumptions: Map<string, string>;
    assumptionStatuses: Map<string, string>;
    acceptanceCases: Map<string, string>;
    acceptanceStatuses: Map<string, string>;
    taskDefinitions: Map<string, string>;
    taskDefinitionStatuses: Map<string, string>;
    taskRunCounts: TaskRunStatusCounts;
    paymentStatuses: Map<string, "paid" | "unpaid" | "unknown">;
    billingEventKeys: Set<string>;
};

function collectWorkspaceSignals(projects: Project[]): WorkspaceSignalSnapshot {
    const projectIds = sortStrings(projects.map((project) => project.id));
    const activeVersionIds: string[] = [];
    const modules = new Map<string, string>();
    const routes = new Map<string, string>();
    const contracts = new Map<string, string>();
    const tests = new Map<string, string>();
    const requirements = new Map<string, string>();
    const requirementStatuses = new Map<string, string>();
    const assumptions = new Map<string, string>();
    const assumptionStatuses = new Map<string, string>();
    const acceptanceCases = new Map<string, string>();
    const acceptanceStatuses = new Map<string, string>();
    const taskDefinitions = new Map<string, string>();
    const taskDefinitionStatuses = new Map<string, string>();
    const taskRunCounts = createEmptyTaskRunStatusCounts();
    const paymentStatuses = new Map<string, "paid" | "unpaid" | "unknown">();
    const billingEventKeys = new Set<string>();

    for (const project of projects) {
        const latestVersion = getLatestProjectVersion(project);
        if (!latestVersion) continue;

        if (latestVersion.id) {
            activeVersionIds.push(latestVersion.id);
        }

        const data: ProjectVersionData = latestVersion.data || {
            messages: [],
            evaluation: null,
            generation: null,
            currentDiagram: "",
            tasks: []
        };

        const architecturePack = data.architecturePack;
        for (const boundedContext of architecturePack?.boundedContexts || []) {
            const key = withProjectPrefix(project.id, `module:bounded:${safeText(boundedContext.name)}`);
            const fingerprint = buildFingerprint([
                safeText(boundedContext.name),
                safeText(boundedContext.responsibility),
                safeArray(boundedContext.owns),
                safeArray(boundedContext.dependencies)
            ]);
            if (key && fingerprint) {
                modules.set(key, fingerprint);
            }
        }
        for (const moduleResponsibility of architecturePack?.moduleResponsibilities || []) {
            const key = withProjectPrefix(project.id, `module:responsibility:${safeText(moduleResponsibility.module)}`);
            const fingerprint = buildFingerprint([
                safeText(moduleResponsibility.module),
                safeText(moduleResponsibility.responsibility),
                safeArray(moduleResponsibility.inputs),
                safeArray(moduleResponsibility.outputs)
            ]);
            if (key && fingerprint) {
                modules.set(key, fingerprint);
            }
        }

        for (const screen of data.uiDesignSpec?.screens || []) {
            const route = safeText(screen.route);
            if (!route) continue;
            const key = withProjectPrefix(project.id, `route:${route}`);
            const fingerprint = buildFingerprint([
                route,
                safeText(screen.name),
                safeText(screen.id),
                safeText(screen.layout?.type),
                safeArray(screen.layout?.sections),
                safeArray(screen.components),
                safeText(screen.states?.loading),
                safeText(screen.states?.empty),
                safeText(screen.states?.error),
                safeText(screen.states?.success),
                safeArray(screen.interactions)
            ]);
            routes.set(key, fingerprint);
        }

        for (const contract of architecturePack?.integrationContracts || []) {
            const key = withProjectPrefix(
                project.id,
                `contract:integration:${safeText(contract.name)}:${safeText(contract.producer)}->${safeText(contract.consumer)}`
            );
            const fingerprint = buildFingerprint([
                safeText(contract.name),
                safeText(contract.kind),
                safeText(contract.producer),
                safeText(contract.consumer),
                safeText(contract.payload),
                safeText(contract.notes)
            ]);
            if (key && fingerprint) {
                contracts.set(key, fingerprint);
            }
        }
        pushContractSpecSignals(project.id, contracts, data.contractSpecs);

        for (const testStrategyItem of data.guardrailChecklist?.testStrategy || []) {
            const normalized = safeText(testStrategyItem);
            if (!normalized) continue;
            const key = withProjectPrefix(project.id, `test:strategy:${normalized}`);
            tests.set(key, buildFingerprint([normalized]));
        }
        for (const definition of data.taskDefinitions || []) {
            const verifyCommand = safeText(definition.verifyCommand);
            if (!verifyCommand) continue;
            const key = withProjectPrefix(project.id, `test:verify:${verifyCommand}`);
            const fingerprint = buildFingerprint([
                verifyCommand,
                safeText(definition.title),
                safeText(definition.status)
            ]);
            tests.set(key, fingerprint);
        }

        pushRequirementSignals(project.id, requirements, requirementStatuses, data.requirements);
        pushAssumptionSignals(project.id, assumptions, assumptionStatuses, data.assumptions);
        pushAcceptanceSignals(project.id, acceptanceCases, acceptanceStatuses, data.acceptanceCases);
        pushTaskDefinitionSignals(project.id, taskDefinitions, taskDefinitionStatuses, data.taskDefinitions);

        for (const run of data.taskRuns || []) {
            if (run.status in taskRunCounts) {
                taskRunCounts[run.status as TaskRunStatus] += 1;
            }
        }

        paymentStatuses.set(
            project.id,
            data.paymentStatus === "paid"
                ? "paid"
                : data.paymentStatus === "unpaid"
                ? "unpaid"
                : "unknown"
        );

        for (const event of data.billingEvents || []) {
            const identity = withProjectPrefix(
                project.id,
                `billing:${safeText(event.id) || safeText(event.providerEventId) || safeText(event.eventType)}:${safeText(event.status)}:${safeText(event.currency)}:${event.amountCents}`
            );
            if (identity) {
                billingEventKeys.add(identity);
            }
        }
    }

    return {
        projectIds,
        activeVersionIds: sortStrings(activeVersionIds),
        modules,
        routes,
        contracts,
        tests,
        requirements,
        requirementStatuses,
        assumptions,
        assumptionStatuses,
        acceptanceCases,
        acceptanceStatuses,
        taskDefinitions,
        taskDefinitionStatuses,
        taskRunCounts,
        paymentStatuses,
        billingEventKeys
    };
}

function resolveSnapshotProjects(
    envelope: WorkspaceEnvelope,
    snapshotId: string
): Project[] | null {
    const snapshot = envelope.snapshots.find((candidate) => candidate.id === snapshotId);
    if (!snapshot) return null;
    if (Array.isArray(snapshot.projects)) {
        return snapshot.projects;
    }
    const latestSnapshotId = envelope.snapshots[0]?.id;
    if (latestSnapshotId && latestSnapshotId === snapshotId) {
        return envelope.projects;
    }
    return null;
}

function toWorkspaceRevisionTimelineItem(
    envelope: WorkspaceEnvelope,
    revisionId: string
): WorkspaceRevisionTimelineItem | null {
    const revision = envelope.revisionHistory.find((candidate) => candidate.id === revisionId);
    if (!revision) return null;
    const snapshot = envelope.snapshots.find((candidate) => candidate.id === revision.snapshotId);
    return {
        revisionId: revision.id,
        revisionNumber: revision.number,
        snapshotId: revision.snapshotId,
        createdAt: revision.createdAt,
        summary: revision.changeSet.summary,
        kind: revision.changeSet.kind,
        actorId: revision.changeSet.actorId ?? null,
        actorEmail: revision.changeSet.actorEmail ?? null,
        projectCount: snapshot?.projectIds.length || 0,
        activeVersionCount: snapshot?.activeVersionIds.length || 0,
        hasSnapshotPayload: Array.isArray(snapshot?.projects)
    };
}

function listWorkspaceRevisionTimeline(envelope: WorkspaceEnvelope): WorkspaceRevisionTimelineItem[] {
    return envelope.revisionHistory
        .slice()
        .sort((left, right) => right.number - left.number)
        .map((revision) => toWorkspaceRevisionTimelineItem(envelope, revision.id))
        .filter((item): item is WorkspaceRevisionTimelineItem => Boolean(item));
}

function stripUndefinedForFirestore<T>(value: T): T {
    if (Array.isArray(value)) {
        return value.map((item) => stripUndefinedForFirestore(item)) as T;
    }
    if (value instanceof Date) {
        return value;
    }
    if (value && typeof value === "object") {
        const next: Record<string, unknown> = {};
        for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
            if (entry === undefined) continue;
            next[key] = stripUndefinedForFirestore(entry);
        }
        return next as T;
    }
    return value;
}

function serializeWorkspaceDocument(envelope: WorkspaceEnvelope) {
    return stripUndefinedForFirestore({
        version: envelope.version,
        ownerUserId: envelope.ownerUserId,
        tenantId: envelope.tenantId ?? null,
        userId: envelope.ownerUserId,
        projects: envelope.projects,
        revision: envelope.revision,
        revisionHistory: envelope.revisionHistory.map((revision) => ({
            ...revision,
            createdAt: new Date(revision.createdAt),
            changeSet: {
                ...revision.changeSet,
                createdAt: new Date(revision.changeSet.createdAt)
            }
        })),
        snapshots: envelope.snapshots.map((snapshot) => ({
            ...snapshot,
            createdAt: new Date(snapshot.createdAt),
            projects: snapshot.projects ?? null
        })),
        releaseTags: envelope.releaseTags.map((tag) => ({
            ...tag,
            createdAt: new Date(tag.createdAt)
        })),
        createdAt: new Date(envelope.createdAt),
        updatedAt: new Date(envelope.updatedAt)
    });
}

function estimateWorkspaceDocumentBytes(envelope: WorkspaceEnvelope) {
    try {
        return Buffer.byteLength(JSON.stringify(serializeWorkspaceDocument(envelope)), "utf8");
    } catch {
        return Number.POSITIVE_INFINITY;
    }
}

function dropSnapshotProjects(snapshot: WorkspaceEnvelope["snapshots"][number]) {
    if (!Array.isArray(snapshot.projects)) return snapshot;
    const nextSnapshot = { ...snapshot };
    delete nextSnapshot.projects;
    return nextSnapshot;
}

function clipWorkspaceText(text: string, maxChars: number) {
    if (text.length <= maxChars) return text;
    return `${text.slice(0, maxChars)}\n...[truncated for workspace storage]`;
}

function compactAttachmentForWorkspace(attachment: Attachment): Attachment {
    const content = typeof attachment.content === "string" ? attachment.content : "";
    if (!content) return attachment;
    if (attachment.type === "text") {
        const nextContent = clipWorkspaceText(content, WORKSPACE_MAX_TEXT_ATTACHMENT_CHARS);
        if (nextContent === content) return attachment;
        return {
            ...attachment,
            content: nextContent
        };
    }
    return {
        ...attachment,
        content: `[${attachment.type} attachment omitted for workspace storage]`
    };
}

function compactMessageForWorkspace(message: Message): Message {
    const nextContent = clipWorkspaceText(message.content || "", WORKSPACE_MAX_MESSAGE_CHARS);
    const nextAttachments = Array.isArray(message.attachments)
        ? message.attachments.map((attachment) => compactAttachmentForWorkspace(attachment))
        : undefined;
    if (nextContent === (message.content || "") && !nextAttachments) {
        return message;
    }
    return {
        ...message,
        content: nextContent,
        attachments: nextAttachments
    };
}

function compactFileTreeForWorkspace(nodes: FileNode[] | undefined): FileNode[] {
    if (!Array.isArray(nodes) || nodes.length === 0) return [];
    let remaining = WORKSPACE_MAX_FILE_TREE_NODES;

    const walk = (node: FileNode): FileNode | null => {
        if (remaining <= 0) return null;
        remaining -= 1;
        if (node.type === "folder") {
            const children: FileNode[] = [];
            for (const child of node.children || []) {
                const compactedChild = walk(child);
                if (compactedChild) {
                    children.push(compactedChild);
                }
                if (remaining <= 0) break;
            }
            return {
                name: node.name,
                type: "folder",
                children
            };
        }
        return {
            name: node.name,
            type: "file"
        };
    };

    const result: FileNode[] = [];
    for (const node of nodes) {
        const compactedNode = walk(node);
        if (compactedNode) {
            result.push(compactedNode);
        }
        if (remaining <= 0) break;
    }

    if (remaining <= 0) {
        result.push({
            name: "...truncated",
            type: "file"
        });
    }
    return result;
}

function compactGenerationForWorkspace(generation: GenerationResponse | null | undefined): GenerationResponse | null {
    if (!generation) return null;
    return {
        ...generation,
        projectTree: compactFileTreeForWorkspace(generation.projectTree)
    };
}

function compactVersionDataForWorkspace(data: ProjectVersionData, aggressive: boolean): ProjectVersionData {
    const compactedMessages = (data.messages || []).map((message) => compactMessageForWorkspace(message));
    const nextMessages = aggressive
        ? compactedMessages.slice(-WORKSPACE_REDUCED_MESSAGE_COUNT)
        : compactedMessages;
    const compactedPendingRequestMessages = data.pendingEvaluation?.requestMessages
        ? data.pendingEvaluation.requestMessages
            .map((message) => compactMessageForWorkspace(message))
            .slice(-Math.min(WORKSPACE_REDUCED_MESSAGE_COUNT, 40))
        : undefined;

    const compactedData: ProjectVersionData = {
        ...data,
        messages: nextMessages,
        generation: compactGenerationForWorkspace(data.generation),
        generationArtifacts: data.generationArtifacts
            ? {
                virtual_spec: compactGenerationForWorkspace(data.generationArtifacts.virtual_spec),
                runnable_scaffold: compactGenerationForWorkspace(data.generationArtifacts.runnable_scaffold)
            }
            : data.generationArtifacts,
        pendingEvaluation: data.pendingEvaluation
            ? {
                ...data.pendingEvaluation,
                requestMessages: compactedPendingRequestMessages || []
            }
            : data.pendingEvaluation
    };

    if (!aggressive) {
        return compactedData;
    }

    return {
        ...compactedData,
        providerRunLogs: (compactedData.providerRunLogs || []).slice(-40),
        taskRuns: (compactedData.taskRuns || []).slice(-80),
        billingEvents: (compactedData.billingEvents || []).slice(-60),
        progressEvents: normalizeProgressEvents(compactedData.progressEvents).slice(-200),
        progressCursor:
            (typeof compactedData.progressCursor === "string" && compactedData.progressCursor.trim())
                ? compactedData.progressCursor.trim()
                : resolveProgressCursor(normalizeProgressEvents(compactedData.progressEvents))
    };
}

function compactProjectsForWorkspace(projects: Project[], aggressive: boolean): Project[] {
    return projects.map((project) => ({
        ...project,
        versions: project.versions.map((version) => ({
            ...version,
            data: compactVersionDataForWorkspace(version.data, aggressive)
        }))
    }));
}

function syncLatestSnapshotProjects(envelope: WorkspaceEnvelope): WorkspaceEnvelope {
    if (!envelope.snapshots.length) return envelope;
    const latestSnapshot = envelope.snapshots[0];
    if (!Array.isArray(latestSnapshot.projects)) return envelope;
    const nextLatestSnapshot = {
        ...latestSnapshot,
        projects: envelope.projects
    };
    return {
        ...envelope,
        snapshots: [nextLatestSnapshot, ...envelope.snapshots.slice(1)]
    };
}

function compactWorkspaceEnvelopeForStorage(envelope: WorkspaceEnvelope): WorkspaceEnvelope {
    let candidate = envelope;
    let estimatedBytes = estimateWorkspaceDocumentBytes(candidate);
    if (estimatedBytes <= WORKSPACE_DOCUMENT_WRITE_LIMIT_BYTES) {
        return candidate;
    }

    const latestSnapshotId = candidate.snapshots[0]?.id ?? null;
    const releaseSnapshotIds = new Set(
        candidate.releaseTags
            .map((tag) => tag.snapshotId)
            .filter((snapshotId): snapshotId is string => typeof snapshotId === "string" && snapshotId.trim().length > 0)
    );

    const applySnapshotCompaction = (
        shouldDrop: (snapshotId: string, index: number) => boolean
    ) => {
        let changed = false;
        const snapshots = candidate.snapshots.map((snapshot, index) => {
            if (!Array.isArray(snapshot.projects)) return snapshot;
            if (!shouldDrop(snapshot.id, index)) return snapshot;
            changed = true;
            return dropSnapshotProjects(snapshot);
        });
        if (!changed) return false;
        candidate = {
            ...candidate,
            snapshots
        };
        estimatedBytes = estimateWorkspaceDocumentBytes(candidate);
        return true;
    };

    // First drop payloads that are neither latest nor release-tagged snapshots.
    applySnapshotCompaction((snapshotId) => snapshotId !== latestSnapshotId && !releaseSnapshotIds.has(snapshotId));
    if (estimatedBytes <= WORKSPACE_DOCUMENT_WRITE_LIMIT_BYTES) {
        return candidate;
    }

    // If still too large, drop latest snapshot payload unless it's release-tagged.
    if (latestSnapshotId && !releaseSnapshotIds.has(latestSnapshotId)) {
        applySnapshotCompaction((snapshotId) => snapshotId === latestSnapshotId);
    }
    if (estimatedBytes <= WORKSPACE_DOCUMENT_WRITE_LIMIT_BYTES) {
        return candidate;
    }

    // As a last resort, drop payloads from release snapshots starting from the oldest.
    const releaseSnapshotsByAge = candidate.snapshots
        .map((snapshot, index) => ({ id: snapshot.id, index }))
        .filter((snapshot) => releaseSnapshotIds.has(snapshot.id))
        .sort((left, right) => right.index - left.index);

    for (const releaseSnapshot of releaseSnapshotsByAge) {
        applySnapshotCompaction((snapshotId) => snapshotId === releaseSnapshot.id);
        if (estimatedBytes <= WORKSPACE_DOCUMENT_WRITE_LIMIT_BYTES) {
            return candidate;
        }
    }

    // Trim old revision metadata if payload is still close to the write ceiling.
    while (
        estimatedBytes > WORKSPACE_DOCUMENT_WRITE_LIMIT_BYTES
        && (
            candidate.revisionHistory.length > WORKSPACE_MIN_REVISION_HISTORY_FOR_COMPACTION
            || candidate.snapshots.length > WORKSPACE_MIN_SNAPSHOTS_FOR_COMPACTION
        )
    ) {
        const nextRevisionHistory = candidate.revisionHistory.length > WORKSPACE_MIN_REVISION_HISTORY_FOR_COMPACTION
            ? candidate.revisionHistory.slice(0, candidate.revisionHistory.length - 1)
            : candidate.revisionHistory;
        const nextSnapshots = candidate.snapshots.length > WORKSPACE_MIN_SNAPSHOTS_FOR_COMPACTION
            ? candidate.snapshots.slice(0, candidate.snapshots.length - 1)
            : candidate.snapshots;

        if (
            nextRevisionHistory.length === candidate.revisionHistory.length
            && nextSnapshots.length === candidate.snapshots.length
        ) {
            break;
        }

        candidate = {
            ...candidate,
            revisionHistory: nextRevisionHistory,
            snapshots: nextSnapshots
        };
        estimatedBytes = estimateWorkspaceDocumentBytes(candidate);
    }

    if (estimatedBytes > WORKSPACE_DOCUMENT_WRITE_LIMIT_BYTES) {
        candidate = syncLatestSnapshotProjects({
            ...candidate,
            projects: compactProjectsForWorkspace(candidate.projects, false)
        });
        estimatedBytes = estimateWorkspaceDocumentBytes(candidate);
    }

    if (estimatedBytes > WORKSPACE_DOCUMENT_WRITE_LIMIT_BYTES) {
        candidate = syncLatestSnapshotProjects({
            ...candidate,
            projects: compactProjectsForWorkspace(candidate.projects, true)
        });
        estimatedBytes = estimateWorkspaceDocumentBytes(candidate);
    }

    if (estimatedBytes > WORKSPACE_DOCUMENT_WRITE_LIMIT_BYTES) {
        throw new WorkspaceDocumentTooLargeError(estimatedBytes, WORKSPACE_DOCUMENT_WRITE_LIMIT_BYTES);
    }
    return candidate;
}

function toWorkspaceDocument(envelope: WorkspaceEnvelope) {
    return serializeWorkspaceDocument(envelope);
}

function persistWorkspaceEnvelopeSnapshot(
    transaction: Transaction,
    docRef: DocumentReference<DocumentData>,
    envelope: WorkspaceEnvelope
) {
    const compactedEnvelope = compactWorkspaceEnvelopeForStorage(envelope);
    transaction.set(docRef, toWorkspaceDocument(compactedEnvelope), { merge: false });
    return compactedEnvelope;
}

function fromWorkspaceSnapshot(userId: string, raw: unknown) {
    return normalizeWorkspaceEnvelope(raw, userId);
}

async function readWorkspaceEnvelope(userId: string) {
    const snap = await workspacesCollection().doc(userId).get();
    if (!snap.exists) return null;
    return fromWorkspaceSnapshot(userId, snap.data() || {});
}

export async function getWorkspaceEnvelopeByUserId(userId: string): Promise<WorkspaceEnvelope | null> {
    return readWorkspaceEnvelope(userId);
}

export async function getWorkspaceByUserId(userId: string): Promise<WorkspaceDoc | null> {
    const envelope = await readWorkspaceEnvelope(userId);
    if (!envelope) return null;

    return {
        userId,
        tenantId: envelope.tenantId ?? null,
        projects: envelope.projects,
        revision: envelope.revision,
        envelope,
        createdAt: toDateOrNull(envelope.createdAt),
        updatedAt: toDateOrNull(envelope.updatedAt)
    };
}

export async function getWorkspaceRevisionOverviewByUserId(userId: string): Promise<WorkspaceRevisionOverview | null> {
    const envelope = await readWorkspaceEnvelope(userId);
    if (!envelope) return null;

    return {
        ownerUserId: envelope.ownerUserId,
        tenantId: envelope.tenantId ?? null,
        revision: envelope.revision,
        projectCount: envelope.projects.length,
        updatedAt: envelope.updatedAt,
        revisions: listWorkspaceRevisionTimeline(envelope)
    };
}

export async function diffWorkspaceRevisionsByUserId(input: {
    userId: string;
    fromRevisionId?: string | null;
    toRevisionId?: string | null;
}): Promise<WorkspaceRevisionDiffResult> {
    const envelope = await readWorkspaceEnvelope(input.userId);
    if (!envelope) {
        return {
            ok: false,
            code: "WORKSPACE_NOT_FOUND",
            message: "Workspace not found."
        };
    }

    const timeline = listWorkspaceRevisionTimeline(envelope);
    const availableRevisionIds = timeline.map((item) => item.revisionId);
    if (timeline.length < 2) {
        return {
            ok: false,
            code: "INSUFFICIENT_REVISION_HISTORY",
            message: "At least two workspace revisions are required to compute a diff.",
            availableRevisionIds
        };
    }

    const targetRevisionId = safeText(input.toRevisionId) || timeline[0]?.revisionId || "";
    const sourceRevisionId = safeText(input.fromRevisionId)
        || timeline.find((item) => item.revisionId !== targetRevisionId)?.revisionId
        || "";

    if (!sourceRevisionId || !targetRevisionId) {
        return {
            ok: false,
            code: "INSUFFICIENT_REVISION_HISTORY",
            message: "Could not resolve source and target revisions for diff.",
            availableRevisionIds
        };
    }

    const source = toWorkspaceRevisionTimelineItem(envelope, sourceRevisionId);
    const target = toWorkspaceRevisionTimelineItem(envelope, targetRevisionId);
    if (!source || !target) {
        return {
            ok: false,
            code: "REVISION_NOT_FOUND",
            message: "Requested revision was not found in this workspace envelope.",
            availableRevisionIds
        };
    }

    const sourceSnapshot = envelope.snapshots.find((snapshot) => snapshot.id === source.snapshotId);
    const targetSnapshot = envelope.snapshots.find((snapshot) => snapshot.id === target.snapshotId);
    if (!sourceSnapshot || !targetSnapshot) {
        return {
            ok: false,
            code: "SNAPSHOT_NOT_FOUND",
            message: "One or more revision snapshots are missing from this workspace envelope.",
            availableRevisionIds
        };
    }

    const sourceProjects = resolveSnapshotProjects(envelope, source.snapshotId);
    const targetProjects = resolveSnapshotProjects(envelope, target.snapshotId);
    if (!sourceProjects || !targetProjects) {
        return {
            ok: false,
            code: "SNAPSHOT_PAYLOAD_UNAVAILABLE",
            message: "One or more revisions were created before snapshot payload persistence and cannot be compared automatically.",
            availableRevisionIds
        };
    }

    const sourceSignals = collectWorkspaceSignals(sourceProjects);
    const targetSignals = collectWorkspaceSignals(targetProjects);
    const toIdentityMap = (values: string[]) => new Map(values.map((value) => [value, value]));
    const projectIds = buildMapDiff(toIdentityMap(sourceSignals.projectIds), toIdentityMap(targetSignals.projectIds));
    const activeVersionIds = buildMapDiff(
        toIdentityMap(sourceSignals.activeVersionIds),
        toIdentityMap(targetSignals.activeVersionIds)
    );

    const paymentStatusChanged = sortStrings(
        Array.from(new Set([
            ...Array.from(sourceSignals.paymentStatuses.keys()),
            ...Array.from(targetSignals.paymentStatuses.keys())
        ]))
    )
        .map((projectId) => ({
            projectId,
            sourceStatus: sourceSignals.paymentStatuses.get(projectId) || "unknown",
            targetStatus: targetSignals.paymentStatuses.get(projectId) || "unknown"
        }))
        .filter((item) => item.sourceStatus !== item.targetStatus);

    const addedBillingEvents = sortStrings(
        Array.from(targetSignals.billingEventKeys).filter((identity) => !sourceSignals.billingEventKeys.has(identity))
    );
    const removedBillingEvents = sortStrings(
        Array.from(sourceSignals.billingEventKeys).filter((identity) => !targetSignals.billingEventKeys.has(identity))
    );

    return {
        ok: true,
        diff: {
            ownerUserId: envelope.ownerUserId,
            tenantId: envelope.tenantId ?? null,
            source,
            target,
            impact: {
                projectIds,
                activeVersionIds,
                modules: buildMapDiff(sourceSignals.modules, targetSignals.modules),
                routes: buildMapDiff(sourceSignals.routes, targetSignals.routes),
                contracts: buildMapDiff(sourceSignals.contracts, targetSignals.contracts),
                tests: buildMapDiff(sourceSignals.tests, targetSignals.tests),
                requirements: buildStatusDiff(
                    sourceSignals.requirements,
                    targetSignals.requirements,
                    sourceSignals.requirementStatuses,
                    targetSignals.requirementStatuses
                ),
                assumptions: buildStatusDiff(
                    sourceSignals.assumptions,
                    targetSignals.assumptions,
                    sourceSignals.assumptionStatuses,
                    targetSignals.assumptionStatuses
                ),
                acceptanceCases: buildStatusDiff(
                    sourceSignals.acceptanceCases,
                    targetSignals.acceptanceCases,
                    sourceSignals.acceptanceStatuses,
                    targetSignals.acceptanceStatuses
                ),
                taskDefinitions: buildStatusDiff(
                    sourceSignals.taskDefinitions,
                    targetSignals.taskDefinitions,
                    sourceSignals.taskDefinitionStatuses,
                    targetSignals.taskDefinitionStatuses
                ),
                taskRuns: {
                    sourceCount: sumTaskRunStatusCounts(sourceSignals.taskRunCounts),
                    targetCount: sumTaskRunStatusCounts(targetSignals.taskRunCounts),
                    statusDelta: buildTaskRunStatusDelta(sourceSignals.taskRunCounts, targetSignals.taskRunCounts)
                },
                billing: {
                    paymentStatusChanged,
                    sourceEventCount: sourceSignals.billingEventKeys.size,
                    targetEventCount: targetSignals.billingEventKeys.size,
                    addedEvents: addedBillingEvents,
                    removedEvents: removedBillingEvents
                }
            }
        }
    };
}

export async function saveWorkspaceEnvelopeByUserId(input: {
    userId: string;
    tenantId?: string | null;
    projects: Project[];
    expectedRevision: number;
    actorId?: string | null;
    actorEmail?: string | null;
    changeSummary?: string;
}): Promise<WorkspaceSaveConflict | WorkspaceSaveSuccess> {
    const docRef = workspacesCollection().doc(input.userId);
    let committedEnvelope: WorkspaceEnvelope | null = null;
    let didPersistMutation = false;

    try {
        await adminDb.runTransaction(async (transaction) => {
            const snap = await transaction.get(docRef);
            const currentEnvelope = snap.exists
                ? fromWorkspaceSnapshot(input.userId, snap.data() || {})
                : createEmptyWorkspaceEnvelope(input.userId, input.tenantId ?? null);

            if (currentEnvelope.revision !== input.expectedRevision) {
                if (areProjectListsEquivalent(currentEnvelope.projects, input.projects)) {
                    committedEnvelope = currentEnvelope;
                    return;
                }
                throw new WorkspaceRevisionConflictError(currentEnvelope);
            }

            const nextEnvelope = createNextWorkspaceEnvelope(currentEnvelope, {
                tenantId: input.tenantId ?? currentEnvelope.tenantId ?? null,
                projects: input.projects,
                summary: input.changeSummary,
                actorId: input.actorId,
                actorEmail: input.actorEmail,
                saveMode: "snapshot"
            });

            const persistedEnvelope = persistWorkspaceEnvelopeSnapshot(transaction, docRef, nextEnvelope);
            committedEnvelope = persistedEnvelope;
            didPersistMutation = true;
        });
    } catch (error) {
        if (error instanceof WorkspaceRevisionConflictError) {
            return {
                ok: false,
                conflict: true,
                currentEnvelope: error.currentEnvelope
            };
        }
        throw error;
    }

    if (!committedEnvelope) {
        throw new Error("Workspace save completed without a committed envelope.");
    }
    const savedEnvelope = committedEnvelope as WorkspaceEnvelope;

    if (!didPersistMutation) {
        return {
            ok: true,
            envelope: savedEnvelope
        };
    }

    await recordAuditEvent({
        eventType: "workspace.saved",
        severity: "info",
        actorId: input.actorId ?? null,
        actorEmail: input.actorEmail ?? null,
        resourceType: "workspace",
        resourceId: input.userId,
        summary: input.changeSummary || "Workspace saved through optimistic concurrency.",
        metadata: {
            revision: String(savedEnvelope.revision),
            projectCount: String(savedEnvelope.projects.length)
        }
    });
    if (savedEnvelope.tenantId) {
        await syncTenantWorkspaceCount(savedEnvelope.tenantId);
    }

    return {
        ok: true,
        envelope: savedEnvelope
    };
}

export async function saveWorkspacePatchByUserId(input: {
    userId: string;
    tenantId?: string | null;
    expectedRevision: number;
    idempotencyKey: string;
    operations: WorkspacePatchOperation[];
    projectId?: string | null;
    versionId?: string | null;
    actorId?: string | null;
    actorEmail?: string | null;
    changeSummary?: string;
}): Promise<WorkspacePatchSaveConflict | WorkspacePatchSaveSuccess> {
    const docRef = workspacesCollection().doc(input.userId);
    let committedEnvelope: WorkspaceEnvelope | null = null;
    let idempotent = false;
    let rebaseCount = 0;
    let appliedOperations = 0;
    let progressCursor: string | null = null;
    let didPersistMutation = false;
    const normalizedIdempotencyKey = input.idempotencyKey.trim();
    const normalizedOperations = normalizeWorkspacePatchOperations(input.operations);
    const operationDigest = buildWorkspaceOperationDigest(normalizedOperations);

    if (!normalizedIdempotencyKey) {
        return {
            ok: false,
            conflict: true,
            code: "WORKSPACE_PATCH_CONFLICT",
            message: "Patch save requires a non-empty idempotencyKey.",
            currentEnvelope: createEmptyWorkspaceEnvelope(input.userId, input.tenantId ?? null)
        };
    }

    try {
        await adminDb.runTransaction(async (transaction) => {
            const snap = await transaction.get(docRef);
            const currentEnvelope = snap.exists
                ? fromWorkspaceSnapshot(input.userId, snap.data() || {})
                : createEmptyWorkspaceEnvelope(input.userId, input.tenantId ?? null);
            rebaseCount = Math.max(0, currentEnvelope.revision - input.expectedRevision);

            const existingRevision = findRevisionByIdempotencyKey(currentEnvelope, normalizedIdempotencyKey);
            if (existingRevision) {
                const existingDigest = existingRevision.changeSet.operationDigest || "";
                if (existingDigest && existingDigest !== operationDigest) {
                    throw new WorkspacePatchConflictError(
                        "Idempotency key reuse detected with a different operation digest.",
                        currentEnvelope
                    );
                }

                committedEnvelope = currentEnvelope;
                idempotent = true;
                appliedOperations = 0;
                progressCursor = resolveProgressCursorFromEnvelope(
                    currentEnvelope,
                    input.projectId,
                    input.versionId
                );
                return;
            }

            let patchResult: ReturnType<typeof applyWorkspacePatchOperations>;
            try {
                patchResult = applyWorkspacePatchOperations({
                    envelope: currentEnvelope,
                    operations: normalizedOperations
                });
            } catch (error) {
                const message = error instanceof Error ? error.message : "Workspace patch operation failed.";
                throw new WorkspacePatchConflictError(message, currentEnvelope);
            }

            if (patchResult.appliedOperations <= 0) {
                committedEnvelope = currentEnvelope;
                idempotent = true;
                appliedOperations = 0;
                progressCursor = patchResult.progressCursor
                    || resolveProgressCursorFromEnvelope(currentEnvelope, input.projectId, input.versionId);
                return;
            }

            const nextEnvelope = createNextWorkspaceEnvelope(currentEnvelope, {
                tenantId: input.tenantId ?? currentEnvelope.tenantId ?? null,
                projects: patchResult.projects,
                summary: input.changeSummary || "Workspace patch update",
                actorId: input.actorId,
                actorEmail: input.actorEmail,
                saveMode: "patch",
                idempotencyKey: normalizedIdempotencyKey,
                operationDigest,
                rebaseCount,
                appliedOperations: patchResult.appliedOperations
            });

            const persistedEnvelope = persistWorkspaceEnvelopeSnapshot(transaction, docRef, nextEnvelope);
            committedEnvelope = persistedEnvelope;
            idempotent = false;
            appliedOperations = patchResult.appliedOperations;
            progressCursor = patchResult.progressCursor
                || resolveProgressCursorFromEnvelope(persistedEnvelope, input.projectId, input.versionId);
            didPersistMutation = true;
        });
    } catch (error) {
        if (error instanceof WorkspacePatchConflictError) {
            return {
                ok: false,
                conflict: true,
                code: error.code,
                message: error.message,
                currentEnvelope: error.currentEnvelope
            };
        }
        throw error;
    }

    if (!committedEnvelope) {
        throw new Error("Workspace patch save completed without a committed envelope.");
    }
    const savedEnvelope = committedEnvelope as WorkspaceEnvelope;

    if (didPersistMutation) {
        await recordAuditEvent({
            eventType: "workspace.patch_saved",
            severity: "info",
            actorId: input.actorId ?? null,
            actorEmail: input.actorEmail ?? null,
            resourceType: "workspace",
            resourceId: input.userId,
            summary: input.changeSummary || "Workspace patch saved through idempotent rebase flow.",
            metadata: {
                revision: String(savedEnvelope.revision),
                saveMode: "patch",
                idempotencyKey: normalizedIdempotencyKey,
                operationDigest,
                rebaseCount: String(rebaseCount),
                appliedOperations: String(appliedOperations),
                progressCursor: progressCursor || ""
            }
        });
        if (savedEnvelope.tenantId) {
            await syncTenantWorkspaceCount(savedEnvelope.tenantId);
        }
    }

    return {
        ok: true,
        envelope: savedEnvelope,
        idempotent,
        rebaseCount,
        appliedOperations,
        progressCursor
    };
}

export async function saveWorkspaceByUserId(userId: string, projects: Project[]) {
    const docRef = workspacesCollection().doc(userId);
    let committedEnvelope: WorkspaceEnvelope | null = null;

    await adminDb.runTransaction(async (transaction) => {
        const snap = await transaction.get(docRef);
        const currentEnvelope = snap.exists
            ? fromWorkspaceSnapshot(userId, snap.data() || {})
            : createEmptyWorkspaceEnvelope(userId);
        const nextEnvelope = createNextWorkspaceEnvelope(currentEnvelope, {
            projects,
            summary: "Workspace synchronized from a trusted server mutation.",
            saveMode: "snapshot"
        });
        const persistedEnvelope = persistWorkspaceEnvelopeSnapshot(transaction, docRef, nextEnvelope);
        committedEnvelope = persistedEnvelope;
    });

    return committedEnvelope;
}

export async function setWorkspaceTenantByUserId(input: {
    userId: string;
    tenantId: string;
    actorId?: string | null;
    actorEmail?: string | null;
    reason?: string | null;
}): Promise<WorkspaceEnvelope | null> {
    const userId = input.userId.trim();
    const normalizedTenantId = input.tenantId.trim();
    if (!userId || !normalizedTenantId) return null;

    const docRef = workspacesCollection().doc(userId);
    let committedEnvelope: WorkspaceEnvelope | null = null;
    let previousTenantId: string | null = null;
    let changed = false;

    await adminDb.runTransaction(async (transaction) => {
        const snap = await transaction.get(docRef);
        if (!snap.exists) return;

        const currentEnvelope = fromWorkspaceSnapshot(userId, snap.data() || {});
        previousTenantId = currentEnvelope.tenantId ?? null;

        if ((currentEnvelope.tenantId ?? null) === normalizedTenantId) {
            committedEnvelope = currentEnvelope;
            return;
        }

        const nextEnvelope = createNextWorkspaceEnvelope(currentEnvelope, {
            tenantId: normalizedTenantId,
            projects: currentEnvelope.projects,
            summary: `Updated workspace tenant binding to ${normalizedTenantId}.`,
            kind: "admin",
            actorId: input.actorId,
            actorEmail: input.actorEmail
        });
        const persistedEnvelope = persistWorkspaceEnvelopeSnapshot(transaction, docRef, nextEnvelope);
        committedEnvelope = persistedEnvelope;
        changed = true;
    });

    if (!committedEnvelope) return null;
    const boundEnvelope = committedEnvelope as WorkspaceEnvelope;

    await syncTenantWorkspaceCount(normalizedTenantId);
    if (previousTenantId && previousTenantId !== normalizedTenantId) {
        await syncTenantWorkspaceCount(previousTenantId);
    }

    if (changed) {
        await recordAuditEvent({
            eventType: "workspace.tenant_rebound",
            severity: "warning",
            actorId: input.actorId ?? null,
            actorEmail: input.actorEmail ?? null,
            resourceType: "workspace",
            resourceId: userId,
            summary: `Workspace ${userId} tenant binding moved to ${normalizedTenantId}.`,
            metadata: {
                userId,
                previousTenantId: previousTenantId || "",
                tenantId: normalizedTenantId,
                revision: String(boundEnvelope.revision),
                reason: input.reason || ""
            }
        });
    }

    return boundEnvelope;
}

export async function markProjectPaidInWorkspace(userId: string, projectId: string): Promise<boolean> {
    const docRef = workspacesCollection().doc(userId);
    let touched = false;

    await adminDb.runTransaction(async (transaction) => {
        const snap = await transaction.get(docRef);
        if (!snap.exists) return;

        const currentEnvelope = fromWorkspaceSnapshot(userId, snap.data() || {});
        const updatedProjects = currentEnvelope.projects.map((project) => {
            if (project.id !== projectId) return project;
            let projectTouched = false;
            const nextVersions = project.versions.map((version) => {
                if (version.data.paymentStatus === "paid") {
                    return version;
                }
                projectTouched = true;
                touched = true;
                return {
                    ...version,
                    data: {
                        ...version.data,
                        paymentStatus: "paid" as const
                    }
                };
            });
            if (!projectTouched) {
                return project;
            }
            return {
                ...project,
                updatedAt: Date.now(),
                versions: nextVersions
            };
        });

        if (!touched) return;

        const nextEnvelope = createNextWorkspaceEnvelope(currentEnvelope, {
            projects: updatedProjects,
            summary: `Marked project ${projectId} as paid.`,
            kind: "payment_update"
        });
        persistWorkspaceEnvelopeSnapshot(transaction, docRef, nextEnvelope);
    });

    if (touched) {
        await recordAuditEvent({
            eventType: "workspace.project_paid",
            severity: "info",
            resourceType: "workspace",
            resourceId: `${userId}:${projectId}`,
            summary: "Project payment status was synchronized into the workspace.",
            metadata: {
                userId,
                projectId
            }
        });
    }

    return touched;
}

export async function updateProjectVersionInWorkspaceByUserId(input: {
    userId: string;
    tenantId?: string | null;
    projectId: string;
    versionId: string;
    expectedRevision?: number;
    actorId?: string | null;
    actorEmail?: string | null;
    summary: string;
    kind?: WorkspaceChangeKind;
    mutateVersion: (version: ProjectVersion) => ProjectVersion;
}): Promise<WorkspaceEnvelope | null> {
    const docRef = workspacesCollection().doc(input.userId);
    let committedEnvelope: WorkspaceEnvelope | null = null;
    let touched = false;

    await adminDb.runTransaction(async (transaction) => {
        const snap = await transaction.get(docRef);
        if (!snap.exists) return;

        const currentEnvelope = fromWorkspaceSnapshot(input.userId, snap.data() || {});
        if (
            typeof input.expectedRevision === "number"
            && Number.isFinite(input.expectedRevision)
            && input.expectedRevision >= 0
            && currentEnvelope.revision !== input.expectedRevision
        ) {
            throw new WorkspaceRevisionConflictError(currentEnvelope);
        }
        const updatedProjects = currentEnvelope.projects.map((project) => {
            if (project.id !== input.projectId) return project;

            let projectTouched = false;
            const nextVersions = project.versions.map((version) => {
                if (version.id !== input.versionId) return version;
                projectTouched = true;
                touched = true;
                return input.mutateVersion(version);
            });

            if (!projectTouched) return project;
            return {
                ...project,
                updatedAt: Date.now(),
                versions: nextVersions
            };
        });

        if (!touched) return;

        const nextEnvelope = createNextWorkspaceEnvelope(currentEnvelope, {
            tenantId: input.tenantId ?? currentEnvelope.tenantId ?? null,
            projects: updatedProjects,
            summary: input.summary,
            kind: input.kind ?? "project_update",
            actorId: input.actorId,
            actorEmail: input.actorEmail
        });
        const persistedEnvelope = persistWorkspaceEnvelopeSnapshot(transaction, docRef, nextEnvelope);
        committedEnvelope = persistedEnvelope;
    });

    if (!touched) return null;

    await recordAuditEvent({
        eventType: "workspace.version_updated",
        severity: "info",
        actorId: input.actorId ?? null,
        actorEmail: input.actorEmail ?? null,
        resourceType: "workspaceVersion",
        resourceId: `${input.userId}:${input.projectId}:${input.versionId}`,
        summary: input.summary,
        metadata: {
            projectId: input.projectId,
            versionId: input.versionId,
            kind: input.kind ?? "project_update"
        }
    });
    const savedEnvelope = committedEnvelope as WorkspaceEnvelope | null;
    if (savedEnvelope?.tenantId) {
        await syncTenantWorkspaceCount(savedEnvelope.tenantId);
    }

    return savedEnvelope;
}

export async function createWorkspaceReleaseTagByUserId(input: {
    userId: string;
    label: string;
    note?: string | null;
    actorId?: string | null;
    actorEmail?: string | null;
}) {
    const docRef = workspacesCollection().doc(input.userId);
    let nextRelease: ReleaseTag | null = null;

    await adminDb.runTransaction(async (transaction) => {
        const snap = await transaction.get(docRef);
        if (!snap.exists) return;

        const currentEnvelope = fromWorkspaceSnapshot(input.userId, snap.data() || {});
        if (!currentEnvelope.snapshots[0]) return;

        const taggedEnvelope = buildWorkspaceReleaseTag(currentEnvelope, {
            label: input.label,
            note: input.note ?? null,
            approvalStatus: "pending",
            approvalNote: null,
            approvedBy: null,
            approvedAt: null
        });
        nextRelease = taggedEnvelope.releaseTags[0] ?? null;
        persistWorkspaceEnvelopeSnapshot(transaction, docRef, taggedEnvelope);
    });

    const createdRelease = nextRelease as ReleaseTag | null;
    if (!createdRelease) return null;

    await recordAuditEvent({
        eventType: "workspace.release_tag_created",
        severity: "info",
        actorId: input.actorId ?? null,
        actorEmail: input.actorEmail ?? null,
        resourceType: "releaseTag",
        resourceId: createdRelease.id,
        summary: `Release tag ${createdRelease.label} was created for workspace ${input.userId}.`,
        metadata: {
            releaseTagId: createdRelease.id,
            releaseLabel: createdRelease.label,
            userId: input.userId,
            snapshotId: createdRelease.snapshotId,
            approvalStatus: createdRelease.approvalStatus || "pending"
        }
    });

    return createdRelease;
}

export async function updateWorkspaceReleaseApprovalByUserId(input: {
    userId: string;
    releaseTagId: string;
    decision: "approved" | "rejected";
    note?: string | null;
    actorId?: string | null;
    actorEmail?: string | null;
}) {
    const docRef = workspacesCollection().doc(input.userId);
    let updatedRelease: ReleaseTag | null = null;
    let updatedEnvelope: WorkspaceEnvelope | null = null;

    await adminDb.runTransaction(async (transaction) => {
        const snap = await transaction.get(docRef);
        if (!snap.exists) return;

        const currentEnvelope = fromWorkspaceSnapshot(input.userId, snap.data() || {});
        const currentRelease = currentEnvelope.releaseTags.find((candidate) => candidate.id === input.releaseTagId);
        if (!currentRelease) return;

        const now = Date.now();
        const nextReleaseTags = currentEnvelope.releaseTags.map((releaseTag) => {
            if (releaseTag.id !== input.releaseTagId) return releaseTag;

            const nextRelease: ReleaseTag = {
                ...releaseTag,
                approvalStatus: input.decision,
                approvalNote: input.note ?? null,
                approvedBy: input.actorEmail ?? input.actorId ?? null,
                approvedAt: now
            };
            updatedRelease = nextRelease;
            return nextRelease;
        });

        const nextEnvelope: WorkspaceEnvelope = {
            ...currentEnvelope,
            releaseTags: nextReleaseTags,
            updatedAt: now
        };
        const persistedEnvelope = persistWorkspaceEnvelopeSnapshot(transaction, docRef, nextEnvelope);
        updatedEnvelope = persistedEnvelope;
    });

    if (!updatedRelease || !updatedEnvelope) return null;
    const approvedRelease = updatedRelease as ReleaseTag;
    const envelope = updatedEnvelope as WorkspaceEnvelope;

    await recordAuditEvent({
        eventType: input.decision === "approved"
            ? "workspace.release_approved"
            : "workspace.release_rejected",
        severity: input.decision === "approved" ? "info" : "warning",
        actorId: input.actorId ?? null,
        actorEmail: input.actorEmail ?? null,
        resourceType: "releaseTag",
        resourceId: approvedRelease.id,
        summary: `Release ${approvedRelease.label} was ${input.decision} for workspace ${input.userId}.`,
        metadata: {
            userId: input.userId,
            releaseTagId: approvedRelease.id,
            decision: input.decision,
            note: input.note || "",
            approvedBy: approvedRelease.approvedBy || "",
            approvedAt: approvedRelease.approvedAt ? String(approvedRelease.approvedAt) : ""
        }
    });

    return {
        release: approvedRelease,
        envelope
    };
}

export async function rollbackWorkspaceReleaseTagByUserId(input: {
    userId: string;
    releaseTagId: string;
    actorId?: string | null;
    actorEmail?: string | null;
}): Promise<WorkspaceReleaseRollbackResult> {
    const docRef = workspacesCollection().doc(input.userId);
    let rollbackResult: WorkspaceReleaseRollbackResult = {
        ok: false,
        code: "WORKSPACE_NOT_FOUND",
        message: "Workspace not found for rollback."
    };

    await adminDb.runTransaction(async (transaction) => {
        const snap = await transaction.get(docRef);
        if (!snap.exists) {
            rollbackResult = {
                ok: false,
                code: "WORKSPACE_NOT_FOUND",
                message: "Workspace not found for rollback."
            };
            return;
        }

        const currentEnvelope = fromWorkspaceSnapshot(input.userId, snap.data() || {});
        const release = currentEnvelope.releaseTags.find((candidate) => candidate.id === input.releaseTagId);
        if (!release) {
            rollbackResult = {
                ok: false,
                code: "RELEASE_NOT_FOUND",
                message: "Release tag not found for this workspace."
            };
            return;
        }
        if (release.approvalStatus !== "approved") {
            rollbackResult = {
                ok: false,
                code: "RELEASE_NOT_APPROVED",
                message: "Release rollback requires an approved release tag."
            };
            return;
        }

        const sourceSnapshot = currentEnvelope.snapshots.find((candidate) => candidate.id === release.snapshotId);
        if (!sourceSnapshot) {
            rollbackResult = {
                ok: false,
                code: "SNAPSHOT_NOT_FOUND",
                message: "The release snapshot is no longer available in this workspace envelope."
            };
            return;
        }

        if (!Array.isArray(sourceSnapshot.projects)) {
            rollbackResult = {
                ok: false,
                code: "SNAPSHOT_PAYLOAD_UNAVAILABLE",
                message: "This release was created before snapshot payload persistence was enabled, so it cannot be restored automatically."
            };
            return;
        }

        const nextEnvelope = createNextWorkspaceEnvelope(currentEnvelope, {
            projects: sourceSnapshot.projects,
            summary: `Rolled back workspace to release ${release.label}.`,
            kind: "release",
            actorId: input.actorId,
            actorEmail: input.actorEmail
        });

        const persistedEnvelope = persistWorkspaceEnvelopeSnapshot(transaction, docRef, nextEnvelope);
        rollbackResult = {
            ok: true,
            release,
            envelope: persistedEnvelope,
            restoredRevision: persistedEnvelope.revision,
            restoredSnapshotId: persistedEnvelope.snapshots[0]?.id || "",
            projectCount: persistedEnvelope.projects.length
        };
    });

    if (!rollbackResult.ok) {
        return rollbackResult;
    }
    const successfulRollback = rollbackResult as Extract<WorkspaceReleaseRollbackResult, { ok: true }>;

    await recordAuditEvent({
        eventType: "workspace.release_rolled_back",
        severity: "warning",
        actorId: input.actorId ?? null,
        actorEmail: input.actorEmail ?? null,
        resourceType: "releaseTag",
        resourceId: successfulRollback.release.id,
        summary: `Workspace ${input.userId} was rolled back to release ${successfulRollback.release.label}.`,
        metadata: {
            userId: input.userId,
            releaseTagId: successfulRollback.release.id,
            releaseSnapshotId: successfulRollback.release.snapshotId,
            restoredRevision: String(successfulRollback.restoredRevision),
            restoredSnapshotId: successfulRollback.restoredSnapshotId,
            projectCount: String(successfulRollback.projectCount)
        }
    });

    return successfulRollback;
}

export async function listWorkspaceReleaseTags(limit = 20): Promise<WorkspaceReleaseTagSummary[]> {
    const snap = await workspacesCollection().limit(Math.max(limit, 10)).get();
    const results: WorkspaceReleaseTagSummary[] = [];

    snap.docs.forEach((doc) => {
        const envelope = fromWorkspaceSnapshot(doc.id, doc.data() || {});
        envelope.releaseTags.forEach((tag) => {
            const snapshot = envelope.snapshots.find((candidate) => candidate.id === tag.snapshotId);
            const rollbackReady = Boolean(
                snapshot
                && Array.isArray(snapshot.projects)
                && tag.approvalStatus === "approved"
            );
            const rollbackReason = !snapshot
                ? "Snapshot record is missing from the current workspace envelope."
                : !Array.isArray(snapshot.projects)
                ? "Legacy release tag without persisted snapshot payload."
                : tag.approvalStatus !== "approved"
                ? "Release tag is not approved yet."
                : null;
            results.push({
                ...tag,
                ownerUserId: envelope.ownerUserId,
                rollbackReady,
                rollbackReason,
                snapshotProjectCount: Array.isArray(snapshot?.projects) ? snapshot.projects.length : 0
            });
        });
    });

    return results
        .sort((left, right) => right.createdAt - left.createdAt)
        .slice(0, limit);
}

export async function getWorkspaceReleaseTagById(releaseId: string): Promise<WorkspaceReleaseTagDetail | null> {
    const normalizedReleaseId = releaseId.trim();
    if (!normalizedReleaseId) return null;

    const snap = await workspacesCollection().limit(80).get();
    for (const doc of snap.docs) {
        const envelope = fromWorkspaceSnapshot(doc.id, doc.data() || {});
        const release = envelope.releaseTags.find((candidate) => candidate.id === normalizedReleaseId);
        if (!release) continue;

        const snapshot = envelope.snapshots.find((candidate) => candidate.id === release.snapshotId);
        const rollbackReady = Boolean(
            snapshot
            && Array.isArray(snapshot.projects)
            && release.approvalStatus === "approved"
        );
        const snapshotProjectIds = uniqueIds(snapshot?.projectIds || []);
        const snapshotActiveVersionIds = uniqueIds(snapshot?.activeVersionIds || []);
        const currentProjectIds = uniqueIds(envelope.projects.map((project) => project.id));
        const currentActiveVersionIds = buildCurrentActiveVersionIds(envelope);
        const projectsAddedSinceRelease = diffIds(currentProjectIds, snapshotProjectIds);
        const projectsRemovedSinceRelease = diffIds(snapshotProjectIds, currentProjectIds);
        const activeVersionsAddedSinceRelease = diffIds(currentActiveVersionIds, snapshotActiveVersionIds);
        const activeVersionsRemovedSinceRelease = diffIds(snapshotActiveVersionIds, currentActiveVersionIds);

        return {
            ...release,
            ownerUserId: envelope.ownerUserId,
            rollbackReady,
            rollbackReason: !snapshot
                ? "Snapshot record is missing from the current workspace envelope."
                : !Array.isArray(snapshot.projects)
                ? "Legacy release tag without persisted snapshot payload."
                : release.approvalStatus !== "approved"
                ? "Release tag is not approved yet."
                : null,
            snapshotProjectCount: Array.isArray(snapshot?.projects) ? snapshot.projects.length : 0,
            latestWorkspaceRevision: envelope.revision,
            snapshotSummary: snapshot?.summary || null,
            snapshotActiveVersionCount: snapshot?.activeVersionIds.length || 0,
            projectIds: snapshotProjectIds,
            activeVersionIds: snapshotActiveVersionIds,
            rollbackImpact: {
                sameAsCurrent:
                    projectsAddedSinceRelease.length === 0 &&
                    projectsRemovedSinceRelease.length === 0 &&
                    activeVersionsAddedSinceRelease.length === 0 &&
                    activeVersionsRemovedSinceRelease.length === 0,
                currentProjectCount: currentProjectIds.length,
                currentActiveVersionCount: currentActiveVersionIds.length,
                projectsAddedSinceRelease,
                projectsRemovedSinceRelease,
                activeVersionsAddedSinceRelease,
                activeVersionsRemovedSinceRelease
            }
        };
    }

    return null;
}

export async function listWorkspaceEnvelopeSummaries(limit = 20) {
    const snap = await workspacesCollection().limit(Math.max(limit, 10)).get();
    return snap.docs
        .map((doc) => fromWorkspaceSnapshot(doc.id, doc.data() || {}))
        .map((envelope) => ({
            ownerUserId: envelope.ownerUserId,
            tenantId: envelope.tenantId ?? null,
            revision: envelope.revision,
            projectCount: envelope.projects.length,
            updatedAt: envelope.updatedAt,
            latestSnapshotSummary: envelope.snapshots[0]?.summary || "No snapshots yet"
        }))
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .slice(0, limit);
}
