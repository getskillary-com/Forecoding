"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Plus, Folder, Clock, Trash2, Edit2, X } from "lucide-react";
import { Project, ProjectVersion } from "@/types";
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

export default function DashboardPage() {
    const router = useRouter();
    const [projects, setProjects] = useState<Project[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    // Modal State
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
    const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
    const [formData, setFormData] = useState({ name: "", description: "" });

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
                    tasks: []
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

    if (isLoading) return <DashboardSkeleton />;

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-950 p-8">
            <div className="max-w-6xl mx-auto">
                <header className="flex justify-between items-center mb-10">
                    <div className="space-y-3">
                        <BrandLogo />
                        <div>
                            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Your Projects</h1>
                            <p className="text-gray-500 dark:text-gray-400 mt-1">Manage and evolve your ideas.</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={openCreateModal}
                            className="flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold shadow-lg transition-all transform hover:scale-105 active:scale-95"
                        >
                            <Plus className="w-5 h-5" />
                            New Project
                        </button>
                        <UserCenter signOutCallbackUrl="/" />
                    </div>
                </header>

                {projects.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 bg-white dark:bg-gray-900 rounded-3xl border border-dashed border-gray-300 dark:border-gray-800">
                        <div className="w-16 h-16 bg-blue-50 dark:bg-blue-900/20 rounded-2xl flex items-center justify-center mb-4">
                            <Folder className="w-8 h-8 text-blue-500" />
                        </div>
                        <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">No projects yet</h3>
                        <p className="text-gray-500 dark:text-gray-400 mb-6 max-w-md text-center">
                            Start your journey by creating your first project. The AI architect is ready to help.
                        </p>
                        <button
                            onClick={openCreateModal}
                            className="text-blue-600 font-semibold hover:underline"
                        >
                            Create one now
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
                                    className="group block bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 hover:border-blue-500/50 hover:shadow-xl transition-all duration-300 relative overflow-hidden"
                                >
                                    {/* Action Buttons */}
                                    <div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                                        <button
                                            onClick={(e) => openEditModal(project, e)}
                                            className="p-2 bg-gray-100 hover:bg-white dark:bg-gray-800 dark:hover:bg-gray-700 rounded-lg text-gray-600 dark:text-gray-300 hover:text-blue-600 transition-colors shadow-sm"
                                            title="Edit Project Details"
                                        >
                                            <Edit2 className="w-4 h-4" />
                                        </button>
                                        <button
                                            onClick={(e) => handleDelete(project.id, e)}
                                            className="p-2 bg-gray-100 hover:bg-red-50 dark:bg-gray-800 dark:hover:bg-red-900/20 rounded-lg text-gray-600 dark:text-gray-300 hover:text-red-600 transition-colors shadow-sm"
                                            title="Delete Project"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>

                                    <div className="p-6 h-full flex flex-col">
                                        <div className="flex items-start justify-between mb-4">
                                            <div className="w-12 h-12 bg-gray-100 dark:bg-gray-800 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                                                <Folder className="w-6 h-6 text-gray-600 dark:text-gray-400 group-hover:text-blue-500 transition-colors" />
                                            </div>
                                        </div>

                                        <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2 line-clamp-1 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                                            {project.name}
                                        </h3>

                                        {project.description && (
                                            <p className="text-sm text-gray-500 dark:text-gray-400 line-clamp-2 mb-4">
                                                {project.description}
                                            </p>
                                        )}

                                        <div className="mt-auto flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400 border-t border-gray-100 dark:border-gray-800 pt-4">
                                            <div className="flex items-center gap-1.5">
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
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-2xl p-6 border border-gray-200 dark:border-gray-800 animate-in zoom-in-95 duration-200 max-h-[88vh] overflow-y-auto">
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-xl font-bold">{modalMode === 'create' ? 'Create New Project' : 'Edit Project Details'}</h3>
                            <button onClick={handleCloseModal} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                    Project Name <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    value={formData.name}
                                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                                    placeholder="e.g., AI Travel Planner"
                                    className="w-full px-4 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                                    autoFocus
                                    required
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                    Description / Memo
                                </label>
                                <textarea
                                    value={formData.description}
                                    onChange={e => setFormData({ ...formData, description: e.target.value })}
                                    placeholder="Briefly describe your idea..."
                                    className="w-full px-4 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 focus:ring-2 focus:ring-blue-500 outline-none transition-all h-24 resize-none"
                                />
                            </div>

                            <div className="flex gap-3 pt-4">
                                <button
                                    type="button"
                                    onClick={handleCloseModal}
                                    className="flex-1 px-4 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-xl font-semibold transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={!formData.name.trim()}
                                    className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
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
        <div className="min-h-screen bg-gray-50 dark:bg-gray-950 p-8">
            <div className="max-w-6xl mx-auto">
                <header className="flex justify-between items-center mb-10">
                    <div className="space-y-3">
                        <div className="h-8 w-32 bg-gray-200 dark:bg-gray-800 rounded animate-pulse" />
                        <div className="h-6 w-48 bg-gray-200 dark:bg-gray-800 rounded animate-pulse" />
                        <div className="h-4 w-64 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
                    </div>
                    <div className="h-10 w-32 bg-gray-200 dark:bg-gray-800 rounded-xl animate-pulse" />
                </header>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {Array.from({ length: 6 }).map((_, idx) => (
                        <div
                            key={idx}
                            className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-4 animate-pulse"
                        >
                            <div className="h-4 w-32 bg-gray-200 dark:bg-gray-800 rounded" />
                            <div className="mt-3 h-3 w-48 bg-gray-100 dark:bg-gray-800 rounded" />
                            <div className="mt-6 h-24 bg-gray-100 dark:bg-gray-800 rounded-xl" />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
