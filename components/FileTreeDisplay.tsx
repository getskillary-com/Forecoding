"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Folder, FileCode, Download, ChevronRight, ChevronDown } from "lucide-react";
import { FileNode } from "@/types";

interface Props {
    content: FileNode[] | string;
    projectName?: string;
}

type PreviewFile = {
    path: string;
    content: string;
};

function countChineseChars(text: string) {
    return (text.match(/[\u3400-\u9fff]/g) || []).length;
}

function countLatinChars(text: string) {
    return (text.match(/[A-Za-z]/g) || []).length;
}

function detectScaffoldLanguage(text: string): "zh" | "en" {
    const source = text.trim();
    if (!source) return "en";
    const chinese = countChineseChars(source);
    const latin = countLatinChars(source);
    if (chinese >= 6) return "zh";
    if (chinese >= 2 && chinese / Math.max(1, chinese + latin) >= 0.08) return "zh";
    return "en";
}

function collectFiles(nodes: FileNode[], currentPath: string = ""): PreviewFile[] {
    const files: PreviewFile[] = [];

    nodes.forEach((node) => {
        const nodePath = currentPath ? `${currentPath}/${node.name}` : node.name;
        if (node.type === "folder") {
            if (node.children?.length) {
                files.push(...collectFiles(node.children, nodePath));
            }
            return;
        }

        files.push({
            path: nodePath,
            content: node.content || ""
        });
    });

    return files;
}

function TreeNode({
    node,
    depth = 0,
    currentPath = "",
    selectedPath,
    onSelectFile
}: {
    node: FileNode;
    depth?: number;
    currentPath?: string;
    selectedPath: string | null;
    onSelectFile: (path: string) => void;
}) {
    const [isOpen, setIsOpen] = useState(true);
    const isFolder = node.type === "folder";
    const nodePath = currentPath ? `${currentPath}/${node.name}` : node.name;
    const isSelected = !isFolder && selectedPath === nodePath;

    const handleClick = () => {
        if (isFolder) {
            setIsOpen((prev) => !prev);
            return;
        }
        onSelectFile(nodePath);
    };

    return (
        <div className="select-none">
            <div
                className={`flex items-center gap-2 py-1 px-2 rounded transition-colors cursor-pointer text-sm ${
                    isSelected
                        ? "bg-blue-100 dark:bg-blue-900/30"
                        : "hover:bg-gray-100 dark:hover:bg-gray-800"
                }`}
                style={{ marginLeft: `${depth * 16}px` }}
                onClick={handleClick}
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
                {!isFolder && <span className="text-xs text-gray-400 ml-auto italic">Spec Included</span>}
            </div>

            {isFolder && isOpen && node.children && (
                <div>
                    {node.children.map((child, i) => (
                        <TreeNode
                            key={`${nodePath}-${child.name}-${i}`}
                            node={child}
                            depth={depth + 1}
                            currentPath={nodePath}
                            selectedPath={selectedPath}
                            onSelectFile={onSelectFile}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

export function FileTreeDisplay({ content, projectName }: Props) {
    const [isZipping, setIsZipping] = useState(false);
    const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
    const ZIP_REAL_CONTENT_FILES = new Set([
        "package.json",
        "tsconfig.json",
        "next.config.ts",
        "turbo.json",
        ".env.example",
        "README.md",
        "IMPLEMENTATION_PLAN.md",
        "_AI_PROMPT.md",
        "ONE_CLICK_PROMPT.md",
        "GENERATION_MANIFEST.json"
    ]);
    const resolvedProjectName = projectName?.trim();
    const zipFileNameBase = (resolvedProjectName && resolvedProjectName.length > 0 ? resolvedProjectName : "founder-scaffold")
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
        .replace(/\s+/g, " ")
        .replace(/[. ]+$/g, "");
    const zipFileName = `${zipFileNameBase || "founder-scaffold"}-scaffold.zip`;
    const SCAFFOLD_HINT_MAX_CHARS = 1200;
    const filesForPreview = useMemo(
        () => (typeof content === "string" ? [] : collectFiles(content)),
        [content]
    );
    const selectedPreviewFile = useMemo(
        () => filesForPreview.find((file) => file.path === selectedFilePath) || null,
        [filesForPreview, selectedFilePath]
    );
    const scaffoldLanguage = useMemo(() => {
        const readme = filesForPreview.find((file) => file.path === "README.md");
        if (!readme?.content) return "en";
        return detectScaffoldLanguage(readme.content);
    }, [filesForPreview]);

    useEffect(() => {
        if (filesForPreview.length === 0) {
            setSelectedFilePath(null);
            return;
        }

        setSelectedFilePath((prev) => (
            prev && filesForPreview.some((file) => file.path === prev)
                ? prev
                : filesForPreview[0].path
        ));
    }, [filesForPreview]);

    const toScaffoldPlaceholder = (promptPath: string, fileContent?: string) => {
        const hint = (fileContent || "").slice(0, SCAFFOLD_HINT_MAX_CHARS);
        if (scaffoldLanguage === "zh") {
            return `// GENERATION PENDING\n// 打开 ${promptPath} 并让 AI 生成该文件。\n\n// Content Hint:\n/*\n${hint}...\n*/`;
        }
        return `// GENERATION PENDING\n// Open ${promptPath} and ask AI to generate this file.\n\n// Content Hint:\n/*\n${hint}...\n*/`;
    };

    const shouldWriteRealContent = (path: string, fileName: string) => {
        if (ZIP_REAL_CONTENT_FILES.has(fileName)) return true;
        if (fileName.endsWith("_AI_PROMPT.md")) return true;
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
            let zipRealFileCount = 0;
            let zipPlaceholderFileCount = 0;
            const globalPlaceholderTargets = filesForPreview
                .filter((file) => {
                    const fileName = file.path.split("/").pop() || file.path;
                    return !shouldWriteRealContent(file.path, fileName);
                })
                .map((file) => ({
                    path: file.path,
                    promptPath: file.path.includes("/")
                        ? `${file.path.slice(0, file.path.lastIndexOf("/"))}/_AI_PROMPT.md`
                        : "_AI_PROMPT.md"
                }));

            const addToZip = (nodes: FileNode[], currentPath: string) => {
                const folderFiles: FileNode[] = [];
                const subFolders: FileNode[] = [];

                nodes.forEach((node) => {
                    if (node.type === "file") folderFiles.push(node);
                    else subFolders.push(node);
                });

                if (folderFiles.length > 0) {
                    const hasExplicitPromptFile = folderFiles.some((file) => file.name === "_AI_PROMPT.md");
                    const promptOutputPath = `${currentPath}_AI_PROMPT.md`;
                    let promptContent = "";
                    if (scaffoldLanguage === "zh") {
                        promptContent += "# AI 代码生成任务\n\n";
                        promptContent += `本文件包含以下目录的生成说明：\`${currentPath || "root"}\`\n\n`;
                        promptContent += "**使用方式：** 在 AI IDE 中打开本文件，并按下列约束执行。\n\n";
                        promptContent += "## 强制执行顺序\n";
                        promptContent += "1. 先阅读 `ONE_CLICK_PROMPT.md`。\n";
                        promptContent += "2. 再按 `GENERATION_MANIFEST.json` 的 Phase 顺序执行。\n";
                        promptContent += "3. 本文件仅作索引与约束，不是执行顺序来源。\n\n";
                        promptContent += "---\n\n";
                    } else {
                        promptContent += "# AI Code Generation Tasks\n\n";
                        promptContent += `This file contains generation guidance for: \`${currentPath || "root"}\`\n\n`;
                        promptContent += "**Usage:** Open this file in your editor and ask your coding assistant to implement the files listed below.\n\n";
                        promptContent += "## Mandatory Execution Order\n";
                        promptContent += "1. Open and follow `ONE_CLICK_PROMPT.md` first.\n";
                        promptContent += "2. Then execute `GENERATION_MANIFEST.json` in Phase order only (Phase 0 -> Phase 6).\n";
                        promptContent += "3. Treat this file as index + constraints, not source of execution order.\n\n";
                        promptContent += "---\n\n";
                    }

                    folderFiles.forEach((file) => {
                        const relativePath = `${currentPath}${file.name}`;
                        const includeRawContent = shouldWriteRealContent(relativePath, file.name);
                        const promptPath = `${currentPath}_AI_PROMPT.md`;

                        promptContent += `## File: \`${file.name}\`\n`;
                        promptContent += scaffoldLanguage === "zh" ? "**说明与逻辑：**\n" : "**Description & Logic:**\n";
                        if (includeRawContent) {
                            promptContent += scaffoldLanguage === "zh"
                                ? "该文件为 ZIP 内真实内容。\n\n"
                                : "Generated content is included directly in the ZIP.\n\n";
                        } else {
                            promptContent += `${file.content || "No specific prompt provided."}\n\n`;
                        }
                        promptContent += "---\n\n";

                        if (includeRawContent && file.content) {
                            zip.file(relativePath, file.content);
                            zipRealFileCount += 1;
                        } else {
                            zip.file(
                                relativePath,
                                toScaffoldPlaceholder(promptPath, file.content)
                            );
                            zipPlaceholderFileCount += 1;
                        }
                    });

                    if (!hasExplicitPromptFile) {
                        if (!currentPath && globalPlaceholderTargets.length > 0) {
                            promptContent += scaffoldLanguage === "zh" ? "## 全量占位任务\n" : "## All Placeholder Tasks\n";
                            globalPlaceholderTargets.forEach((task) => {
                                promptContent += `- \`${task.path}\` -> \`${task.promptPath}\`\n`;
                            });
                            promptContent += "\n";
                        }
                        zip.file(promptOutputPath, promptContent);
                        zipRealFileCount += 1;
                    }
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
            console.info(
                `[zip] scaffoldExport realFiles=${zipRealFileCount} placeholderFiles=${zipPlaceholderFileCount} fileName=${zipFileName}`
            );

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
                    Scaffold Structure
                </h3>
                <div className="flex items-center gap-2">
                    <button
                        onClick={handleDownload}
                        disabled={isZipping}
                        className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                    >
                        <Download className="w-4 h-4" />
                        {isZipping ? "Zipping..." : "Download Scaffold ZIP"}
                    </button>
                </div>
            </div>

            <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="min-h-0 overflow-y-auto p-4 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-inner">
                    {content.map((node, i) => (
                        <TreeNode
                            key={`${node.name}-${i}`}
                            node={node}
                            selectedPath={selectedFilePath}
                            onSelectFile={(path) => setSelectedFilePath(path)}
                        />
                    ))}
                </div>
                <div className="min-h-0 flex flex-col bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-inner overflow-hidden">
                    <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800 text-xs font-mono text-gray-600 dark:text-gray-300 truncate">
                        {selectedPreviewFile?.path || "No file selected"}
                    </div>
                    <div className="flex-1 min-h-0 overflow-auto p-4">
                        {selectedPreviewFile ? (
                            <pre className="text-xs font-mono whitespace-pre-wrap text-gray-700 dark:text-gray-200">
                                {selectedPreviewFile.content || "// Empty specification"}
                            </pre>
                        ) : (
                            <div className="text-sm text-gray-500 dark:text-gray-400">
                                No previewable file in this scaffold.
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
