import type { Project, ProjectVersion, ProjectVersionData, WorkspaceEnvelope } from "@/types";
import { normalizeProjects } from "@/lib/project-language";
import { createEmptyWorkspaceEnvelope, normalizeWorkspaceEnvelope } from "@/lib/workspace-envelope";

type WorkspaceCache = {
    envelope: WorkspaceEnvelope;
    byId: Map<string, Project>;
    updatedAt: number;
};

type ProjectSnapshot = {
    project: Project;
    version: ProjectVersion;
    data: ProjectVersionData;
};

export type WorkspaceSyncResult =
    | {
        ok: true;
        revision: number;
        workspace: WorkspaceEnvelope;
    }
    | {
        ok: false;
        conflict: true;
        message: string;
        revision: number;
        workspace: WorkspaceEnvelope;
    }
    | {
        ok: false;
        conflict: false;
        message: string;
    };

export type PrefetchWorkspaceRemoteOptions = {
    projectId?: string | null;
    includeWorkspace?: boolean;
    includeSnapshotProjects?: boolean;
    mergeProjectScopedResult?: boolean;
};

type NormalizedPrefetchWorkspaceRemoteOptions = {
    projectId: string | null;
    includeWorkspace: boolean;
    includeSnapshotProjects: boolean;
    mergeProjectScopedResult: boolean;
};

type RemoteWorkspacePayload = {
    projects?: Project[];
    workspace?: WorkspaceEnvelope | null;
    revision?: number;
    updatedAt?: string | null;
};

const CACHE_KEY = "__fc_workspace_cache";
const PERSISTED_LOCAL_KEY = "__fc_workspace_envelope_v1";
const LEGACY_PROJECTS_KEY = "__fc_workspace_projects_v1";
const LEGACY_FOUNDERS_KEY = "fl_projects_v2";
const REMOTE_FETCH_TTL_MS = 30_000;
const LOCAL_OWNER_USER_ID = "__local__";

const remoteFetchPromises = new Map<string, Promise<Project[] | null>>();
const lastRemoteFetchAtByKey = new Map<string, number>();

type WorkspaceWindow = Window & {
    [CACHE_KEY]?: WorkspaceCache;
};

function getWorkspaceWindow(): WorkspaceWindow | null {
    if (typeof window === "undefined") return null;
    return window as WorkspaceWindow;
}

function normalizePrefetchWorkspaceOptions(
    input?: PrefetchWorkspaceRemoteOptions
): NormalizedPrefetchWorkspaceRemoteOptions {
    const projectId = typeof input?.projectId === "string" && input.projectId.trim()
        ? input.projectId.trim()
        : null;
    return {
        projectId,
        includeWorkspace: input?.includeWorkspace !== false,
        includeSnapshotProjects: input?.includeSnapshotProjects !== false,
        mergeProjectScopedResult: input?.mergeProjectScopedResult !== false
    };
}

function buildRemoteFetchKey(options: NormalizedPrefetchWorkspaceRemoteOptions) {
    return [
        options.projectId || "*",
        options.includeWorkspace ? "workspace:1" : "workspace:0",
        options.includeSnapshotProjects ? "snapshot:1" : "snapshot:0",
        options.mergeProjectScopedResult ? "merge:1" : "merge:0"
    ].join("|");
}

function buildRemoteFetchUrl(options: NormalizedPrefetchWorkspaceRemoteOptions) {
    const searchParams = new URLSearchParams();
    if (options.projectId) {
        searchParams.set("projectId", options.projectId);
    }
    if (!options.includeWorkspace) {
        searchParams.set("includeWorkspace", "0");
    }
    if (!options.includeSnapshotProjects) {
        searchParams.set("includeSnapshotProjects", "0");
    }
    const query = searchParams.toString();
    return query ? `/api/workspace?${query}` : "/api/workspace";
}

function mergeProjectScopedProjects(currentProjects: Project[], remoteProjects: Project[], projectId: string): Project[] {
    const remoteProject = remoteProjects.find((project) => project.id === projectId);
    const merged: Project[] = [];
    let replaced = false;

    for (const project of currentProjects) {
        if (project.id === projectId) {
            replaced = true;
            if (remoteProject) {
                merged.push(remoteProject);
            }
            continue;
        }
        merged.push(project);
    }

    if (!replaced && remoteProject) {
        merged.unshift(remoteProject);
    }

    return merged;
}

function normalizeRevision(value: unknown): number | null {
    if (typeof value !== "number") return null;
    if (!Number.isInteger(value)) return null;
    if (value < 0) return null;
    return value;
}

function normalizeUpdatedAt(value: unknown, fallback: number): number {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        return Math.round(value);
    }
    if (typeof value === "string") {
        const parsed = Date.parse(value);
        if (Number.isFinite(parsed) && parsed > 0) {
            return Math.round(parsed);
        }
    }
    return fallback;
}

function mergeProjectsPreservingLocalProgress(remoteProjects: Project[], localProjects: Project[]): Project[] {
    return mergeProjectsForConflictRetry(remoteProjects, localProjects);
}

function writeProjectsEnvelopeFromRemote(
    projects: Project[],
    metadata?: { revision?: unknown; updatedAt?: unknown }
): WorkspaceEnvelope {
    const current = readWorkspaceEnvelopeFromLocalStorage();
    const remoteRevision = normalizeRevision(metadata?.revision);
    const remoteUpdatedAt = normalizeUpdatedAt(metadata?.updatedAt, current.updatedAt);
    const nextRevision = remoteRevision !== null ? Math.max(current.revision, remoteRevision) : current.revision;
    const mergedProjects = mergeProjectsPreservingLocalProgress(normalizeProjects(projects), current.projects);
    const nextEnvelope: WorkspaceEnvelope = {
        ...current,
        projects: mergedProjects,
        revision: nextRevision,
        updatedAt: Math.max(current.updatedAt, remoteUpdatedAt)
    };
    writeWorkspaceEnvelopeToLocalStorage(nextEnvelope);
    return nextEnvelope;
}

function mergeProjectsForConflictRetry(serverProjects: Project[], intendedProjects: Project[]): Project[] {
    const mergedById = new Map<string, Project>();
    const remoteOnlyOrder: Project[] = [];
    const result: Project[] = [];
    const consumedServerIds = new Set<string>();

    for (const project of serverProjects) {
        mergedById.set(project.id, project);
        remoteOnlyOrder.push(project);
    }

    for (const project of intendedProjects) {
        if (!project?.id) continue;
        const serverProject = mergedById.get(project.id);
        const winner = !serverProject
            ? project
            : (project.updatedAt || 0) >= (serverProject.updatedAt || 0)
                ? project
                : serverProject;
        mergedById.set(project.id, winner);
        consumedServerIds.add(project.id);
        result.push(winner);
    }

    for (const project of remoteOnlyOrder) {
        if (!project?.id || consumedServerIds.has(project.id)) continue;
        const mergedProject = mergedById.get(project.id);
        if (mergedProject) {
            result.push(mergedProject);
        }
    }

    return result;
}

function getCache(): WorkspaceCache | null {
    const workspaceWindow = getWorkspaceWindow();
    if (!workspaceWindow) return null;
    return workspaceWindow[CACHE_KEY] ?? null;
}

function setCache(envelope: WorkspaceEnvelope): void {
    const workspaceWindow = getWorkspaceWindow();
    if (!workspaceWindow) return;
    const byId = new Map<string, Project>();
    envelope.projects.forEach((project) => byId.set(project.id, project));
    workspaceWindow[CACHE_KEY] = {
        envelope,
        byId,
        updatedAt: Date.now()
    } satisfies WorkspaceCache;
}

function persistWorkspaceEnvelope(envelope: WorkspaceEnvelope) {
    if (typeof window === "undefined") return;
    try {
        localStorage.setItem(PERSISTED_LOCAL_KEY, JSON.stringify(envelope));
    } catch {
        // Keep the in-memory cache usable even if persistent storage is unavailable.
    }
}

function migrateLegacyProjects(raw: string | null): WorkspaceEnvelope | null {
    if (!raw) return null;
    try {
        const parsed = normalizeProjects(JSON.parse(raw));
        const envelope = normalizeWorkspaceEnvelope(
            {
                version: "workspace_envelope_v1",
                ownerUserId: LOCAL_OWNER_USER_ID,
                projects: parsed,
                revision: 0,
                revisionHistory: [],
                snapshots: [],
                releaseTags: [],
                createdAt: Date.now(),
                updatedAt: Date.now()
            },
            LOCAL_OWNER_USER_ID
        );
        persistWorkspaceEnvelope(envelope);
        return envelope;
    } catch {
        return null;
    }
}

export function readWorkspaceEnvelopeFromLocalStorage(): WorkspaceEnvelope {
    if (typeof window === "undefined") {
        return createEmptyWorkspaceEnvelope(LOCAL_OWNER_USER_ID);
    }

    const cache = getCache();
    if (cache) return cache.envelope;

    const persistedRaw = localStorage.getItem(PERSISTED_LOCAL_KEY);
    if (persistedRaw) {
        try {
            const parsed = normalizeWorkspaceEnvelope(JSON.parse(persistedRaw), LOCAL_OWNER_USER_ID);
            setCache(parsed);
            return parsed;
        } catch {
            localStorage.removeItem(PERSISTED_LOCAL_KEY);
        }
    }

    const migrated =
        migrateLegacyProjects(localStorage.getItem(LEGACY_PROJECTS_KEY)) ||
        migrateLegacyProjects(localStorage.getItem(LEGACY_FOUNDERS_KEY));
    if (migrated) {
        localStorage.removeItem(LEGACY_PROJECTS_KEY);
        localStorage.removeItem(LEGACY_FOUNDERS_KEY);
        setCache(migrated);
        return migrated;
    }

    const empty = createEmptyWorkspaceEnvelope(LOCAL_OWNER_USER_ID);
    setCache(empty);
    return empty;
}

export function writeWorkspaceEnvelopeToLocalStorage(envelope: WorkspaceEnvelope): void {
    if (typeof window === "undefined") return;
    const normalized = normalizeWorkspaceEnvelope(envelope, envelope.ownerUserId || LOCAL_OWNER_USER_ID);
    setCache(normalized);
    persistWorkspaceEnvelope(normalized);
}

export function getWorkspaceLocalRevision() {
    return readWorkspaceEnvelopeFromLocalStorage().revision;
}

export function readProjectsFromLocalStorage(): Project[] {
    return readWorkspaceEnvelopeFromLocalStorage().projects;
}

export function writeProjectsToLocalStorage(projects: Project[]): void {
    const current = readWorkspaceEnvelopeFromLocalStorage();
    writeWorkspaceEnvelopeToLocalStorage({
        ...current,
        projects: normalizeProjects(projects),
        updatedAt: Date.now()
    });
}

export function getCachedProject(projectId?: string | null): Project | null {
    if (!projectId) return null;
    const cache = getCache();
    if (cache?.byId?.has(projectId)) {
        return cache.byId.get(projectId) || null;
    }
    const projects = readProjectsFromLocalStorage();
    return projects.find((project) => project.id === projectId) || null;
}

export function getCachedProjectSnapshot(projectId?: string | null, versionId?: string | null): ProjectSnapshot | null {
    const project = getCachedProject(projectId);
    if (!project) return null;
    const version = versionId
        ? project.versions.find((candidate) => candidate.id === versionId) ?? project.versions[project.versions.length - 1]
        : project.versions[project.versions.length - 1];
    if (!version) return null;
    return { project, version, data: version.data };
}

export function primeWorkspaceCache(projectId?: string | null): Project | null {
    return getCachedProject(projectId);
}

export async function prefetchWorkspaceRemote(input?: PrefetchWorkspaceRemoteOptions): Promise<Project[] | null> {
    if (typeof window === "undefined") return null;
    const options = normalizePrefetchWorkspaceOptions(input);
    const fetchKey = buildRemoteFetchKey(options);

    const now = Date.now();
    const existingPromise = remoteFetchPromises.get(fetchKey);
    if (existingPromise) return existingPromise;
    const lastRemoteFetchAt = lastRemoteFetchAtByKey.get(fetchKey) ?? 0;
    if (now - lastRemoteFetchAt < REMOTE_FETCH_TTL_MS) return null;

    const remoteFetchPromise = (async () => {
        try {
            const res = await fetch(buildRemoteFetchUrl(options), { cache: "no-store" });
            if (!res.ok) return null;
            const data = (await res.json()) as RemoteWorkspacePayload;
            if (data.workspace) {
                const current = readWorkspaceEnvelopeFromLocalStorage();
                const mergedProjects = mergeProjectsPreservingLocalProgress(data.workspace.projects, current.projects);
                writeWorkspaceEnvelopeToLocalStorage({
                    ...data.workspace,
                    projects: mergedProjects,
                    revision: Math.max(current.revision, data.workspace.revision),
                    updatedAt: Math.max(current.updatedAt, data.workspace.updatedAt)
                });
                lastRemoteFetchAtByKey.set(fetchKey, Date.now());
                return mergedProjects;
            }
            if (!Array.isArray(data.projects)) return null;
            if (options.projectId && options.mergeProjectScopedResult) {
                const mergedProjects = mergeProjectScopedProjects(
                    readProjectsFromLocalStorage(),
                    data.projects,
                    options.projectId
                );
                writeProjectsEnvelopeFromRemote(mergedProjects, {
                    revision: data.revision,
                    updatedAt: data.updatedAt
                });
                lastRemoteFetchAtByKey.set(fetchKey, Date.now());
                return mergedProjects;
            }
            const nextEnvelope = writeProjectsEnvelopeFromRemote(data.projects, {
                revision: data.revision,
                updatedAt: data.updatedAt
            });
            lastRemoteFetchAtByKey.set(fetchKey, Date.now());
            return nextEnvelope.projects;
        } catch {
            return null;
        } finally {
            remoteFetchPromises.delete(fetchKey);
        }
    })();

    remoteFetchPromises.set(fetchKey, remoteFetchPromise);
    return remoteFetchPromise;
}

export async function syncWorkspaceProjectsRemote(
    projects: Project[],
    input?: { changeSummary?: string }
): Promise<WorkspaceSyncResult> {
    const current = readWorkspaceEnvelopeFromLocalStorage();
    const changeSummary = input?.changeSummary || "Workspace update";

    try {
        const res = await fetch("/api/workspace", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                projects,
                expectedRevision: current.revision,
                changeSummary
            })
        });

        const payload = await res.json().catch(() => null);
        if (res.ok && payload?.workspace) {
            writeWorkspaceEnvelopeToLocalStorage(payload.workspace as WorkspaceEnvelope);
            return {
                ok: true,
                revision: typeof payload.revision === "number" ? payload.revision : current.revision,
                workspace: payload.workspace as WorkspaceEnvelope
            };
        }

        if (res.status === 409 && payload?.workspace) {
            const serverWorkspace = payload.workspace as WorkspaceEnvelope;
            const rebasedProjects = mergeProjectsForConflictRetry(serverWorkspace.projects, projects);
            const retryRes = await fetch("/api/workspace", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    projects: rebasedProjects,
                    expectedRevision: serverWorkspace.revision,
                    changeSummary
                })
            });
            const retryPayload = await retryRes.json().catch(() => null);
            if (retryRes.ok && retryPayload?.workspace) {
                writeWorkspaceEnvelopeToLocalStorage(retryPayload.workspace as WorkspaceEnvelope);
                return {
                    ok: true,
                    revision: typeof retryPayload.revision === "number" ? retryPayload.revision : serverWorkspace.revision,
                    workspace: retryPayload.workspace as WorkspaceEnvelope
                };
            }
            if (retryRes.status === 409 && retryPayload?.workspace) {
                return {
                    ok: false,
                    conflict: true,
                    message: "Workspace save blocked by a newer revision. Refresh and reconcile before retrying.",
                    revision: typeof retryPayload.revision === "number" ? retryPayload.revision : serverWorkspace.revision,
                    workspace: retryPayload.workspace as WorkspaceEnvelope
                };
            }
            return {
                ok: false,
                conflict: true,
                message: "Workspace save blocked by a newer revision. Refresh and reconcile before retrying.",
                revision: typeof payload.revision === "number" ? payload.revision : current.revision,
                workspace: serverWorkspace
            };
        }

        const payloadError = typeof payload?.error === "string" ? payload.error : null;
        const payloadDetails = typeof payload?.details === "string" ? payload.details : null;
        if (res.status === 413 && payload?.code === "WORKSPACE_PAYLOAD_TOO_LARGE") {
            return {
                ok: false,
                conflict: false,
                message: payloadDetails
                    ? `${payloadError || "Workspace payload too large."} ${payloadDetails}`
                    : payloadError || "Workspace payload too large."
            };
        }

        return {
            ok: false,
            conflict: false,
            message: payloadDetails
                ? `${payloadError || "Failed to sync workspace."} ${payloadDetails}`
                : payloadError || "Failed to sync workspace."
        };
    } catch (error) {
        return {
            ok: false,
            conflict: false,
            message: error instanceof Error ? error.message : "Failed to sync workspace."
        };
    }
}
