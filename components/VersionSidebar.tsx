"use client";

import type { ReactNode } from "react";
import { Project } from "@/types";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

interface VersionSidebarProps {
    project: Project;
    children?: ReactNode;
    width?: number;
}

export function VersionSidebar({ project, children, width }: VersionSidebarProps) {
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
                <div className="flex-1 min-w-0">
                    <h2 className="font-bold text-sm text-gray-900 dark:text-gray-100 truncate">{project.name}</h2>
                    <p className="text-xs text-gray-500 truncate">Project Workspace</p>
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
