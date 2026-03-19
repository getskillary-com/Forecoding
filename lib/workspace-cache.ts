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

const CACHE_KEY = "__fc_workspace_cache";
const PERSISTED_LOCAL_KEY = "__fc_workspace_envelope_v1";
const LEGACY_PROJECTS_KEY = "__fc_workspace_projects_v1";
const LEGACY_FOUNDERS_KEY = "fl_projects_v2";
const REMOTE_FETCH_TTL_MS = 30_000;
const LOCAL_OWNER_USER_ID = "__local__";

let remoteFetchPromise: Promise<Project[] | null> | null = null;
let lastRemoteFetchAt = 0;

type WorkspaceWindow = Window & {
    [CACHE_KEY]?: WorkspaceCache;
};

function getWorkspaceWindow(): WorkspaceWindow | null {
    if (typeof window === "undefined") return null;
    return window as WorkspaceWindow;
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

export async function prefetchWorkspaceRemote(): Promise<Project[] | null> {
    if (typeof window === "undefined") return null;

    const now = Date.now();
    if (remoteFetchPromise) return remoteFetchPromise;
    if (now - lastRemoteFetchAt < REMOTE_FETCH_TTL_MS) return null;

    remoteFetchPromise = (async () => {
        try {
            const res = await fetch("/api/workspace", { cache: "no-store" });
            if (!res.ok) return null;
            const data = (await res.json()) as {
                projects?: Project[];
                workspace?: WorkspaceEnvelope | null;
            };
            if (data.workspace) {
                writeWorkspaceEnvelopeToLocalStorage(data.workspace);
                lastRemoteFetchAt = Date.now();
                return data.workspace.projects;
            }
            if (!Array.isArray(data.projects)) return null;
            writeProjectsToLocalStorage(data.projects);
            lastRemoteFetchAt = Date.now();
            return data.projects;
        } catch {
            return null;
        } finally {
            remoteFetchPromise = null;
        }
    })();

    return remoteFetchPromise;
}

export async function syncWorkspaceProjectsRemote(
    projects: Project[],
    input?: { changeSummary?: string }
): Promise<WorkspaceSyncResult> {
    const current = readWorkspaceEnvelopeFromLocalStorage();

    try {
        const res = await fetch("/api/workspace", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                projects,
                expectedRevision: current.revision,
                changeSummary: input?.changeSummary || "Workspace update"
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
            return {
                ok: false,
                conflict: true,
                message: "Workspace save blocked by a newer revision. Refresh and reconcile before retrying.",
                revision: typeof payload.revision === "number" ? payload.revision : current.revision,
                workspace: payload.workspace as WorkspaceEnvelope
            };
        }

        return {
            ok: false,
            conflict: false,
            message: typeof payload?.error === "string" ? payload.error : "Failed to sync workspace."
        };
    } catch (error) {
        return {
            ok: false,
            conflict: false,
            message: error instanceof Error ? error.message : "Failed to sync workspace."
        };
    }
}
