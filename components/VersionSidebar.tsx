"use client";

import { useState, type ReactNode } from "react";
import { Project } from "@/types";
import { ArrowLeft, Copy, Check } from "lucide-react";
import Link from "next/link";
import { BrandLogo } from "@/components/BrandLogo";
import type { WorkspaceLanguage } from "@/lib/project-language";

interface VersionSidebarProps {
    project: Project;
    children?: ReactNode;
    width?: number;
    language: WorkspaceLanguage;
    headerActions?: ReactNode;
}

export function VersionSidebar({ project, children, width, language, headerActions }: VersionSidebarProps) {
    const [isCopied, setIsCopied] = useState(false);

    const handleCopyProjectId = async () => {
        try {
            await navigator.clipboard.writeText(project.id);
            setIsCopied(true);
            window.setTimeout(() => setIsCopied(false), 1500);
        } catch (error) {
            console.error("Failed to copy project id", error);
        }
    };

    return (
        <aside
            className="relative z-10 flex h-full flex-shrink-0 flex-col border-r border-[color:var(--border)] bg-white/80 backdrop-blur-sm dark:bg-slate-900/72"
            style={{
                width,
                minWidth: 320,
                maxWidth: 720
            }}
        >
            {/* Header */}
            <div className="flex items-start gap-3 border-b border-[color:var(--border)] bg-white/70 p-4 dark:bg-slate-900/75">
                <Link href="/dashboard" className="rounded-lg p-1 transition-colors hover:bg-slate-200 dark:hover:bg-slate-800">
                    <ArrowLeft className="h-4 w-4 text-slate-500 dark:text-slate-300" />
                </Link>
                <BrandLogo
                    showText={false}
                    iconClassName="w-[clamp(18px,1.8vw,24px)] h-[clamp(18px,1.8vw,24px)]"
                />
                <div className="flex-1 min-w-0">
                    <h2 className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{project.name}</h2>
                    <p className="truncate text-xs text-slate-500 dark:text-slate-300">{language === "zh" ? "项目工作区" : "Project Workspace"}</p>
                    <div className="mt-1 flex items-center gap-1.5">
                        <code className="min-w-0 truncate text-[11px] text-slate-600 dark:text-slate-300" title={project.id}>
                            {project.id}
                        </code>
                        <button
                            type="button"
                            onClick={handleCopyProjectId}
                            className="rounded p-1 text-slate-500 transition-colors hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-800"
                            title={language === "zh" ? "复制项目 ID" : "Copy project ID"}
                            aria-label={language === "zh" ? "复制项目 ID" : "Copy project ID"}
                        >
                            {isCopied ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                    </div>
                </div>
                {headerActions ? (
                    <div className="ml-auto flex flex-shrink-0 items-center self-start">
                        {headerActions}
                    </div>
                ) : null}
            </div>

            <div className="flex-1 min-h-0 flex flex-col">
                {children ? (
                    children
                ) : (
                    <div className="p-4 text-xs text-slate-500 dark:text-slate-300">
                        {language === "zh"
                            ? "当前未启用版本管理。这个工作区使用单一实时脚手架。"
                            : "Versioning is disabled. This workspace uses a single live scaffold."}
                    </div>
                )}
            </div>
        </aside>
    );
}
