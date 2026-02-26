"use client";

import { useState, type ReactNode } from "react";
import { Project } from "@/types";
import { ArrowLeft, Copy, Check } from "lucide-react";
import Link from "next/link";
import { BrandLogo } from "@/components/BrandLogo";

interface VersionSidebarProps {
    project: Project;
    children?: ReactNode;
    width?: number;
}

export function VersionSidebar({ project, children, width }: VersionSidebarProps) {
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
            className="flex flex-col border-r border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 h-full flex-shrink-0"
            style={{
                width,
                minWidth: 320,
                maxWidth: 720
            }}
        >
            {/* Header */}
            <div className="p-4 border-b border-gray-200 dark:border-gray-800 flex items-center gap-2">
                <Link href="/dashboard" className="p-1 hover:bg-gray-200 dark:hover:bg-gray-800 rounded-lg transition-colors">
                    <ArrowLeft className="w-4 h-4 text-gray-500" />
                </Link>
                <BrandLogo
                    showText={false}
                    iconClassName="w-[clamp(18px,1.8vw,24px)] h-[clamp(18px,1.8vw,24px)]"
                />
                <div className="flex-1 min-w-0">
                    <h2 className="font-bold text-sm text-gray-900 dark:text-gray-100 truncate">{project.name}</h2>
                    <p className="text-xs text-gray-500 truncate">Project Workspace</p>
                    <div className="mt-1 flex items-center gap-1.5">
                        <code className="min-w-0 truncate text-[11px] text-gray-600 dark:text-gray-300" title={project.id}>
                            {project.id}
                        </code>
                        <button
                            type="button"
                            onClick={handleCopyProjectId}
                            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors text-gray-500 dark:text-gray-300"
                            title="Copy project ID"
                            aria-label="Copy project ID"
                        >
                            {isCopied ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                    </div>
                </div>
            </div>

            <div className="flex-1 min-h-0 flex flex-col">
                {children ? (
                    children
                ) : (
                    <div className="p-4 text-xs text-gray-500 dark:text-gray-400">
                        Versioning is disabled. This workspace uses a single live blueprint.
                    </div>
                )}
            </div>
        </aside>
    );
}
