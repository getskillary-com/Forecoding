"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { Plus, Folder, Clock, Trash2, Edit2, X, Copy, Check } from "lucide-react";
import { DiagramGovernance, Project, ProjectVersion, UiDesignState } from "@/types";
import { useRouter } from "next/navigation";
import { BrandLogo } from "@/components/BrandLogo";
import { UserCenter } from "@/components/UserCenter";
import { useNavigationFeedback } from "@/components/NavigationFeedback";
import { RoutePendingState } from "@/components/RoutePendingState";
import {
    prefetchWorkspaceRemote,
    primeWorkspaceCache,
    readProjectsFromLocalStorage,
    writeProjectsToLocalStorage
} from "@/lib/workspace-cache";
import { scheduleWizardWarmup } from "@/lib/wizard-prefetch";
import {
    getProjectWorkspaceLanguage,
    getWorkspaceLanguageLabel,
    type WorkspaceLanguage
} from "@/lib/project-language";

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

function buildDefaultUiDesignState(): UiDesignState {
    return {
        needsResync: false,
        readiness: {
            score: 0,
            completed: false,
            missingKeys: [
                "visualStyle",
                "colorSystem",
                "typography",
                "keyScreens",
                "uiComponents",
                "responsiveStrategy",
                "interactionMotion",
                "statesAndFeedback"
            ],
            missingLabels: [
                "Visual style",
                "Color system",
                "Typography",
                "Key screens",
                "UI components",
                "Responsive strategy",
                "Interaction motion",
                "States and feedback"
            ],
            updatedAt: Date.now()
        }
    };
}

type ProjectFormData = {
    name: string;
    description: string;
    workspaceLanguage: WorkspaceLanguage;
};

function createEmptyFormData(): ProjectFormData {
    return {
        name: "",
        description: "",
        workspaceLanguage: "zh"
    };
}

function buildInitialAssistantMessage(formData: ProjectFormData) {
    if (formData.workspaceLanguage === "zh") {
        return `你好，我是你的 AI 联合创始人。我们可以先一起聊 **${formData.name}**。${formData.description ? `\n\n我看到你想做的是：“${formData.description}”。` : ""}\n\n你可以直接告诉我你现在想讨论什么；如果你想梳理产品、补齐架构，或者直接推进生成，我也可以切到对应流程。`;
    }

    return `Hello! I'm your AI Co-Founder. We can start with **${formData.name}** together.${formData.description ? `\n\nI see you want to build: "${formData.description}".` : ""}\n\nTell me what you want to work on right now. If you want product discovery, architecture guidance, or scaffold generation, I can switch into that flow when you ask.`;
    if (formData.workspaceLanguage === "zh") {
        return `你好，我是你的 AI 联合创始人。我们先一起梳理 **${formData.name}**。${formData.description ? `\n\n我看到你想做的是：“${formData.description}”。` : ""}\n\n先告诉我你的产品目标、核心用户和最关键的使用流程。`;
    }

    return `Hello! I'm your AI Co-Founder. Let's shape **${formData.name}** together.${formData.description ? `\n\nI see you want to build: "${formData.description}".` : ""}\n\nStart with the product goal, core users, and the most important workflow.`;
}

function buildInitialDiagram(language: WorkspaceLanguage) {
    return language === "zh"
        ? "graph TD\nStart[从这里开始]"
        : "graph TD\nStart[Start Here]";
}

export default function DashboardPage() {
    const router = useRouter();
    const { beginNavigation } = useNavigationFeedback();
    const [projects, setProjects] = useState<Project[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const hasLocalProjectMutationsRef = useRef(false);

    // Modal State
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
    const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
    const [formData, setFormData] = useState<ProjectFormData>(createEmptyFormData());
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
        let backgroundRefreshTimer: number | null = null;

        const loadRemoteWorkspace = async (localProjects: Project[], background = false) => {
            try {
                const remoteProjects = await prefetchWorkspaceRemote();
                const nextProjects = remoteProjects ?? readProjectsFromLocalStorage();

                if (nextProjects.length > 0 || localProjects.length === 0) {
                    if (cancelled) return;
                    if (background && hasLocalProjectMutationsRef.current) return;
                    setProjects(nextProjects);
                } else {
                    void syncWorkspaceRemote(localProjects);
                }
            } catch (error) {
                console.error("Failed to load remote workspace", error);
            }
        };

        const hydrate = async () => {
            hasLocalProjectMutationsRef.current = false;
            setIsLoading(true);
            await yieldToBrowser();
            const localProjects = readProjectsFromLocalStorage();
            if (!cancelled && localProjects.length > 0) {
                setProjects(localProjects);
                setIsLoading(false);
                backgroundRefreshTimer = window.setTimeout(() => {
                    void loadRemoteWorkspace(localProjects, true);
                }, 120);
                return;
            }
            await loadRemoteWorkspace(localProjects);
            if (!cancelled) setIsLoading(false);
        };

        void hydrate();
        return () => {
            cancelled = true;
            if (backgroundRefreshTimer !== null) {
                window.clearTimeout(backgroundRefreshTimer);
            }
        };
    }, []);

    // Prefetch top projects to reduce wizard load latency
    useEffect(() => {
        if (!projects.length) return;
        scheduleWizardWarmup();
        projects.slice(0, 3).forEach((project) => {
            const latestVersion = project.versions[project.versions.length - 1];
            if (!latestVersion) return;
            router.prefetch(`/wizard?projectId=${project.id}&versionId=${latestVersion.id}`);
        });
    }, [projects, router]);

    const saveProjects = (newProjects: Project[]) => {
        hasLocalProjectMutationsRef.current = true;
        setProjects(newProjects);
        writeProjectsToLocalStorage(newProjects);
        void syncWorkspaceRemote(newProjects);
    };

    const prefetchWizard = (projectId: string, versionId: string) => {
        primeWorkspaceCache(projectId);
        void prefetchWorkspaceRemote();
        scheduleWizardWarmup();
        router.prefetch(`/wizard?projectId=${projectId}&versionId=${versionId}`);
    };

    // --- Modal Handlers ---

    const openCreateModal = () => {
        setModalMode('create');
        setFormData(createEmptyFormData());
        setCurrentProjectId(null);
        setIsModalOpen(true);
    };

    const openEditModal = (project: Project, e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setModalMode('edit');
        setFormData({
            name: project.name,
            description: project.description || "",
            workspaceLanguage: getProjectWorkspaceLanguage(project)
        });
        setCurrentProjectId(project.id);
        setIsModalOpen(true);
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setFormData(createEmptyFormData());
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
                        content: buildInitialAssistantMessage(formData)
                    }],
                    evaluation: null,
                    generation: null,
                    currentDiagram: buildInitialDiagram(formData.workspaceLanguage),
                    tasks: [],
                    diagramGovernance: buildDefaultDiagramGovernance(),
                    designStage: "functional_architecture",
                    uiDesignState: buildDefaultUiDesignState(),
                    functionalLockedAt: null,
                    uiReadyAt: null
                }
            };

            const newProject: Project = {
                id: projectId,
                name: formData.name,
                description: formData.description,
                workspaceLanguage: formData.workspaceLanguage,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                versions: [newVersion]
            };

            const updatedProjects = [newProject, ...projects];
            saveProjects(updatedProjects);

            // Optional: Redirect immediately or stay on dashboard? 
            // Better to stay and let user see the new project, or redirect?
            // "Start Building" usually implies immediate action.
            scheduleWizardWarmup();
            beginNavigation(`/wizard?projectId=${projectId}&versionId=${initialVersionId}`);
            router.push(`/wizard?projectId=${projectId}&versionId=${initialVersionId}`);

        } else {
            // Edit Logic
            const updatedProjects = projects.map(p =>
                p.id === currentProjectId
                    ? {
                        ...p,
                        name: formData.name,
                        description: formData.description,
                        workspaceLanguage: formData.workspaceLanguage,
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
                <header className="fc-surface relative z-40 rounded-[var(--radius-2xl)] p-5 sm:p-7">
                    <div className="mb-5 flex items-center justify-between">
                        <BrandLogo />
                        <div className="flex items-center gap-3">
                            <UserCenter signOutCallbackUrl="/" />
                        </div>
                    </div>
                    <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
                        <div className="space-y-4">
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

                                        <div className="mb-4 flex">
                                            <span className="rounded-full border border-[color:var(--border)] bg-slate-50/90 px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:bg-slate-800/60 dark:text-slate-200">
                                                {getWorkspaceLanguageLabel(getProjectWorkspaceLanguage(project))}
                                            </span>
                                        </div>

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

                            <div>
                                <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">
                                    Workspace Language
                                </label>
                                <div className="grid grid-cols-2 gap-2">
                                    {([
                                        { value: "zh", label: "中文", description: "Workspace UI and AI replies stay in Chinese." },
                                        { value: "en", label: "English", description: "Workspace UI and AI replies stay in English." }
                                    ] as const).map((option) => {
                                        const active = formData.workspaceLanguage === option.value;
                                        return (
                                            <button
                                                key={option.value}
                                                type="button"
                                                onClick={() => setFormData({ ...formData, workspaceLanguage: option.value })}
                                                className={`rounded-xl border px-4 py-3 text-left transition ${active
                                                    ? "border-blue-500 bg-blue-50 text-blue-700 shadow-sm dark:bg-blue-900/20 dark:text-blue-200"
                                                    : "border-[color:var(--border)] bg-white/85 text-slate-700 hover:border-blue-300 dark:bg-slate-900/70 dark:text-slate-200"}`}
                                            >
                                                <div className="text-sm font-semibold">{option.label}</div>
                                                <div className="mt-1 text-xs text-slate-500 dark:text-slate-300">{option.description}</div>
                                            </button>
                                        );
                                    })}
                                </div>
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
    return <RoutePendingState label="Loading workspace..." />;
}
