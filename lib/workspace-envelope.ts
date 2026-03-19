import type {
    Project,
    ReleaseTag,
    WorkspaceChangeKind,
    WorkspaceChangeSet,
    WorkspaceEnvelope,
    WorkspaceRevision,
    WorkspaceSnapshot
} from "@/types";
import { normalizeProjects } from "@/lib/project-language";

const WORKSPACE_ENVELOPE_VERSION = "workspace_envelope_v1" as const;
const MAX_REVISION_HISTORY = 50;
const MAX_SNAPSHOTS = 20;
const MAX_RELEASE_TAGS = 20;

function randomId(prefix: string) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeTimestamp(value: unknown, fallback: number) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        return Math.round(value);
    }

    if (value instanceof Date) {
        const parsed = value.getTime();
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    if (typeof value === "string") {
        const parsed = Date.parse(value);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }

    return fallback;
}

function cloneProjects(projects: Project[]) {
    return JSON.parse(JSON.stringify(projects)) as Project[];
}

function normalizeReleaseTags(value: unknown): ReleaseTag[] {
    if (!Array.isArray(value)) return [];
    return value
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
        .map((item) => ({
            id: typeof item.id === "string" && item.id.trim() ? item.id : randomId("release"),
            label: typeof item.label === "string" && item.label.trim() ? item.label.trim() : "Release",
            snapshotId: typeof item.snapshotId === "string" ? item.snapshotId : "",
            note: typeof item.note === "string" ? item.note : null,
            createdAt: normalizeTimestamp(item.createdAt, Date.now())
        }))
        .filter((item) => item.snapshotId)
        .slice(0, MAX_RELEASE_TAGS);
}

function normalizeChangeSet(value: unknown): WorkspaceChangeSet | null {
    if (!value || typeof value !== "object") return null;
    const item = value as Record<string, unknown>;
    const projectIds = Array.isArray(item.projectIds)
        ? item.projectIds.filter((candidate): candidate is string => typeof candidate === "string" && candidate.trim().length > 0)
        : [];
    const activeVersionIds = Array.isArray(item.activeVersionIds)
        ? item.activeVersionIds.filter((candidate): candidate is string => typeof candidate === "string" && candidate.trim().length > 0)
        : [];

    return {
        id: typeof item.id === "string" && item.id.trim() ? item.id : randomId("change"),
        kind: (typeof item.kind === "string" ? item.kind : "workspace_sync") as WorkspaceChangeKind,
        summary: typeof item.summary === "string" && item.summary.trim() ? item.summary.trim() : "Workspace update",
        projectIds,
        activeVersionIds,
        actorId: typeof item.actorId === "string" ? item.actorId : null,
        actorEmail: typeof item.actorEmail === "string" ? item.actorEmail : null,
        createdAt: normalizeTimestamp(item.createdAt, Date.now())
    };
}

function normalizeRevisionHistory(value: unknown): WorkspaceRevision[] {
    if (!Array.isArray(value)) return [];
    return value
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
        .map((item) => {
            const changeSet = normalizeChangeSet(item.changeSet);
            if (!changeSet) return null;

            return {
                id: typeof item.id === "string" && item.id.trim() ? item.id : randomId("rev"),
                number: typeof item.number === "number" && Number.isFinite(item.number) ? Math.max(0, Math.round(item.number)) : 0,
                snapshotId: typeof item.snapshotId === "string" ? item.snapshotId : "",
                createdAt: normalizeTimestamp(item.createdAt, changeSet.createdAt),
                changeSet
            } satisfies WorkspaceRevision;
        })
        .filter((item): item is WorkspaceRevision => Boolean(item && item.snapshotId))
        .slice(0, MAX_REVISION_HISTORY);
}

function normalizeSnapshots(value: unknown): WorkspaceSnapshot[] {
    if (!Array.isArray(value)) return [];
    return value
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
        .map((item) => ({
            id: typeof item.id === "string" && item.id.trim() ? item.id : randomId("snapshot"),
            revisionId: typeof item.revisionId === "string" ? item.revisionId : "",
            createdAt: normalizeTimestamp(item.createdAt, Date.now()),
            summary: typeof item.summary === "string" && item.summary.trim() ? item.summary.trim() : "Workspace snapshot",
            projectIds: Array.isArray(item.projectIds)
                ? item.projectIds.filter((candidate): candidate is string => typeof candidate === "string" && candidate.trim().length > 0)
                : [],
            activeVersionIds: Array.isArray(item.activeVersionIds)
                ? item.activeVersionIds.filter((candidate): candidate is string => typeof candidate === "string" && candidate.trim().length > 0)
                : [],
            projects: Array.isArray(item.projects)
                ? cloneProjects(normalizeProjects(item.projects))
                : undefined
        }))
        .filter((item) => item.revisionId)
        .slice(0, MAX_SNAPSHOTS);
}

function buildProjectIds(projects: Project[]) {
    return projects.map((project) => project.id).filter(Boolean);
}

function buildActiveVersionIds(projects: Project[]) {
    return projects
        .map((project) => project.versions[project.versions.length - 1]?.id || "")
        .filter(Boolean);
}

function buildSnapshotSummary(projects: Project[]) {
    if (projects.length === 0) {
        return "Initialized empty workspace";
    }

    if (projects.length === 1) {
        return `Updated workspace project: ${projects[0].name}`;
    }

    return `Updated ${projects.length} workspace projects`;
}

export function createEmptyWorkspaceEnvelope(ownerUserId: string): WorkspaceEnvelope {
    const now = Date.now();
    return {
        version: WORKSPACE_ENVELOPE_VERSION,
        ownerUserId,
        projects: [],
        revision: 0,
        revisionHistory: [],
        snapshots: [],
        releaseTags: [],
        createdAt: now,
        updatedAt: now
    };
}

export function normalizeWorkspaceEnvelope(raw: unknown, ownerUserId: string): WorkspaceEnvelope {
    const fallback = createEmptyWorkspaceEnvelope(ownerUserId);
    if (!raw || typeof raw !== "object") {
        return fallback;
    }

    const source = raw as Record<string, unknown>;
    const projects = normalizeProjects(source.projects);
    const createdAt = normalizeTimestamp(source.createdAt, fallback.createdAt);
    const updatedAt = normalizeTimestamp(source.updatedAt, createdAt);
    const revision = typeof source.revision === "number" && Number.isFinite(source.revision)
        ? Math.max(0, Math.round(source.revision))
        : 0;

    return {
        version: WORKSPACE_ENVELOPE_VERSION,
        ownerUserId:
            (typeof source.ownerUserId === "string" && source.ownerUserId.trim()) ||
            (typeof source.userId === "string" && source.userId.trim()) ||
            ownerUserId,
        projects,
        revision,
        revisionHistory: normalizeRevisionHistory(source.revisionHistory),
        snapshots: normalizeSnapshots(source.snapshots),
        releaseTags: normalizeReleaseTags(source.releaseTags),
        createdAt,
        updatedAt
    };
}

export function createNextWorkspaceEnvelope(
    currentEnvelope: WorkspaceEnvelope,
    input: {
        projects: Project[];
        summary?: string;
        actorId?: string | null;
        actorEmail?: string | null;
        kind?: WorkspaceChangeKind;
    }
) {
    const now = Date.now();
    const projects = cloneProjects(normalizeProjects(input.projects));
    const snapshotId = randomId("snapshot");
    const revisionId = randomId("rev");
    const changeSet: WorkspaceChangeSet = {
        id: randomId("change"),
        kind: input.kind || "workspace_sync",
        summary: (input.summary || "").trim() || buildSnapshotSummary(projects),
        projectIds: buildProjectIds(projects),
        activeVersionIds: buildActiveVersionIds(projects),
        actorId: input.actorId ?? null,
        actorEmail: input.actorEmail ?? null,
        createdAt: now
    };
    const revision: WorkspaceRevision = {
        id: revisionId,
        number: currentEnvelope.revision + 1,
        snapshotId,
        createdAt: now,
        changeSet
    };
    const snapshot: WorkspaceSnapshot = {
        id: snapshotId,
        revisionId,
        createdAt: now,
        summary: changeSet.summary,
        projectIds: changeSet.projectIds,
        activeVersionIds: changeSet.activeVersionIds,
        projects: cloneProjects(projects)
    };

    return {
        ...currentEnvelope,
        version: WORKSPACE_ENVELOPE_VERSION,
        projects,
        revision: revision.number,
        revisionHistory: [revision, ...currentEnvelope.revisionHistory].slice(0, MAX_REVISION_HISTORY),
        snapshots: [snapshot, ...currentEnvelope.snapshots].slice(0, MAX_SNAPSHOTS),
        releaseTags: currentEnvelope.releaseTags.slice(0, MAX_RELEASE_TAGS),
        updatedAt: now
    } satisfies WorkspaceEnvelope;
}

export function buildWorkspaceReleaseTag(
    envelope: WorkspaceEnvelope,
    input: { label: string; note?: string | null }
) {
    const latestSnapshot = envelope.snapshots[0];
    if (!latestSnapshot) return envelope;

    const nextTag: ReleaseTag = {
        id: randomId("release"),
        label: input.label.trim() || `r${envelope.revision}`,
        snapshotId: latestSnapshot.id,
        note: input.note ?? null,
        createdAt: Date.now()
    };

    return {
        ...envelope,
        releaseTags: [nextTag, ...envelope.releaseTags].slice(0, MAX_RELEASE_TAGS),
        updatedAt: Date.now()
    };
}
