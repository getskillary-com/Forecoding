import type { Project, ProjectVersion, ProjectVersionData } from "@/types";
import { normalizeProjects } from "@/lib/project-language";

type WorkspaceCache = {
    parsed: Project[];
    byId: Map<string, Project>;
    updatedAt: number;
};

type ProjectSnapshot = {
    project: Project;
    version: ProjectVersion;
    data: ProjectVersionData;
};

const CACHE_KEY = "__fc_workspace_cache";
const LEGACY_LOCAL_KEY = "fl_projects_v2";
const REMOTE_FETCH_TTL_MS = 30_000;

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

function setCache(projects: Project[]): void {
    const workspaceWindow = getWorkspaceWindow();
    if (!workspaceWindow) return;
    const byId = new Map<string, Project>();
    projects.forEach((project) => byId.set(project.id, project));
    workspaceWindow[CACHE_KEY] = {
        parsed: projects,
        byId,
        updatedAt: Date.now()
    } satisfies WorkspaceCache;
}

export function readProjectsFromLocalStorage(): Project[] {
    if (typeof window === "undefined") return [];
    const cache = getCache();
    if (cache) return cache.parsed;

    // One-time migration: read old local persisted projects and then remove them.
    const legacyRaw = localStorage.getItem(LEGACY_LOCAL_KEY);
    if (!legacyRaw) return [];

    try {
        const parsed = normalizeProjects(JSON.parse(legacyRaw));
        if (!Array.isArray(parsed)) {
            localStorage.removeItem(LEGACY_LOCAL_KEY);
            return [];
        }
        setCache(parsed);
        localStorage.removeItem(LEGACY_LOCAL_KEY);
        return parsed;
    } catch {
        localStorage.removeItem(LEGACY_LOCAL_KEY);
        return [];
    }
}

export function writeProjectsToLocalStorage(projects: Project[]): void {
    if (typeof window === "undefined") return;
    setCache(normalizeProjects(projects));
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

export function getCachedProjectSnapshot(projectId?: string | null): ProjectSnapshot | null {
    const project = getCachedProject(projectId);
    if (!project) return null;
    const version = project.versions[project.versions.length - 1];
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
            const data = (await res.json()) as { projects?: Project[] };
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
