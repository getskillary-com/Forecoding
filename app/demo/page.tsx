"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
    ArrowRight,
    MessageSquare,
    Activity,
    BrainCircuit,
    ListChecks,
    FileCode,
    Layers,
    Download
} from "lucide-react";
import type { Project, ProjectVersion } from "@/types";
import { BrandLogo } from "@/components/BrandLogo";
import { ChatBubble } from "@/components/ChatBubble";

const ArchitectureViewer = dynamic(() => import("@/components/ArchitectureViewer"), {
    ssr: false,
    loading: () => <div className="p-4 text-sm text-gray-500 dark:text-gray-400">Loading architecture...</div>
});

const FileTreeDisplay = dynamic(() => import("@/components/FileTreeDisplay").then((m) => m.FileTreeDisplay), {
    ssr: false,
    loading: () => <div className="p-4 text-sm text-gray-500 dark:text-gray-400">Loading file tree...</div>
});

const ToolStackTable = dynamic(() => import("@/components/ToolStackTable").then((m) => m.ToolStackTable), {
    ssr: false,
    loading: () => <div className="p-4 text-sm text-gray-500 dark:text-gray-400">Loading stack...</div>
});

type DemoWorkspacePayload = {
    version?: number;
    exportedAt?: string;
    project?: Project;
};

type DemoTab = "architecture" | "prd" | "tasks" | "files" | "stack" | "prompt";

function getLatestVersion(project: Project | null): ProjectVersion | null {
    if (!project?.versions?.length) return null;
    return project.versions[project.versions.length - 1] || null;
}

function formatExportTime(value: string | undefined) {
    if (!value) return "unknown";
    const time = new Date(value);
    if (Number.isNaN(time.getTime())) return value;
    return time.toLocaleString();
}

function DemoTabButton({
    active,
    label,
    icon,
    onClick,
    disabled
}: {
    active: boolean;
    label: string;
    icon: React.ReactNode;
    onClick: () => void;
    disabled?: boolean;
}) {
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${active
                ? "bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm border border-gray-200 dark:border-gray-700"
                : "text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800/60"} ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}
        >
            {icon}
            <span>{label}</span>
        </button>
    );
}

export default function DemoPage() {
    const [payload, setPayload] = useState<DemoWorkspacePayload | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<DemoTab>("architecture");

    useEffect(() => {
        let cancelled = false;

        const loadDemo = async () => {
            setLoading(true);
            setError(null);
            try {
                const res = await fetch(`/demo/workspace.json?ts=${Date.now()}`, { cache: "no-store" });
                if (!res.ok) {
                    throw new Error(`Failed to load demo workspace (${res.status}).`);
                }
                const data = (await res.json()) as DemoWorkspacePayload;
                if (!cancelled) setPayload(data);
            } catch (e) {
                if (!cancelled) {
                    const message = e instanceof Error ? e.message : "Failed to load demo workspace.";
                    setError(message);
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        void loadDemo();

        return () => {
            cancelled = true;
        };
    }, []);

    const project = payload?.project || null;
    const version = useMemo(() => getLatestVersion(project), [project]);
    const projectData = version?.data;

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-50 dark:bg-black text-gray-900 dark:text-gray-100 p-6">
                <div className="max-w-6xl mx-auto">
                    <div className="h-10 w-64 bg-gray-200 dark:bg-gray-800 rounded animate-pulse" />
                    <div className="mt-6 h-[70vh] bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 animate-pulse" />
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="min-h-screen bg-gray-50 dark:bg-black text-gray-900 dark:text-gray-100 p-6">
                <div className="max-w-4xl mx-auto text-center pt-20">
                    <h1 className="text-3xl font-bold">Demo Workspace Unavailable</h1>
                    <p className="mt-3 text-gray-600 dark:text-gray-300">{error}</p>
                    <Link
                        href="/dashboard"
                        className="inline-flex items-center gap-2 mt-6 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white"
                    >
                        Go to Dashboard
                        <ArrowRight className="w-4 h-4" />
                    </Link>
                </div>
            </div>
        );
    }

    if (!project || !version || !projectData) {
        return (
            <div className="min-h-screen bg-gray-50 dark:bg-black text-gray-900 dark:text-gray-100 p-6">
                <div className="max-w-4xl mx-auto text-center pt-20">
                    <h1 className="text-3xl font-bold">Demo Workspace Not Published</h1>
                    <p className="mt-3 text-gray-600 dark:text-gray-300">
                        Run <code className="px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-800">npm run demo:export -- --email you@example.com --project-id &lt;PROJECT_ID&gt;</code>
                        to publish a complete demo from your account.
                    </p>
                </div>
            </div>
        );
    }

    const evaluation = projectData.evaluation;
    const generation = projectData.generation;
    const messages = projectData.messages || [];
    const tasks = projectData.tasks || [];
    const architectureCode = projectData.currentDiagram || "graph TD\nStart[No Architecture]";
    const startupPrompt = generation?.startupPrompt || generation?.cursorPrompt || "No startup prompt available.";

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-black text-gray-900 dark:text-gray-100 p-4 md:p-6">
            <div className="max-w-[1400px] mx-auto">
                <header className="mb-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                    <div className="space-y-2">
                        <BrandLogo />
                        <h1 className="text-2xl md:text-3xl font-bold">Public Demo Workspace (Read-only)</h1>
                        <p className="text-sm text-gray-600 dark:text-gray-300">
                            This page shows a complete workspace from requirement chat to blueprint output.
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="px-2 py-1 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                            Project: {project.name}
                        </span>
                        <span className="px-2 py-1 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700">
                            Exported: {formatExportTime(payload?.exportedAt)}
                        </span>
                        <Link
                            href="/dashboard"
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white"
                        >
                            Try with your own requirement
                            <ArrowRight className="w-3.5 h-3.5" />
                        </Link>
                    </div>
                </header>

                <div className="grid grid-cols-1 xl:grid-cols-[420px_1fr] gap-4 min-h-[78vh]">
                    <section className="bg-white dark:bg-gray-900/60 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden flex flex-col min-h-0">
                        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800 flex items-center gap-2 text-sm font-semibold">
                            <MessageSquare className="w-4 h-4 text-blue-500" />
                            Conversation ({messages.length})
                        </div>
                        <div className="flex-1 overflow-y-auto p-4 space-y-4">
                            {messages.map((msg, idx) => (
                                <ChatBubble key={idx} message={msg} />
                            ))}
                        </div>
                    </section>

                    <section className="bg-white dark:bg-gray-900/60 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden flex flex-col min-h-0">
                        <div className="p-3 border-b border-gray-200 dark:border-gray-800 flex gap-1 overflow-x-auto">
                            <DemoTabButton
                                active={activeTab === "architecture"}
                                onClick={() => setActiveTab("architecture")}
                                icon={<BrainCircuit className="w-4 h-4" />}
                                label="Architecture"
                            />
                            <DemoTabButton
                                active={activeTab === "prd"}
                                onClick={() => setActiveTab("prd")}
                                icon={<Activity className="w-4 h-4" />}
                                label="PRD"
                            />
                            <DemoTabButton
                                active={activeTab === "tasks"}
                                onClick={() => setActiveTab("tasks")}
                                icon={<ListChecks className="w-4 h-4" />}
                                label="Tasks"
                            />
                            <DemoTabButton
                                active={activeTab === "files"}
                                onClick={() => setActiveTab("files")}
                                icon={<FileCode className="w-4 h-4" />}
                                label="Files"
                                disabled={!generation}
                            />
                            <DemoTabButton
                                active={activeTab === "stack"}
                                onClick={() => setActiveTab("stack")}
                                icon={<Layers className="w-4 h-4" />}
                                label="Stack"
                                disabled={!generation}
                            />
                            <DemoTabButton
                                active={activeTab === "prompt"}
                                onClick={() => setActiveTab("prompt")}
                                icon={<Download className="w-4 h-4" />}
                                label="Startup Prompt"
                            />
                        </div>

                        <div className="flex-1 min-h-0 overflow-hidden">
                            {activeTab === "architecture" && (
                                <div className="h-full p-4">
                                    <div className="h-full rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden bg-gray-50 dark:bg-black/30">
                                        <ArchitectureViewer code={architectureCode} />
                                    </div>
                                </div>
                            )}

                            {activeTab === "prd" && (
                                <div className="h-full overflow-y-auto p-5 space-y-6">
                                    <div>
                                        <h3 className="font-semibold text-green-600 dark:text-green-400 mb-2">Clarified Requirements</h3>
                                        {evaluation?.analysis?.clarified?.length ? (
                                            <ul className="space-y-2">
                                                {evaluation.analysis.clarified.map((item, idx) => (
                                                    <li key={idx} className="text-sm p-3 rounded-lg border border-green-100 dark:border-green-900/30 bg-green-50 dark:bg-green-900/10">
                                                        {item}
                                                    </li>
                                                ))}
                                            </ul>
                                        ) : (
                                            <p className="text-sm text-gray-500">No clarified items.</p>
                                        )}
                                    </div>

                                    <div>
                                        <h3 className="font-semibold text-amber-600 dark:text-amber-400 mb-2">Missing / Open Items</h3>
                                        {evaluation?.analysis?.missing?.length ? (
                                            <ul className="space-y-2">
                                                {evaluation.analysis.missing.map((item, idx) => (
                                                    <li key={idx} className="text-sm p-3 rounded-lg border border-amber-100 dark:border-amber-900/30 bg-amber-50 dark:bg-amber-900/10">
                                                        {item}
                                                    </li>
                                                ))}
                                            </ul>
                                        ) : (
                                            <p className="text-sm text-gray-500">No missing items.</p>
                                        )}
                                    </div>

                                    <div>
                                        <h3 className="font-semibold text-blue-600 dark:text-blue-400 mb-2">Readiness</h3>
                                        <p className="text-sm text-gray-600 dark:text-gray-300">
                                            Density: {evaluation?.density_score ?? 0} / 100 | Ready: {evaluation?.is_ready ? "Yes" : "No"}
                                        </p>
                                    </div>
                                </div>
                            )}

                            {activeTab === "tasks" && (
                                <div className="h-full overflow-y-auto p-5">
                                    <h3 className="font-semibold mb-3">Execution Tasks</h3>
                                    {tasks.length ? (
                                        <div className="space-y-2">
                                            {tasks.map((task) => (
                                                <div key={task.id} className="p-3 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/40">
                                                    <div className="flex items-center justify-between gap-3">
                                                        <div className="font-medium text-sm">{task.title}</div>
                                                        <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                                                            {task.status}
                                                        </span>
                                                    </div>
                                                    {task.description ? (
                                                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{task.description}</p>
                                                    ) : null}
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <p className="text-sm text-gray-500">No tasks available.</p>
                                    )}
                                </div>
                            )}

                            {activeTab === "files" && (
                                <div className="h-full p-4 overflow-hidden">
                                    {generation?.projectTree?.length ? (
                                        <FileTreeDisplay
                                            content={generation.projectTree}
                                            globalPrompt={generation.cursorPrompt}
                                            projectName={project.name}
                                        />
                                    ) : (
                                        <p className="text-sm text-gray-500 p-4">No generated project tree.</p>
                                    )}
                                </div>
                            )}

                            {activeTab === "stack" && (
                                <div className="h-full p-4 overflow-y-auto">
                                    {generation?.toolStack ? (
                                        <ToolStackTable content={generation.toolStack} />
                                    ) : (
                                        <p className="text-sm text-gray-500 p-4">No tool stack content.</p>
                                    )}
                                </div>
                            )}

                            {activeTab === "prompt" && (
                                <div className="h-full p-5 overflow-y-auto">
                                    <h3 className="font-semibold mb-3">Startup Prompt</h3>
                                    <pre className="text-xs whitespace-pre-wrap rounded-xl border border-gray-200 dark:border-gray-800 p-4 bg-gray-50 dark:bg-black/30">
                                        {startupPrompt}
                                    </pre>
                                </div>
                            )}
                        </div>
                    </section>
                </div>
            </div>
        </div>
    );
}
