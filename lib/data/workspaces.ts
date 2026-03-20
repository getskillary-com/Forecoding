import { adminDb } from "@/lib/firebase-admin";
import { toDateOrNull } from "./firestore-utils";
import { recordAuditEvent } from "./audit-events";
import { syncTenantWorkspaceCount } from "./tenants";
import {
    buildWorkspaceReleaseTag,
    createEmptyWorkspaceEnvelope,
    createNextWorkspaceEnvelope,
    normalizeWorkspaceEnvelope
} from "@/lib/workspace-envelope";
import type { Project, ProjectVersion, ReleaseTag, WorkspaceChangeKind, WorkspaceEnvelope } from "@/types";

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

class WorkspaceRevisionConflictError extends Error {
    currentEnvelope: WorkspaceEnvelope;

    constructor(currentEnvelope: WorkspaceEnvelope) {
        super("Workspace revision conflict.");
        this.currentEnvelope = currentEnvelope;
    }
}

function workspacesCollection() {
    return adminDb.collection("workspaces");
}

function uniqueIds(values: string[]) {
    return Array.from(new Set(values.filter(Boolean)));
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

function toWorkspaceDocument(envelope: WorkspaceEnvelope) {
    return {
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
    };
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

    try {
        await adminDb.runTransaction(async (transaction) => {
            const snap = await transaction.get(docRef);
            const currentEnvelope = snap.exists
                ? fromWorkspaceSnapshot(input.userId, snap.data() || {})
                : createEmptyWorkspaceEnvelope(input.userId, input.tenantId ?? null);

            if (currentEnvelope.revision !== input.expectedRevision) {
                throw new WorkspaceRevisionConflictError(currentEnvelope);
            }

            const nextEnvelope = createNextWorkspaceEnvelope(currentEnvelope, {
                tenantId: input.tenantId ?? currentEnvelope.tenantId ?? null,
                projects: input.projects,
                summary: input.changeSummary,
                actorId: input.actorId,
                actorEmail: input.actorEmail
            });

            transaction.set(docRef, toWorkspaceDocument(nextEnvelope), { merge: false });
            committedEnvelope = nextEnvelope;
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
            summary: "Workspace synchronized from a trusted server mutation."
        });
        transaction.set(docRef, toWorkspaceDocument(nextEnvelope), { merge: false });
        committedEnvelope = nextEnvelope;
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
        transaction.set(docRef, toWorkspaceDocument(nextEnvelope), { merge: false });
        committedEnvelope = nextEnvelope;
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
        transaction.set(docRef, toWorkspaceDocument(nextEnvelope), { merge: false });
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
        transaction.set(docRef, toWorkspaceDocument(nextEnvelope), { merge: false });
        committedEnvelope = nextEnvelope;
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
        transaction.set(docRef, toWorkspaceDocument(taggedEnvelope), { merge: false });
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
        transaction.set(docRef, toWorkspaceDocument(nextEnvelope), { merge: false });
        updatedEnvelope = nextEnvelope;
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

        transaction.set(docRef, toWorkspaceDocument(nextEnvelope), { merge: false });
        rollbackResult = {
            ok: true,
            release,
            envelope: nextEnvelope,
            restoredRevision: nextEnvelope.revision,
            restoredSnapshotId: nextEnvelope.snapshots[0]?.id || "",
            projectCount: nextEnvelope.projects.length
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
