"use client";

import React, { useState } from 'react';
import JSZip from 'jszip';
import { Folder, FileCode, Download, ChevronRight, ChevronDown } from 'lucide-react';
import { FileNode } from '@/types';

interface Props {
    content: FileNode[] | string;
    globalPrompt?: string; // .cursorrules content
}

function TreeNode({ node, depth = 0 }: { node: FileNode; depth?: number }) {
    const [isOpen, setIsOpen] = useState(true);
    const isFolder = node.type === 'folder';

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

export function FileTreeDisplay({ content, globalPrompt }: Props) {
    const [isZipping, setIsZipping] = useState(false);
    const AUTO_GENERATED_FILES = new Set(["package.json", "tsconfig.json", "next.config.ts"]);

    const handleDownload = async () => {
        if (typeof content === 'string') return;
        setIsZipping(true);

        try {
            const zip = new JSZip();

            // 1. Add Global Context (.cursorrules)
            if (globalPrompt) {
                zip.file(".cursorrules", globalPrompt);
            }

            // Recursive function to build the zip
            const addToZip = (nodes: FileNode[], currentPath: string) => {
                const folderFiles: FileNode[] = [];
                const subFolders: FileNode[] = [];

                // Separate files and folders
                nodes.forEach(node => {
                    if (node.type === 'file') folderFiles.push(node);
                    else subFolders.push(node);
                });

                // 2. Generate _AI_PROMPT.md for the current folder if there are files
                if (folderFiles.length > 0) {
                    let promptContent = `# 馃 AI Code Generation Tasks\n\n`;
                    promptContent += `This file contains detailed prompts for generating the code in this directory: \`${currentPath || 'root'}\`\n\n`;
                    promptContent += `**Usage:** Open this file in your AI IDE (Cursor/Windsurf) and ask the AI to "Implement the files listed below".\n\n`;
                    promptContent += `---\n\n`;

                    folderFiles.forEach(file => {
                        promptContent += `## 馃搫 File: \`${file.name}\`\n`;
                        promptContent += `**Description & Logic:**\n`;
                        if (AUTO_GENERATED_FILES.has(file.name)) {
                            promptContent += `Auto-generated baseline config file. Content is included in the zip.\n\n`;
                        } else {
                            promptContent += `${file.content || "No specific prompt provided."}\n\n`;
                        }
                        promptContent += `---\n\n`;

                        // 3. Create placeholder file (or write real content for baseline configs)
                        if (AUTO_GENERATED_FILES.has(file.name) && file.content) {
                            zip.file(`${currentPath}${file.name}`, file.content);
                        } else {
                            zip.file(`${currentPath}${file.name}`, `// 馃殌 GENERATION PENDING\n// Open ${currentPath}_AI_PROMPT.md and ask AI to generate this file.\n\n// Content Hint:\n/*\n${file.content?.substring(0, 200)}...\n*/`);
                        }
                    });

                    zip.file(`${currentPath}_AI_PROMPT.md`, promptContent);
                }

                // 4. Recurse into subfolders
                subFolders.forEach(folder => {
                    // Create folder explicitly to ensure empty folders exist
                    if (!folder.children || folder.children.length === 0) {
                        zip.folder(`${currentPath}${folder.name}`);
                    } else {
                        addToZip(folder.children!, `${currentPath}${folder.name}/`);
                    }
                });
            };

            addToZip(content, "");

            const blob = await zip.generateAsync({ type: "blob" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "founder-blueprint.zip";
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

    if (typeof content === 'string') {
        return <pre className="p-4 text-xs font-mono whitespace-pre-wrap">{content}</pre>;
    }

    return (
        <div className="flex flex-col h-full">
            <div className="flex justify-between items-center mb-4 px-2">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                    <Folder className="w-5 h-5 text-purple-500" />
                    Project Structure
                </h3>
                <button
                    onClick={handleDownload}
                    disabled={isZipping}
                    className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                >
                    <Download className="w-4 h-4" />
                    {isZipping ? "Zipping..." : "Download Blueprint"}
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-inner">
                {content.map((node, i) => (
                    <TreeNode key={i} node={node} />
                ))}
            </div>
        </div>
    );
}
