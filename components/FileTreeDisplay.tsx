import React, { useEffect, useMemo, useState } from "react";
import { Folder, FileCode, Download, ChevronRight, ChevronDown } from "lucide-react";
import { FileNode } from "@/types";
import type { WorkspaceLanguage } from "@/lib/project-language";

interface Props {
    content: FileNode[] | string;
    projectName?: string;
    language: WorkspaceLanguage;
    title?: string;
    downloadLabel?: string;
    zipFileNameSuffix?: string;
    emptyStateLabel?: string;
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
    onSelectFile,
    language
}: {
    node: FileNode;
    depth?: number;
    currentPath?: string;
    selectedPath: string | null;
    onSelectFile: (path: string) => void;
    language: WorkspaceLanguage;
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
                className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm transition-colors ${
                    isSelected
                        ? "bg-blue-100 dark:bg-blue-900/30"
                        : "hover:bg-gray-100 dark:hover:bg-gray-800"
                }`}
                style={{ marginLeft: `${depth * 16}px` }}
                onClick={handleClick}
            >
                {isFolder ? (
                    isOpen ? <ChevronDown className="h-4 w-4 text-gray-500" /> : <ChevronRight className="h-4 w-4 text-gray-500" />
                ) : (
                    <span className="w-4" />
                )}

                {isFolder ? (
                    <Folder className="h-4 w-4 text-blue-500" />
                ) : (
                    <FileCode className="h-4 w-4 text-gray-500" />
                )}

                <span className="font-mono text-gray-700 dark:text-gray-300">{node.name}</span>
                {!isFolder && (
                    <span className="ml-auto text-xs italic text-gray-400">
                        {language === "zh" ? "含说明" : "Spec Included"}
                    </span>
                )}
            </div>

            {isFolder && isOpen && node.children && (
                <div>
                    {node.children.map((child, index) => (
                        <TreeNode
                            key={`${nodePath}-${child.name}-${index}`}
                            node={child}
                            depth={depth + 1}
                            currentPath={nodePath}
                            selectedPath={selectedPath}
                            onSelectFile={onSelectFile}
                            language={language}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

export function FileTreeDisplay({
    content,
    projectName,
    language,
    title,
    downloadLabel,
    zipFileNameSuffix,
    emptyStateLabel
}: Props) {
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
        "GENERATION_MANIFEST.json",
        "app/globals.css",
        "app/layout.tsx",
        "app/page.tsx",
        "src/app/globals.css",
        "src/app/layout.tsx",
        "src/app/page.tsx",
        "apps/web/app/globals.css",
        "apps/web/app/layout.tsx",
        "apps/web/app/page.tsx"
    ]);
    const resolvedProjectName = projectName?.trim();
    const zipFileNameBase = (resolvedProjectName && resolvedProjectName.length > 0 ? resolvedProjectName : "founder-scaffold")
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
        .replace(/\s+/g, " ")
        .replace(/[. ]+$/g, "");
    const resolvedZipSuffix = (zipFileNameSuffix || "scaffold")
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
        .replace(/\s+/g, "-")
        .replace(/^-+|-+$/g, "")
        .toLowerCase();
    const zipFileName = `${zipFileNameBase || "founder-scaffold"}-${resolvedZipSuffix || "scaffold"}.zip`;
    const scaffoldHintMaxChars = 1200;
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
        if (!readme?.content) return language;
        return detectScaffoldLanguage(readme.content);
    }, [filesForPreview, language]);

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
        const hint = (fileContent || "").slice(0, scaffoldHintMaxChars);
        if (scaffoldLanguage === "zh") {
            return `// 待生成\n// 打开 ${promptPath}，并让 AI 生成这个文件。\n\n// 内容提示：\n/*\n${hint}...\n*/`;
        }
        return `// GENERATION PENDING\n// Open ${promptPath} and ask AI to generate this file.\n\n// Content Hint:\n/*\n${hint}...\n*/`;
    };

    const shouldWriteRealContent = (path: string, fileName: string) => {
        if (ZIP_REAL_CONTENT_FILES.has(fileName) || ZIP_REAL_CONTENT_FILES.has(path)) return true;
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
                        promptContent += `这个文件包含以下目录的生成说明：\`${currentPath || "root"}\`\n\n`;
                        promptContent += "**使用方式：** 在 AI IDE 中打开这个文件，并按下面约束执行。\n\n";
                        promptContent += "## 强制执行顺序\n";
                        promptContent += "1. 先阅读 `ONE_CLICK_PROMPT.md`。\n";
                        promptContent += "2. 再按 `GENERATION_MANIFEST.json` 的 Phase 顺序执行。\n";
                        promptContent += "3. 这个文件只作为索引与约束，不作为执行顺序来源。\n\n";
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
                                ? "该文件的真实内容已直接包含在 ZIP 中。\n\n"
                                : "Generated content is included directly in the ZIP.\n\n";
                        } else {
                            promptContent += `${file.content || "No specific prompt provided."}\n\n`;
                        }
                        promptContent += "---\n\n";

                        if (includeRawContent && file.content) {
                            zip.file(relativePath, file.content);
                            zipRealFileCount += 1;
                        } else {
                            zip.file(relativePath, toScaffoldPlaceholder(promptPath, file.content));
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
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = zipFileName;
            document.body.appendChild(anchor);
            anchor.click();
            document.body.removeChild(anchor);
            URL.revokeObjectURL(url);
        } catch (error) {
            console.error("Failed to zip:", error);
            alert(language === "zh" ? "生成 ZIP 文件失败。" : "Failed to generate zip file.");
        } finally {
            setIsZipping(false);
        }
    };

    if (typeof content === "string") {
        return <pre className="whitespace-pre-wrap p-4 text-xs font-mono">{content}</pre>;
    }

    const fallbackTitle = language === "zh" ? "Scaffold 预览" : "Scaffold Preview";
    const fallbackDownloadLabel = language === "zh" ? "下载 ZIP" : "Download ZIP";
    const fallbackEmptyStateLabel = language === "zh"
        ? "这个产物里没有可预览的文件。"
        : "No previewable file in this artifact.";

    return (
        <div className="flex h-full flex-col">
            <div className="mb-4 flex items-center justify-between px-2">
                <h3 className="flex items-center gap-2 text-lg font-semibold">
                    <Folder className="h-5 w-5 text-purple-500" />
                    {title || fallbackTitle}
                </h3>
                <div className="flex items-center gap-2">
                    <button
                        onClick={handleDownload}
                        disabled={isZipping}
                        className="flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                    >
                        <Download className="h-4 w-4" />
                        {isZipping
                            ? (language === "zh" ? "正在打包..." : "Zipping...")
                            : (downloadLabel || fallbackDownloadLabel)}
                    </button>
                </div>
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-2">
                <div className="min-h-0 overflow-y-auto rounded-xl border border-gray-200 bg-white p-4 shadow-inner dark:border-gray-800 dark:bg-gray-900">
                    {content.map((node, index) => (
                        <TreeNode
                            key={`${node.name}-${index}`}
                            node={node}
                            selectedPath={selectedFilePath}
                            onSelectFile={(path) => setSelectedFilePath(path)}
                            language={language}
                        />
                    ))}
                </div>
                <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-inner dark:border-gray-800 dark:bg-gray-900">
                    <div className="truncate border-b border-gray-200 px-4 py-3 font-mono text-xs text-gray-600 dark:border-gray-800 dark:text-gray-300">
                        {selectedPreviewFile?.path || (language === "zh" ? "未选择文件" : "No file selected")}
                    </div>
                    <div className="min-h-0 flex-1 overflow-auto p-4">
                        {selectedPreviewFile ? (
                            <pre className="whitespace-pre-wrap text-xs font-mono text-gray-700 dark:text-gray-200">
                                {selectedPreviewFile.content || (language === "zh" ? "// 空文件" : "// Empty specification")}
                            </pre>
                        ) : (
                            <div className="text-sm text-gray-500 dark:text-gray-400">
                                {emptyStateLabel || fallbackEmptyStateLabel}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
