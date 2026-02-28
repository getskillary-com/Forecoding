"use client";

import React, { useState } from "react";
import { Folder, FileCode, Download, ChevronRight, ChevronDown } from "lucide-react";
import { FileNode } from "@/types";

interface Props {
    content: FileNode[] | string;
    globalPrompt?: string;
    projectName?: string;
}

type ExportMode = "blueprint" | "scaffold";

function TreeNode({ node, depth = 0 }: { node: FileNode; depth?: number }) {
    const [isOpen, setIsOpen] = useState(true);
    const isFolder = node.type === "folder";

    return (
        <div className="select-none">
            <div
                className="flex items-center gap-2 py-1 px-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors cursor-pointer text-sm"
                style={{ marginLeft: `${depth * 16}px` }}
                onClick={() => isFolder && setIsOpen(!isOpen)}
            >
                {isFolder ? (
                    isOpen ? <ChevronDown className="w-4 h-4 text-gray-500" /> : <ChevronRight className="w-4 h-4 text-gray-500" />
                ) : (
                    <span className="w-4" />
                )}

                {isFolder ? (
                    <Folder className="w-4 h-4 text-blue-500" />
                ) : (
                    <FileCode className="w-4 h-4 text-gray-500" />
                )}

                <span className="font-mono text-gray-700 dark:text-gray-300">{node.name}</span>
                {!isFolder && <span className="text-xs text-gray-400 ml-auto italic">Prompt Included</span>}
            </div>

            {isFolder && isOpen && node.children && (
                <div>
                    {node.children.map((child, i) => (
                        <TreeNode key={i} node={child} depth={depth + 1} />
                    ))}
                </div>
            )}
        </div>
    );
}

export function FileTreeDisplay({ content, globalPrompt, projectName }: Props) {
    const [isZipping, setIsZipping] = useState(false);
    const [exportMode, setExportMode] = useState<ExportMode>("blueprint");
    const AUTO_GENERATED_FILES = new Set(["package.json", "tsconfig.json", "next.config.ts"]);
    const resolvedProjectName = projectName?.trim();
    const zipFileNameBase = (resolvedProjectName && resolvedProjectName.length > 0 ? resolvedProjectName : "founder-blueprint")
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
        .replace(/\s+/g, " ")
        .replace(/[. ]+$/g, "");
    const zipFileName = `${zipFileNameBase || "founder-blueprint"}-${exportMode}.zip`;
    const SCAFFOLD_HINT_MAX_CHARS = 1200;

    const toScaffoldPlaceholder = (promptPath: string, fileContent?: string) => {
        const hint = (fileContent || "").slice(0, SCAFFOLD_HINT_MAX_CHARS);
        return `// GENERATION PENDING\n// Open ${promptPath} and ask AI to generate this file.\n\n// Content Hint:\n/*\n${hint}...\n*/`;
    };

    const shouldWriteRealContent = (path: string, fileName: string) => {
        if (exportMode === "blueprint") return true;
        if (AUTO_GENERATED_FILES.has(fileName)) return true;
        if (path === ".env.example") return true;
        if (path.startsWith("docs/")) return true;
        if (path.startsWith("config/integrations/") && /\.template\./.test(fileName)) return true;
        return false;
    };

    const handleDownload = async () => {
        if (typeof content === "string") return;
        setIsZipping(true);

        try {
        const { default: JSZip } = await import("jszip");
        const zip = new JSZip();
            const reservedPaths = new Set<string>();

            if (globalPrompt) {
                zip.file(".cursorrules", globalPrompt);
                reservedPaths.add(".cursorrules");
            }

            const addToZip = (nodes: FileNode[], currentPath: string) => {
                const folderFiles: FileNode[] = [];
                const subFolders: FileNode[] = [];

                nodes.forEach((node) => {
                    if (node.type === "file") folderFiles.push(node);
                    else subFolders.push(node);
                });

                if (folderFiles.length > 0) {
                    let promptContent = "# AI Code Generation Tasks\n\n";
                    promptContent += `This file contains generation guidance for: \`${currentPath || "root"}\`\n\n`;
                    promptContent += "**Usage:** Open this file in your editor and ask your coding assistant to implement the files listed below.\n\n";
                    promptContent += "---\n\n";

                    folderFiles.forEach((file) => {
                        const relativePath = `${currentPath}${file.name}`;

                        // Preserve globally generated rules file and avoid overwriting with scaffold placeholders.
                        if (reservedPaths.has(relativePath)) {
                            return;
                        }

                        const includeRawContent = shouldWriteRealContent(relativePath, file.name);
                        const promptPath = `${currentPath}_AI_PROMPT.md`;

                        promptContent += `## File: \`${file.name}\`\n`;
                        promptContent += "**Description & Logic:**\n";
                        if (includeRawContent) {
                            promptContent += "Generated content is included directly in the ZIP.\n\n";
                        } else {
                            promptContent += `${file.content || "No specific prompt provided."}\n\n`;
                        }
                        promptContent += "---\n\n";

                        if (includeRawContent && file.content) {
                            zip.file(relativePath, file.content);
                        } else {
                            zip.file(
                                relativePath,
                                toScaffoldPlaceholder(promptPath, file.content)
                            );
                        }
                    });

                    zip.file(`${currentPath}_AI_PROMPT.md`, promptContent);
                }

                subFolders.forEach((folder) => {
                    if (!folder.children || folder.children.length === 0) {
                        zip.folder(`${currentPath}${folder.name}`);
                    } else {
                        addToZip(folder.children, `${currentPath}${folder.name}/`);
                    }
                });
            };

            addToZip(content, "");

            const blob = await zip.generateAsync({ type: "blob" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = zipFileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (error) {
            console.error("Failed to zip:", error);
            alert("Failed to generate zip file.");
        } finally {
            setIsZipping(false);
        }
    };

    if (typeof content === "string") {
        return <pre className="p-4 text-xs font-mono whitespace-pre-wrap">{content}</pre>;
    }

    return (
        <div className="flex flex-col h-full">
            <div className="flex justify-between items-center mb-4 px-2">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                    <Folder className="w-5 h-5 text-purple-500" />
                    Project Structure
                </h3>
                <div className="flex items-center gap-2">
                    <div className="flex items-center rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                        <button
                            type="button"
                            onClick={() => setExportMode("blueprint")}
                            className={`px-2.5 py-1.5 text-xs font-medium transition-colors ${
                                exportMode === "blueprint"
                                    ? "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900"
                                    : "bg-white text-gray-600 hover:bg-gray-50 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
                            }`}
                        >
                            Blueprint
                        </button>
                        <button
                            type="button"
                            onClick={() => setExportMode("scaffold")}
                            className={`px-2.5 py-1.5 text-xs font-medium transition-colors ${
                                exportMode === "scaffold"
                                    ? "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900"
                                    : "bg-white text-gray-600 hover:bg-gray-50 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
                            }`}
                        >
                            Scaffold
                        </button>
                    </div>
                    <button
                        onClick={handleDownload}
                        disabled={isZipping}
                        className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                    >
                        <Download className="w-4 h-4" />
                        {isZipping ? "Zipping..." : `Download ${exportMode === "blueprint" ? "Blueprint" : "Scaffold"} ZIP`}
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-inner">
                {content.map((node, i) => (
                    <TreeNode key={i} node={node} />
                ))}
            </div>
        </div>
    );
}
