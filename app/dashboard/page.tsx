"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Plus, Folder, Clock, Trash2, Edit2, X, Copy, Check } from "lucide-react";
import { DiagramGovernance, Project, ProjectVersion } from "@/types";
import { useRouter } from "next/navigation";
import { UserCenter } from "@/components/UserCenter";
import { BrandLogo } from "@/components/BrandLogo";
import {
    prefetchWorkspaceRemote,
    primeWorkspaceCache,
    readProjectsFromLocalStorage,
    writeProjectsToLocalStorage
} from "@/lib/workspace-cache";

function yieldToBrowser(): Promise<void> {
    return new Promise((resolve) => {
        if (typeof window === "undefined") {
            resolve();
            return;
        }
        requestAnimationFrame(() => resolve());
    });
}

function buildDefaultDiagramGovernance(): DiagramGovernance {
    return {
        pendingDiagram: null,
        pendingSourceRequestId: null,
        pendingUpdatedAt: null,
        lastDecision: "none",
        lastDecisionNote: null,
        lastDecisionAt: null
    };
}

export default function DashboardPage() {
    const router = useRouter();
    const [projects, setProjects] = useState<Project[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    // Modal State
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
    const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
    const [formData, setFormData] = useState({ name: "", description: "" });
    const [copiedProjectId, setCopiedProjectId] = useState<string | null>(null);

    const syncWorkspaceRemote = async (nextProjects: Project[]) => {
        try {
            await fetch("/api/workspace", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ projects: nextProjects })
            });
        } catch (error) {
            console.error("Failed to sync workspace", error);
        }
    };

    // Load Projects
    useEffect(() => {
        if (typeof window === 'undefined') return;
        let cancelled = false;

        const loadRemoteWorkspace = async (localProjects: Project[]) => {
            try {
                const res = await fetch("/api/workspace", { cache: "no-store" });
                if (!res.ok) return;

                const data = (await res.json()) as { projects?: Project[] };
                if (!Array.isArray(data.projects)) return;

                if (data.projects.length > 0 || localProjects.length === 0) {
                    if (cancelled) return;
                    setProjects(data.projects);
                    writeProjectsToLocalStorage(data.projects);
                } else {
                    void syncWorkspaceRemote(localProjects);
                }
            } catch (error) {
                console.error("Failed to load remote workspace", error);
            }
        };

        const hydrate = async () => {
            setIsLoading(true);
            await yieldToBrowser();
            const localProjects = readProjectsFromLocalStorage();
            if (!cancelled && localProjects.length > 0) {
                setProjects(localProjects);
            }
            await loadRemoteWorkspace(localProjects);
            if (!cancelled) setIsLoading(false);
        };

        void hydrate();
        return () => {
            cancelled = true;
        };
    }, []);

    // Prefetch top projects to reduce wizard load latency
    useEffect(() => {
        if (!projects.length) return;
        projects.slice(0, 3).forEach((project) => {
            const latestVersion = project.versions[project.versions.length - 1];
            if (!latestVersion) return;
            router.prefetch(`/wizard?projectId=${project.id}&versionId=${latestVersion.id}`);
        });
    }, [projects, router]);

    const saveProjects = (newProjects: Project[]) => {
        setProjects(newProjects);
        writeProjectsToLocalStorage(newProjects);
        void syncWorkspaceRemote(newProjects);
    };

    const prefetchWizard = (projectId: string, versionId: string) => {
        primeWorkspaceCache(projectId);
        void prefetchWorkspaceRemote();
        router.prefetch(`/wizard?projectId=${projectId}&versionId=${versionId}`);
    };

    // --- Modal Handlers ---

    const openCreateModal = () => {
        setModalMode('create');
        setFormData({ name: "", description: "" });
        setCurrentProjectId(null);
        setIsModalOpen(true);
    };

    const openEditModal = (project: Project, e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setModalMode('edit');
        setFormData({ name: project.name, description: project.description || "" });
        setCurrentProjectId(project.id);
        setIsModalOpen(true);
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setFormData({ name: "", description: "" });
        setCurrentProjectId(null);
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.name.trim()) return;

        if (modalMode === 'create') {
            // Create Logic
            const projectId = crypto.randomUUID();
            const initialVersionId = crypto.randomUUID();

            const newVersion: ProjectVersion = {
                id: initialVersionId,
                projectId: projectId,
                versionNumber: 1,
                name: "Initial Draft",
                createdAt: Date.now(),
                status: 'active',
                data: {
                    messages: [{
                        role: "assistant",
                        content: `Hello! I'm your AI Co-Founder. Let's work on **${formData.name}**. \n\n${formData.description ? `I see you want to build: "${formData.description}".` : ""} \n\nTell me more about your vision!`
                    }],
                    evaluation: null,
                    generation: null,
                    currentDiagram: "graph TD\nStart[Start Here]",
                    tasks: [],
                    diagramGovernance: buildDefaultDiagramGovernance()
                }
            };

            const newProject: Project = {
                id: projectId,
                name: formData.name,
                description: formData.description,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                versions: [newVersion]
            };

            const updatedProjects = [newProject, ...projects];
            saveProjects(updatedProjects);

            // Optional: Redirect immediately or stay on dashboard? 
            // Better to stay and let user see the new project, or redirect?
            // "Start Building" usually implies immediate action.
            router.push(`/wizard?projectId=${projectId}&versionId=${initialVersionId}`);

        } else {
            // Edit Logic
            const updatedProjects = projects.map(p =>
                p.id === currentProjectId
                    ? {
                        ...p,
                        name: formData.name,
                        description: formData.description,
                        updatedAt: Date.now()
                    }
                    : p
            );
            saveProjects(updatedProjects);
            handleCloseModal();
        }
    };

    // Delete Logic
    const handleDelete = (projectId: string, e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (confirm("Are you sure you want to delete this project? This action cannot be undone.")) {
            const updatedProjects = projects.filter(p => p.id !== projectId);
            saveProjects(updatedProjects);
        }
    };

    const handleCopyProjectId = async (projectId: string, e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        try {
            await navigator.clipboard.writeText(projectId);
            setCopiedProjectId(projectId);
            window.setTimeout(() => {
                setCopiedProjectId((prev) => (prev === projectId ? null : prev));
            }, 1500);
        } catch (error) {
            console.error("Failed to copy project id", error);
        }
    };

    const latestUpdatedAt = projects.length > 0
        ? Math.max(...projects.map((project) => project.updatedAt))
        : null;

    if (isLoading) return <DashboardSkeleton />;

    return (
        <div className="relative min-h-screen overflow-hidden px-4 pb-10 pt-6 sm:px-8">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-[260px] bg-[radial-gradient(circle_at_top,rgba(13,93,255,0.22),transparent_72%)]" />
            <div className="relative mx-auto max-w-6xl space-y-8">
                <header className="fc-surface rounded-[var(--radius-2xl)] p-5 sm:p-7">
                    <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
                        <div className="space-y-4">
                            <BrandLogo />
                            <div>
                                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Workspace</p>
                                <h1 className="mt-1 text-3xl font-semibold text-slate-900 dark:text-slate-100">Your Projects</h1>
                                <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Manage product directions and keep blueprint versions in one place.</p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <span className="fc-chip text-slate-600 dark:text-slate-300">{projects.length} Projects</span>
                                <span className="fc-chip text-slate-600 dark:text-slate-300">
                                    {latestUpdatedAt ? `Last update: ${new Date(latestUpdatedAt).toLocaleDateString()}` : "No updates yet"}
                                </span>
                            </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-3">
                            <button
                                onClick={openCreateModal}
                                className="fc-button-primary inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold"
                            >
                                <Plus className="h-4 w-4" />
                                New Project
                            </button>
                            <UserCenter signOutCallbackUrl="/" />
                        </div>
                    </div>
                </header>

                {projects.length === 0 ? (
                    <div className="fc-surface-strong flex flex-col items-center justify-center rounded-[var(--radius-2xl)] border-dashed p-12 text-center sm:p-16">
                        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50 dark:bg-blue-900/30">
                            <Folder className="h-8 w-8 text-blue-500" />
                        </div>
                        <h3 className="mb-2 text-xl font-semibold text-slate-900 dark:text-slate-100">No projects yet</h3>
                        <p className="mb-6 max-w-md text-sm text-slate-600 dark:text-slate-300">
                            Create your first project to start requirement clarification, architecture planning, and scaffold generation.
                        </p>
                        <button
                            onClick={openCreateModal}
                            className="fc-button-secondary px-5 py-3 text-sm font-semibold"
                        >
                            Create First Project
                        </button>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {projects.map(project => {
                            const latestVersion = project.versions[project.versions.length - 1];

                            return (
                                <Link
                                    key={project.id}
                                    href={`/wizard?projectId=${project.id}&versionId=${latestVersion.id}`}
                                    onMouseEnter={() => prefetchWizard(project.id, latestVersion.id)}
                                    onFocus={() => prefetchWizard(project.id, latestVersion.id)}
                                    onTouchStart={() => prefetchWizard(project.id, latestVersion.id)}
                                    className="group relative block overflow-hidden rounded-[var(--radius-xl)] border border-[color:var(--border)] bg-white/85 p-5 shadow-[var(--shadow-sm)] transition duration-300 hover:-translate-y-1 hover:border-blue-400/60 hover:shadow-[var(--shadow-lg)] dark:bg-slate-950/70"
                                >
                                    <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-blue-500 via-cyan-500 to-emerald-400 opacity-70" />

                                    {/* Action Buttons */}
                                    <div className="absolute right-4 top-4 z-10 flex gap-2 opacity-0 transition-all group-hover:opacity-100">
                                        <button
                                            onClick={(e) => openEditModal(project, e)}
                                            className="rounded-lg border border-[color:var(--border)] bg-white/95 p-2 text-slate-600 shadow-sm transition hover:text-blue-600 dark:bg-slate-900"
                                            title="Edit Project Details"
                                        >
                                            <Edit2 className="w-4 h-4" />
                                        </button>
                                        <button
                                            onClick={(e) => handleDelete(project.id, e)}
                                            className="rounded-lg border border-[color:var(--border)] bg-white/95 p-2 text-slate-600 shadow-sm transition hover:text-red-600 dark:bg-slate-900"
                                            title="Delete Project"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>

                                    <div className="flex h-full flex-col">
                                        <div className="mb-4 flex items-start justify-between">
                                            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 transition-transform duration-300 group-hover:scale-105 dark:bg-slate-800">
                                                <Folder className="h-6 w-6 text-slate-600 transition-colors group-hover:text-blue-500 dark:text-slate-300" />
                                            </div>
                                        </div>

                                        <h3 className="mb-2 line-clamp-1 text-lg font-semibold text-slate-900 transition-colors group-hover:text-blue-600 dark:text-slate-100 dark:group-hover:text-blue-400">
                                            {project.name}
                                        </h3>

                                        {project.description && (
                                            <p className="mb-4 line-clamp-2 text-sm text-slate-600 dark:text-slate-300">
                                                {project.description}
                                            </p>
                                        )}

                                        <div className="mb-4">
                                            <div className="flex items-center gap-2 rounded-lg border border-[color:var(--border)] bg-slate-50/90 px-2 py-1.5 dark:bg-slate-800/60">
                                                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-300">ID</span>
                                                <code
                                                    className="min-w-0 flex-1 truncate text-[11px] text-slate-700 dark:text-slate-200"
                                                    title={project.id}
                                                >
                                                    {project.id}
                                                </code>
                                                <button
                                                    onClick={(e) => handleCopyProjectId(project.id, e)}
                                                    className="rounded p-1 text-slate-500 transition-colors hover:bg-slate-200 dark:text-slate-200 dark:hover:bg-slate-700"
                                                    title="Copy project ID"
                                                    aria-label="Copy project ID"
                                                >
                                                    {copiedProjectId === project.id ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
                                                </button>
                                            </div>
                                        </div>

                                        <div className="mt-auto flex items-center gap-4 border-t border-[color:var(--border)] pt-4 text-xs text-slate-500 dark:text-slate-300">
                                            <div className="flex items-center gap-1.5 font-medium">
                                                <Clock className="w-3.5 h-3.5" />
                                                {new Date(project.updatedAt).toLocaleDateString()}
                                            </div>
                                        </div>
                                    </div>
                                </Link>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Modal Overlay */}
            {isModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="fc-surface-strong max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-[var(--radius-2xl)] p-6 sm:p-7 animate-in zoom-in-95 duration-200">
                        <div className="mb-6 flex items-center justify-between">
                            <h3 className="text-xl font-semibold text-slate-900 dark:text-slate-100">{modalMode === 'create' ? 'Create New Project' : 'Edit Project Details'}</h3>
                            <button onClick={handleCloseModal} className="text-slate-400 transition-colors hover:text-slate-700 dark:hover:text-slate-200">
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div>
                                <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">
                                    Project Name <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    value={formData.name}
                                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                                    placeholder="e.g., AI Travel Planner"
                                    className="w-full rounded-xl border border-[color:var(--border)] bg-white/85 px-4 py-2.5 text-slate-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30 dark:bg-slate-900/70 dark:text-slate-100"
                                    autoFocus
                                    required
                                />
                            </div>

                            <div>
                                <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">
                                    Description / Memo
                                </label>
                                <textarea
                                    value={formData.description}
                                    onChange={e => setFormData({ ...formData, description: e.target.value })}
                                    placeholder="Briefly describe your idea..."
                                    className="h-24 w-full resize-none rounded-xl border border-[color:var(--border)] bg-white/85 px-4 py-2.5 text-slate-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30 dark:bg-slate-900/70 dark:text-slate-100"
                                />
                            </div>

                            <div className="flex gap-3 pt-4">
                                <button
                                    type="button"
                                    onClick={handleCloseModal}
                                    className="fc-button-secondary flex-1 px-4 py-2.5 text-sm font-semibold"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={!formData.name.trim()}
                                    className="fc-button-primary flex-1 px-4 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    {modalMode === 'create' ? 'Start Building' : 'Save Changes'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}

function DashboardSkeleton() {
    return (
        <div className="relative min-h-screen overflow-hidden px-4 pb-10 pt-6 sm:px-8">
            <div className="mx-auto max-w-6xl space-y-8">
                <header className="fc-surface rounded-[var(--radius-2xl)] p-5 sm:p-7">
                    <div className="flex items-center justify-between">
                        <div className="space-y-3">
                            <div className="h-8 w-32 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
                            <div className="h-6 w-52 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
                            <div className="h-4 w-64 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
                        </div>
                        <div className="h-10 w-32 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-800" />
                    </div>
                </header>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {Array.from({ length: 6 }).map((_, idx) => (
                        <div
                            key={idx}
                            className="fc-surface-strong rounded-[var(--radius-xl)] p-4 animate-pulse"
                        >
                            <div className="h-4 w-32 rounded bg-gray-200 dark:bg-gray-800" />
                            <div className="mt-3 h-3 w-48 rounded bg-gray-100 dark:bg-gray-800" />
                            <div className="mt-6 h-24 rounded-xl bg-gray-100 dark:bg-gray-800" />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
