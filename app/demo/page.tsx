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
    Layers
} from "lucide-react";
import type { Project, ProjectVersion } from "@/types";
import { BrandLogo } from "@/components/BrandLogo";
import { ChatBubble } from "@/components/ChatBubble";
import { getProjectWorkspaceLanguage } from "@/lib/project-language";

const ArchitectureViewer = dynamic(() => import("@/components/ArchitectureViewer"), {
    ssr: false,
    loading: () => <div className="p-4 text-sm text-slate-500 dark:text-slate-300">Loading architecture...</div>
});

const FileTreeDisplay = dynamic(() => import("@/components/FileTreeDisplay").then((m) => m.FileTreeDisplay), {
    ssr: false,
    loading: () => <div className="p-4 text-sm text-slate-500 dark:text-slate-300">Loading file tree...</div>
});

const ToolStackTable = dynamic(() => import("@/components/ToolStackTable").then((m) => m.ToolStackTable), {
    ssr: false,
    loading: () => <div className="p-4 text-sm text-slate-500 dark:text-slate-300">Loading stack...</div>
});

type DemoWorkspacePayload = {
    version?: number;
    exportedAt?: string;
    project?: Project;
};

type DemoTab = "architecture" | "prd" | "tasks" | "files" | "stack";

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
            className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition-all ${active
                ? "border border-blue-200 bg-blue-50 text-blue-700 shadow-sm dark:border-blue-700/40 dark:bg-blue-900/20 dark:text-blue-200"
                : "text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800/65"} ${disabled ? "cursor-not-allowed opacity-40" : ""}`}
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
            <div className="relative min-h-screen overflow-hidden px-4 py-6 sm:px-6">
                <div className="pointer-events-none absolute inset-0">
                    <div className="fc-float absolute -top-20 -left-20 h-72 w-72 rounded-full bg-blue-500/20 blur-3xl" />
                    <div className="fc-float absolute right-0 top-1/3 h-72 w-72 rounded-full bg-cyan-500/20 blur-3xl" style={{ animationDelay: "0.9s" }} />
                </div>
                <div className="relative mx-auto max-w-6xl">
                    <div className="h-10 w-64 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
                    <div className="fc-surface-strong mt-6 h-[70vh] animate-pulse rounded-[var(--radius-2xl)]" />
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="relative min-h-screen overflow-hidden px-4 py-6 sm:px-6">
                <div className="pointer-events-none absolute inset-0">
                    <div className="fc-float absolute -top-20 -left-20 h-72 w-72 rounded-full bg-blue-500/20 blur-3xl" />
                    <div className="fc-float absolute right-0 top-1/3 h-72 w-72 rounded-full bg-cyan-500/20 blur-3xl" style={{ animationDelay: "0.9s" }} />
                </div>
                <div className="fc-surface-strong relative mx-auto max-w-4xl rounded-[var(--radius-2xl)] px-6 py-16 text-center">
                    <h1 className="text-3xl font-semibold text-slate-900 dark:text-slate-100">Demo Workspace Unavailable</h1>
                    <p className="mt-3 text-slate-600 dark:text-slate-300">{error}</p>
                    <Link
                        href="/dashboard"
                        className="fc-button-primary mt-6 inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold"
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
            <div className="relative min-h-screen overflow-hidden px-4 py-6 sm:px-6">
                <div className="pointer-events-none absolute inset-0">
                    <div className="fc-float absolute -top-20 -left-20 h-72 w-72 rounded-full bg-blue-500/20 blur-3xl" />
                    <div className="fc-float absolute right-0 top-1/3 h-72 w-72 rounded-full bg-cyan-500/20 blur-3xl" style={{ animationDelay: "0.9s" }} />
                </div>
                <div className="fc-surface-strong relative mx-auto max-w-4xl rounded-[var(--radius-2xl)] px-6 py-16 text-center">
                    <h1 className="text-3xl font-semibold text-slate-900 dark:text-slate-100">Demo Workspace Not Published</h1>
                    <p className="mt-3 text-slate-600 dark:text-slate-300">
                        Run <code className="rounded bg-slate-100 px-1 py-0.5 dark:bg-slate-800">npm run demo:export -- --email you@example.com --project-id &lt;PROJECT_ID&gt;</code>
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
    const workspaceLanguage = getProjectWorkspaceLanguage(project);

    return (
        <div className="relative min-h-screen overflow-hidden px-4 py-6 md:px-6">
            <div className="pointer-events-none absolute inset-0">
                <div className="fc-float absolute -top-20 -left-20 h-72 w-72 rounded-full bg-blue-500/20 blur-3xl" />
                <div className="fc-float absolute right-0 top-1/3 h-72 w-72 rounded-full bg-cyan-500/20 blur-3xl" style={{ animationDelay: "0.9s" }} />
            </div>
            <div className="relative mx-auto max-w-[1400px]">
                <header className="fc-surface mb-4 flex flex-col gap-3 rounded-[var(--radius-2xl)] p-4 md:flex-row md:items-center md:justify-between md:p-5">
                    <div className="space-y-2">
                        <BrandLogo />
                        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100 md:text-3xl">Public Demo Workspace (Read-only)</h1>
                        <p className="text-sm text-slate-600 dark:text-slate-300">
                            This page shows a complete workspace from requirement chat to scaffold output.
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="rounded-full border border-blue-200 bg-blue-100 px-2 py-1 text-blue-700 dark:border-blue-700/40 dark:bg-blue-900/20 dark:text-blue-300">
                            Project: {project.name}
                        </span>
                        <span className="rounded-full border border-[color:var(--border)] bg-slate-100 px-2 py-1 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                            Exported: {formatExportTime(payload?.exportedAt)}
                        </span>
                        <Link
                            href="/dashboard"
                            className="fc-button-primary inline-flex items-center gap-1 px-3 py-1.5 text-sm font-semibold"
                        >
                            Try with your own requirement
                            <ArrowRight className="w-3.5 h-3.5" />
                        </Link>
                    </div>
                </header>

                <div className="grid grid-cols-1 xl:grid-cols-[420px_1fr] gap-4 min-h-[78vh]">
                    <section className="fc-surface-strong flex min-h-0 flex-col overflow-hidden rounded-[var(--radius-2xl)]">
                        <div className="flex items-center gap-2 border-b border-[color:var(--border)] px-4 py-3 text-sm font-semibold">
                            <MessageSquare className="w-4 h-4 text-blue-500" />
                            Conversation ({messages.length})
                        </div>
                        <div className="flex-1 overflow-y-auto p-4 space-y-4">
                            {messages.map((msg, idx) => (
                                <ChatBubble key={idx} message={msg} />
                            ))}
                        </div>
                    </section>

                    <section className="fc-surface-strong flex min-h-0 flex-col overflow-hidden rounded-[var(--radius-2xl)]">
                        <div className="flex gap-1 overflow-x-auto border-b border-[color:var(--border)] p-3">
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
                                label="Scaffold"
                                disabled={!generation}
                            />
                            <DemoTabButton
                                active={activeTab === "stack"}
                                onClick={() => setActiveTab("stack")}
                                icon={<Layers className="w-4 h-4" />}
                                label="Stack"
                                disabled={!generation}
                            />
                        </div>

                        <div className="flex-1 min-h-0 overflow-hidden">
                            {activeTab === "architecture" && (
                                <div className="h-full p-4">
                                    <div className="h-full overflow-hidden rounded-xl border border-[color:var(--border)] bg-slate-50 dark:bg-black/30">
                                        <ArchitectureViewer code={architectureCode} language={workspaceLanguage} />
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
                                                    <li key={idx} className="rounded-lg border border-emerald-100 bg-emerald-50 p-3 text-sm dark:border-emerald-800/40 dark:bg-emerald-900/15">
                                                        {item}
                                                    </li>
                                                ))}
                                            </ul>
                                        ) : (
                                            <p className="text-sm text-slate-500 dark:text-slate-300">No clarified items.</p>
                                        )}
                                    </div>

                                    <div>
                                        <h3 className="font-semibold text-amber-600 dark:text-amber-400 mb-2">Missing / Open Items</h3>
                                        {evaluation?.analysis?.missing?.length ? (
                                            <ul className="space-y-2">
                                                {evaluation.analysis.missing.map((item, idx) => (
                                                    <li key={idx} className="rounded-lg border border-amber-100 bg-amber-50 p-3 text-sm dark:border-amber-800/40 dark:bg-amber-900/15">
                                                        {item}
                                                    </li>
                                                ))}
                                            </ul>
                                        ) : (
                                            <p className="text-sm text-slate-500 dark:text-slate-300">No missing items.</p>
                                        )}
                                    </div>

                                    <div>
                                        <h3 className="font-semibold text-blue-600 dark:text-blue-400 mb-2">Readiness</h3>
                                        <p className="text-sm text-slate-600 dark:text-slate-300">
                                            Readiness: {evaluation?.readiness?.score ?? evaluation?.density_score ?? 0} / 100 | Ready: {evaluation?.is_ready ? "Yes" : "No"}
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
                                                <div key={task.id} className="rounded-lg border border-[color:var(--border)] bg-slate-50 p-3 dark:bg-slate-900/40">
                                                    <div className="flex items-center justify-between gap-3">
                                                        <div className="font-medium text-sm">{task.title}</div>
                                                        <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                                                            {task.status}
                                                        </span>
                                                    </div>
                                                    {task.description ? (
                                                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-300">{task.description}</p>
                                                    ) : null}
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <p className="text-sm text-slate-500 dark:text-slate-300">No tasks available.</p>
                                    )}
                                </div>
                            )}

                            {activeTab === "files" && (
                                <div className="h-full p-4 overflow-hidden">
                                    {generation?.projectTree?.length ? (
                                        <FileTreeDisplay
                                            content={generation.projectTree}
                                            projectName={project.name}
                                            language={workspaceLanguage}
                                        />
                                    ) : (
                                        <p className="p-4 text-sm text-slate-500 dark:text-slate-300">No generated project tree.</p>
                                    )}
                                </div>
                            )}

                            {activeTab === "stack" && (
                                <div className="h-full p-4 overflow-y-auto">
                                    {generation?.toolStack ? (
                                        <ToolStackTable content={generation.toolStack} language={workspaceLanguage} />
                                    ) : (
                                        <p className="p-4 text-sm text-slate-500 dark:text-slate-300">No tool stack content.</p>
                                    )}
                                </div>
                            )}

                        </div>
                    </section>
                </div>
            </div>
        </div>
    );
}
