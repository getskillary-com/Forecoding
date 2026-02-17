"use client";

import { useState, useEffect, useRef, Suspense, type ReactNode } from "react";
import { Send, Sparkles, Loader2, FileCode, BrainCircuit, Activity, Layers, Check, Paperclip, X, FileText } from "lucide-react";
import { Message, EvaluationResponse, GenerationResponse, Project, Task, ProjectVersion, Attachment, FileNode } from "@/types";
import { ChatBubble } from "@/components/ChatBubble";
import { DensityProgress } from "@/components/DensityProgress";
import { FileTreeDisplay } from "@/components/FileTreeDisplay";
import { ToolStackTable } from "@/components/ToolStackTable";
import ArchitectureViewer from "@/components/ArchitectureViewer";
import { VersionSidebar } from "@/components/VersionSidebar";
import ReactMarkdown from 'react-markdown';
import { useSearchParams, useRouter } from "next/navigation";
const STRUCTURE_CONTEXT_MAX_CHARS = 12000;
const STRUCTURE_SNIPPET_MAX_CHARS = 200;

function summarizeStructureContent(content: string): string {
    const lines = content.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return "";

    const headings = lines.filter((l) => l.startsWith("#")).slice(0, 4);
    let summary = headings.length > 0 ? headings.join(" | ") : lines.slice(0, 2).join(" ");
    summary = summary.replace(/\s+/g, " ").trim();

    if (summary.length > STRUCTURE_SNIPPET_MAX_CHARS) {
        summary = summary.slice(0, STRUCTURE_SNIPPET_MAX_CHARS) + "...";
    }

    return summary;
}

function buildProjectStructureContext(tree?: FileNode[]): string | null {
    if (!tree || tree.length === 0) return null;

    const lines: string[] = [];

    const walk = (nodes: FileNode[], prefix: string) => {
        for (const node of nodes) {
            const path = prefix ? `${prefix}/${node.name}` : node.name;

            if (node.type === "folder") {
                lines.push(`- ${path}/`);
                if (node.children?.length) walk(node.children, path);
                continue;
            }

            let line = `- ${path}`;
            if (node.content) {
                const summary = summarizeStructureContent(node.content);
                if (summary) line += ` :: ${summary}`;
            }
            lines.push(line);
        }
    };

    walk(tree, "");

    let result = lines.join("\n").trim();
    if (result.length > STRUCTURE_CONTEXT_MAX_CHARS) {
        result = result.slice(0, STRUCTURE_CONTEXT_MAX_CHARS) + "\n... (truncated)";
    }

    return result || null;
}


function WizardContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const projectId = searchParams.get("projectId");
    const versionId = searchParams.get("versionId");
    const SIDEBAR_MIN = 320;
    const SIDEBAR_MAX = 720;
    const MAIN_MIN = 420;

    // --- State ---
    const [project, setProject] = useState<Project | null>(null);
    const [currentVersion, setCurrentVersion] = useState<ProjectVersion | null>(null);
    const [isHydrating, setIsHydrating] = useState(false);
    const [loadedVersionId, setLoadedVersionId] = useState<string | null>(null);
    const [hasUserEdited, setHasUserEdited] = useState(false);

    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState("");
    const [isLoading, setIsLoading] = useState(false);

    // Core Domain State
    const [evaluation, setEvaluation] = useState<EvaluationResponse | null>(null);
    const [generation, setGeneration] = useState<GenerationResponse | null>(null);
    const [tasks, setTasks] = useState<Task[]>([]);

    // UI State
    const [isGenerating, setIsGenerating] = useState(false);
    const [generateError, setGenerateError] = useState<string | null>(null);
    const [sidebarWidth, setSidebarWidth] = useState(420);
    const isResizingRef = useRef(false);

    // Chat Attachments
    const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [currentDiagram, setCurrentDiagram] = useState("graph TD\nStart[Waiting for input...]");

    const [activeTab, setActiveTab] = useState<'prd' | 'architecture' | 'roadmap' | 'files' | 'stack'>('architecture');
    const [isCopied, setIsCopied] = useState(false);

    // Batch Review State
    const [isReviewing, setIsReviewing] = useState(false);
    const [reviewProgress, setReviewProgress] = useState<string>("");
    const [reviewReport, setReviewReport] = useState<string | null>(null);

    const messagesEndRef = useRef<HTMLDivElement>(null);

    // --- Effects ---

    // 1. Load Project & Version Data
    useEffect(() => {
        if (typeof window !== 'undefined' && projectId) {
            setIsHydrating(true);
            setLoadedVersionId(null);
            setHasUserEdited(false);
            const saved = localStorage.getItem("fl_projects_v2");
            if (saved) {
                try {
                    const projects: Project[] = JSON.parse(saved);
                    const foundProject = projects.find(p => p.id === projectId);
                    if (foundProject) {
                        setProject(foundProject);
                        const latestVersion = foundProject.versions[foundProject.versions.length - 1];
                        if (latestVersion) {
                            setCurrentVersion(latestVersion);
                            setLoadedVersionId(latestVersion.id);
                            // Hydrate State
                            const data = latestVersion.data;
                            setMessages(data.messages);
                            setEvaluation(data.evaluation);
                            setGeneration(data.generation);
                            setCurrentDiagram(data.currentDiagram);
                            setTasks(data.tasks);

                            // Auto-set tab
                            if (data.generation) setActiveTab('files');

                            if (versionId && versionId !== latestVersion.id) {
                                router.replace(`/wizard?projectId=${projectId}&versionId=${latestVersion.id}`);
                            }
                        }
                    }
                } catch (e) {
                    console.error("Failed to load project", e);
                }
            }
            // Allow state to settle before enabling autosave
            setTimeout(() => setIsHydrating(false), 0);
        }
    }, [projectId, versionId, router]);

    // 1b. Load persisted sidebar width
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const saved = localStorage.getItem("fl_sidebar_width");
        if (saved) {
            const parsed = Number(saved);
            if (!Number.isNaN(parsed)) {
                const maxAllowed = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, window.innerWidth - MAIN_MIN));
                const clamped = Math.min(maxAllowed, Math.max(SIDEBAR_MIN, parsed));
                setSidebarWidth(clamped);
            }
        }
    }, [SIDEBAR_MIN, SIDEBAR_MAX, MAIN_MIN]);

    // 1c. Persist sidebar width
    useEffect(() => {
        if (typeof window === 'undefined') return;
        localStorage.setItem("fl_sidebar_width", String(sidebarWidth));
    }, [sidebarWidth]);

    // 1d. Sidebar resize handlers
    useEffect(() => {
        if (typeof window === 'undefined') return;

        const clampWidth = (value: number) => {
            const maxAllowed = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, window.innerWidth - MAIN_MIN));
            return Math.min(maxAllowed, Math.max(SIDEBAR_MIN, value));
        };

        const onMove = (e: PointerEvent) => {
            if (!isResizingRef.current) return;
            setSidebarWidth(clampWidth(e.clientX));
        };

        const onUp = () => {
            if (!isResizingRef.current) return;
            isResizingRef.current = false;
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
        };

        const onResize = () => {
            setSidebarWidth(prev => clampWidth(prev));
        };

        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("resize", onResize);

        return () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            window.removeEventListener("resize", onResize);
        };
    }, [SIDEBAR_MIN, SIDEBAR_MAX, MAIN_MIN]);

    // 2. Auto-save current version state
    useEffect(() => {
        if (isHydrating) return;
        if (!hasUserEdited) return;
        if (!project || !currentVersion) return;
        if (!loadedVersionId) return;
        if (projectId !== project.id) return;
        if (loadedVersionId !== currentVersion.id) return;

        // Debounce save or just save on change?
        // For simplicity, we save on every significant state change logic handle
        // But here we can sync state back to the object for persistence

        const updatedVersion: ProjectVersion = {
            ...currentVersion,
            data: {
                messages,
                evaluation,
                generation,
                currentDiagram,
                tasks
            }
        };

        const updatedProject: Project = {
            ...project,
            updatedAt: Date.now(),
            versions: project.versions.map(v => v.id === currentVersion.id ? updatedVersion : v)
        };

        // Persist
        const saved = localStorage.getItem("fl_projects_v2");
        if (saved) {
            try {
                const projects: Project[] = JSON.parse(saved);
                const newProjects = projects.map(p => p.id === project.id ? updatedProject : p);
                localStorage.setItem("fl_projects_v2", JSON.stringify(newProjects));
            } catch (e) {
                console.error("Failed to persist project", e);
            }
        }

        // Update local state references to avoid stale closures if needed, 
        // but we rely on the effect dependencies to trigger updates.
        // Ideally we shouldn't setProject here to act as a verified save, 
        // but we DO need to update the parent 'project' state if we want the sidebar to reflect changes immediately.
        // However, infinite loop risk if we include project in deps.
        // So we only update localStorage here.

    }, [messages, evaluation, generation, currentDiagram, tasks, project, currentVersion, projectId, isHydrating, loadedVersionId, hasUserEdited]);

    // 4. Scroll to bottom
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);


    // --- Handlers ---

    // --- Interaction Handlers ---

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            const files = Array.from(e.target.files);

            files.forEach(file => {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const content = e.target?.result as string;
                    // Simple mime type detection
                    const type = file.type.startsWith('image/') ? 'image' : file.type === 'application/pdf' ? 'pdf' : 'text';

                    setPendingAttachments(prev => [...prev, {
                        name: file.name,
                        type,
                        mimeType: file.type,
                        content
                    }]);
                };

                if (file.type.startsWith('image/') || file.type === 'application/pdf') {
                    reader.readAsDataURL(file);
                } else {
                    reader.readAsText(file);
                }
            });

            // Reset input so same file can be selected again if needed
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };


    const removeAttachment = (index: number) => {
        setPendingAttachments(prev => prev.filter((_, i) => i !== index));
    };

    const handlePaste = (e: React.ClipboardEvent) => {
        const items = e.clipboardData?.items;
        if (!items) return;

        const files: File[] = [];
        Array.from(items).forEach(item => {
            if (item.kind === 'file') {
                const file = item.getAsFile();
                if (file) files.push(file);
            }
        });

        if (files.length > 0) {
            e.preventDefault(); // Prevent pasting the file name/object into text area

            files.forEach(file => {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const content = e.target?.result as string;
                    const type = file.type.startsWith('image/') ? 'image' : file.type === 'application/pdf' ? 'pdf' : 'text';

                    setPendingAttachments(prev => [...prev, {
                        name: file.name || `Pasted Image ${new Date().toISOString()}`,
                        type,
                        mimeType: file.type,
                        content
                    }]);
                };

                if (file.type.startsWith('image/') || file.type === 'application/pdf') {
                    reader.readAsDataURL(file);
                } else {
                    reader.readAsText(file);
                }
            });
        }
    };

    const handleSend = async (overrideInput?: string) => {
        const textToSend = overrideInput || input;

        // Allow sending if text OR attachments exist
        if ((!textToSend.trim() && pendingAttachments.length === 0) || isLoading) return;

        const attachmentsToSend = [...pendingAttachments];

        // Optimistic UI Update
        setHasUserEdited(true);
        const newUserMessage: Message = {
            role: "user",
            content: textToSend,
            attachments: attachmentsToSend
        };

        const newMessages = [...messages, newUserMessage];
        const assistantPlaceholder: Message = { role: "assistant", content: "" };
        setMessages([...newMessages, assistantPlaceholder]);
        setInput("");
        setPendingAttachments([]);
        setIsLoading(true);

        try {
            // Include project structure context for the chat model.

            // Call API with full structured messages
            const structureContext = buildProjectStructureContext(generation?.projectTree);

            const res = await fetch("/api/evaluate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ messages: newMessages, context: structureContext }),
            });



            if (!res.ok || !res.body) throw new Error("Failed to evaluate");

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            let currentEval: EvaluationResponse = {
                density_score: evaluation?.density_score || 0,
                is_ready: false,
                current_diagram: currentDiagram,
                analysis: evaluation?.analysis || { clarified: [], missing: [] },
                next_step: { reasoning: "", question: null }
            };

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                buffer += chunk;

                // --- Stream Parsing (Identical logic) ---
                const diagramMatch = buffer.match(/<diagram>([\s\S]*?)<\/diagram>/);
                if (diagramMatch && diagramMatch[1]) {
                    let rawContent = diagramMatch[1].trim();
                    let code = rawContent;

                    // Try to extract mermaid code block if explicitly present
                    const codeBlockMatch = rawContent.match(/```mermaid([\s\S]*?)```/);
                    if (codeBlockMatch && codeBlockMatch[1]) {
                        code = codeBlockMatch[1].trim();
                    } else {
                        // Fallback: cleanup potential raw code artifacts just in case
                        code = code.replace(/```mermaid\n?|```\n?/g, "").replace(/```$/g, "").trim();
                    }

                    if (code && code !== currentEval.current_diagram) {
                        currentEval.current_diagram = code;
                        setCurrentDiagram(code);
                    }
                }

                const questionMatch = buffer.match(/<question>([\s\S]*?)(?:<\/question>|$)/);
                if (questionMatch && questionMatch[1]) {
                    const q = questionMatch[1].trim();
                    if (q) {
                        currentEval.next_step.question = q;
                        setMessages(prev => {
                            const updated = [...prev];
                            updated[updated.length - 1].content = q;
                            return updated;
                        });
                    }
                }

                const densityMatch = buffer.match(/<density>\s*(\d+)\s*<\/density>/);
                if (densityMatch) currentEval.density_score = parseInt(densityMatch[1]);

                const readyMatch = buffer.match(/<is_ready>\s*(true|false)\s*<\/is_ready>/);
                if (readyMatch) currentEval.is_ready = readyMatch[1] === 'true';

                const clarifiedMatch = buffer.match(/<analysis_clarified>([\s\S]*?)<\/analysis_clarified>/);
                if (clarifiedMatch) {
                    currentEval.analysis.clarified = clarifiedMatch[1].split('\n').map(l => l.trim().replace(/^- /, '')).filter(l => l);
                }

                const missingMatch = buffer.match(/<analysis_missing>([\s\S]*?)<\/analysis_missing>/);
                if (missingMatch) {
                    currentEval.analysis.missing = missingMatch[1].split('\n').map(l => l.trim().replace(/^- /, '')).filter(l => l);
                }

                // Options
                const optionsMatch = buffer.match(/<options>([\s\S]*?)<\/options>/);
                if (optionsMatch) {
                    const options = optionsMatch[1].split('\n')
                        .filter(l => l.includes('::'))
                        .map(l => {
                            const [label, val] = l.split('::');
                            return { label: label.trim(), value: val.trim() };
                        });
                    setMessages(prev => {
                        const updated = [...prev];
                        updated[updated.length - 1].options = options;
                        return updated;
                    });
                }

                setEvaluation({ ...currentEval });
            }

        } catch (error) {
            console.error(error);
            setMessages(prev => [...prev.slice(0, -1), { role: "assistant", content: "Error: " + String(error) }]);
        } finally {
            setIsLoading(false);
        }
    };

    const handleOptionClick = (value: string) => handleSend(value);

    const handleResizeStart = (e: React.PointerEvent) => {
        e.preventDefault();
        isResizingRef.current = true;
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
    };

    // --- Generation Handler ---
    const handleGenerate = async () => {
        setIsGenerating(true);
        setGenerateError(null);
        setHasUserEdited(true);
        try {
            const historyText = messages.map(m => `${m.role}: ${m.content}`).join("\n") +
                `\n\nFinal Analysis: ${JSON.stringify(evaluation?.analysis)}`;

            const res = await fetch("/api/generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    summary: historyText,
                    diagram: currentDiagram,
                    // If this version has a generation already (or base version had one), we can pass it?
                    // Actually, for v2, `generation` state was initialized from base. That is our "existingProjectTree".
                    currentProjectTree: generation?.projectTree
                }),
            });

            if (!res.ok) throw new Error("Failed to generate");
            const data: GenerationResponse = await res.json();
            setGeneration(data);

            // Auto switch tab
            setActiveTab('files');

            // Mock Task Generation
            setTasks([
                { id: '1', title: 'Setup Project Structure', status: 'pending', description: 'Initialize codebase.', source: 'blueprint' },
                { id: '2', title: 'Implement Core Features', status: 'pending', description: 'Based on Blueprint.', source: 'blueprint' },
            ]);

        } catch (error) {
            console.error(error);
            setGenerateError("Blueprint generation failed.");
        } finally {
            setIsGenerating(false);
        }
    };

    // --- Deep Review Handler ---
    const handleDeepReview = async () => {
        if (!generation?.projectTree) return;

        setIsReviewing(true);
        setReviewProgress("Initializing Deep Scan...");
        setReviewReport(null);

        try {
            const response = await fetch("/api/batch-analyze", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    projectTree: generation.projectTree,
                    goal: "Comprehensive Codebase Review. Identify potential bugs, security issues, performance bottlenecks, and architectural inconsistencies."
                })
            });

            if (!response.body) throw new Error("No response body");

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n\n");
                buffer = lines.pop() || "";

                for (const line of lines) {
                    if (line.startsWith("event: progress")) {
                        const data = JSON.parse(line.replace("event: progress\ndata: ", ""));
                        setReviewProgress(data);
                    } else if (line.startsWith("event: report")) {
                        const data = JSON.parse(line.replace("event: report\ndata: ", ""));
                        setReviewReport(data);
                        setIsReviewing(false);
                    } else if (line.startsWith("event: error")) {
                        const err = JSON.parse(line.replace("event: error\ndata: ", ""));
                        console.error(err);
                        setReviewProgress("Error: " + err);
                        setIsReviewing(false);
                    }
                }
            }
        } catch (e) {
            console.error(e);
            setReviewProgress("Failed to run deep review.");
            setIsReviewing(false);
        }
    };

    if (!project || !currentVersion) return <div className="flex h-screen items-center justify-center">Loading Workspace...</div>;

    return (
        <div className="flex h-screen w-full bg-gray-50 dark:bg-black overflow-hidden font-sans text-gray-900 dark:text-gray-100">
            {/* Project Sidebar + Chat (Left) */}
            <VersionSidebar project={project} width={sidebarWidth}>
                <div className="flex flex-col h-full min-h-0">
                    <div className="flex-1 min-h-0">
                        <div className="h-full flex flex-col bg-white dark:bg-gray-900/50 shadow-sm z-10 relative" onPaste={handlePaste}>
                            {/* Header */}
                            <div className="p-4 border-b border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50 backdrop-blur-sm flex justify-between items-center">
                                <span className="font-semibold text-sm text-gray-500 uppercase tracking-wider">
                                    {project.name} Workspace
                                </span>
                                {evaluation && <DensityProgress score={evaluation.density_score} />}
                            </div>

                            {/* Chat Area */}
                            <div className="flex-1 overflow-y-auto p-4 space-y-6 scrollbar-hide">
                                {messages.map((msg, idx) => (
                                    <ChatBubble key={idx} message={msg} onOptionClick={handleOptionClick} />
                                ))}

                                {isLoading && (
                                    <div className="flex justify-start animate-pulse">
                                        <div className="bg-gray-100 dark:bg-gray-800 px-4 py-2 rounded-xl rounded-tl-none text-sm text-gray-500">
                                            Thinking...
                                        </div>
                                    </div>
                                )}

                                <div ref={messagesEndRef} />
                            </div>

                            {/* Input Area */}
                            <div className="p-4 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800">
                                {evaluation?.is_ready ? (
                                    <div className="flex flex-col gap-2">
                                        {generation ? (
                                            <>
                                                <div className="w-full flex items-center justify-center gap-2 px-6 py-4 bg-gray-200 dark:bg-gray-800 text-gray-500 dark:text-gray-400 rounded-xl font-bold cursor-default">
                                                    <Check className="w-5 h-5" />
                                                    Blueprint Generated
                                                </div>
                                                <p className="text-xs text-center text-green-600 dark:text-green-400 font-medium">Blueprint generated successfully! Check the Codebase tab.</p>
                                            </>
                                        ) : (
                                            <>
                                                <button
                                                    onClick={handleGenerate}
                                                    disabled={isGenerating}
                                                    className="w-full flex items-center justify-center gap-2 px-6 py-4 bg-green-600 hover:bg-green-700 text-white rounded-xl font-bold shadow-lg transition-all active:scale-95"
                                                >
                                                    {isGenerating ? <Loader2 className="animate-spin" /> : <Sparkles className="w-5 h-5" />}
                                                    {isGenerating ? "Architecting Solution..." : "Generate Blueprint"}
                                                </button>
                                                {generateError && (
                                                    <div className="text-xs text-red-500 text-center">{generateError}</div>
                                                )}
                                                <p className="text-xs text-center text-gray-500">Ready to build or update blueprint</p>
                                            </>
                                        )}
                                    </div>
                                ) : (
                                    <div className="flex flex-col gap-2">
                                        {/* Pending Attachments Preview */}
                                        {pendingAttachments.length > 0 && (
                                            <div className="px-1 flex gap-2 overflow-x-auto pb-2">
                                                {pendingAttachments.map((att, idx) => (
                                                    att.type === 'image' ? (
                                                        <div key={idx} className="relative group shrink-0">
                                                            <div className="w-20 h-20 rounded-xl overflow-hidden border-2 border-blue-200 dark:border-blue-800 shadow-sm">
                                                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                                                <img src={att.content} alt={att.name} className="w-full h-full object-cover" />
                                                            </div>
                                                            <button
                                                                onClick={() => removeAttachment(idx)}
                                                                className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
                                                            >
                                                                <X className="w-3 h-3" />
                                                            </button>
                                                            <span className="absolute bottom-0 inset-x-0 bg-black/60 text-white text-[10px] text-center truncate px-1 py-0.5 rounded-b-xl">{att.name}</span>
                                                        </div>
                                                    ) : (
                                                        <div key={idx} className="relative group bg-gray-100 dark:bg-gray-800 rounded-xl p-2 pr-8 flex items-center gap-2 border border-gray-200 dark:border-gray-700 shrink-0">
                                                            <FileText className="w-5 h-5 text-gray-500" />
                                                            <span className="text-xs text-gray-600 dark:text-gray-300 max-w-[100px] truncate" title={att.name}>{att.name}</span>
                                                            <button
                                                                onClick={() => removeAttachment(idx)}
                                                                className="absolute top-1 right-1 p-1 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-full transition-colors"
                                                            >
                                                                <X className="w-3 h-3 text-gray-500" />
                                                            </button>
                                                        </div>
                                                    )
                                                ))}
                                            </div>
                                        )}

                                        <div className="relative flex items-end gap-2 bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-2 focus-within:ring-2 focus-within:ring-blue-500 transition-all">
                                            <input
                                                type="file"
                                                multiple
                                                ref={fileInputRef}
                                                className="hidden"
                                                onChange={handleFileSelect}
                                                accept="image/*,application/pdf,text/*,.txt,.md,.json,.ts,.js"
                                            />
                                            <button
                                                onClick={() => fileInputRef.current?.click()}
                                                className="p-2 text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors mb-1"
                                                title="Attach files"
                                            >
                                                <Paperclip className="w-5 h-5" />
                                            </button>

                                            <textarea
                                                value={input}
                                                onChange={(e) => {
                                                    setInput(e.target.value);
                                                    e.target.style.height = 'auto';
                                                    e.target.style.height = Math.min(e.target.scrollHeight, 150) + 'px';
                                                }}
                                                onKeyDown={(e) => {
                                                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
                                                }}
                                                onPaste={handlePaste}
                                                placeholder={`Describe requirements for ${project.name}...`}
                                                disabled={isLoading || isGenerating}
                                                rows={1}
                                                className="flex-1 p-2 bg-transparent border-none focus:ring-0 focus:outline-none resize-none overflow-hidden min-h-[40px] max-h-[150px]"
                                            />

                                            <button
                                                onClick={() => handleSend()}
                                                disabled={(!input.trim() && pendingAttachments.length === 0) || isLoading || isGenerating}
                                                className="p-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:hover:bg-blue-600 text-white rounded-lg transition-colors mb-1 shadow-sm"
                                            >
                                                {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </VersionSidebar>

            <div
                onPointerDown={handleResizeStart}
                className="w-1.5 flex-shrink-0 cursor-col-resize bg-transparent hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors"
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize chat panel"
                style={{ touchAction: "none" }}
            />

            {/* Studio Panel (Right) - v2 Layout */}
            <main className="flex-1 min-w-0 flex flex-col h-full bg-gray-100 dark:bg-gray-950 p-4 md:p-6 overflow-hidden relative">
                {/* Tabs */}
                <div className="flex space-x-1 mb-4 border-b border-gray-200 dark:border-gray-800 pb-1 overflow-x-auto flex-shrink-0">
                    <TabButton
                        active={activeTab === 'architecture'}
                        onClick={() => setActiveTab('architecture')}
                        icon={<BrainCircuit className="w-4 h-4" />}
                        label="Architecture"
                    />
                    <TabButton
                        active={activeTab === 'prd'}
                        onClick={() => setActiveTab('prd')}
                        icon={<Activity className="w-4 h-4" />}
                        label="Smart PRD"
                    />
                    <TabButton
                        active={activeTab === 'files'}
                        onClick={() => setActiveTab('files')}
                        icon={<FileCode className="w-4 h-4" />}
                        label="Codebase"
                        disabled={!generation}
                    />
                    <TabButton
                        active={activeTab === 'stack'}
                        onClick={() => setActiveTab('stack')}
                        icon={<Layers className="w-4 h-4" />}
                        label="Tech Stack"
                        disabled={!generation}
                    />
                </div>

                {/* Content Area */}
                <div className="flex-1 min-h-0 bg-white dark:bg-gray-900/50 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden relative">

                    {/* Architecture Tab */}
                    {activeTab === 'architecture' && (
                        <div className="absolute inset-0 p-4 flex flex-col">
                            <div className="mb-2 flex justify-between items-center text-xs text-gray-500 uppercase font-semibold tracking-wider">
                                <span>Live System Diagram</span>
                                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> Syncing</span>
                            </div>
                            <div className="flex-1 border-2 border-dashed border-gray-100 dark:border-gray-800 rounded-xl overflow-hidden relative bg-gray-50/50 dark:bg-black/20">
                                <ArchitectureViewer code={currentDiagram} />
                            </div>
                        </div>
                    )}

                    {/* PRD Tab */}
                    {activeTab === 'prd' && (
                        <div className="absolute inset-0 p-6 overflow-y-auto custom-scrollbar">
                            <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                                <Activity className="w-5 h-5 text-blue-500" />
                                Feature Analysis
                            </h3>

                            <div className="grid gap-6">
                                <div className="space-y-3">
                                    <h4 className="text-sm font-semibold text-green-600 dark:text-green-400 uppercase tracking-wider">Confirmed Requirements</h4>
                                    {evaluation?.analysis.clarified.length ? (
                                        <ul className="space-y-2">
                                            {evaluation.analysis.clarified.map((item, i) => (
                                                <li key={i} className="flex gap-2 text-sm text-gray-700 dark:text-gray-300 p-3 bg-green-50 dark:bg-green-900/10 rounded-lg border border-green-100 dark:border-green-900/20">
                                                    <span className="text-green-500">?</span>
                                                    {item}
                                                </li>
                                            ))}
                                        </ul>
                                    ) : (
                                        <p className="text-sm text-gray-400 italic">Waiting for details...</p>
                                    )}
                                </div>

                                <div className="space-y-3">
                                    <h4 className="text-sm font-semibold text-amber-500 dark:text-amber-400 uppercase tracking-wider">Pending Questions</h4>
                                    {evaluation?.analysis.missing.length ? (
                                        <ul className="space-y-2">
                                            {evaluation.analysis.missing.map((item, i) => (
                                                <li key={i} className="flex gap-2 text-sm text-gray-700 dark:text-gray-300 p-3 bg-amber-50 dark:bg-amber-900/10 rounded-lg border border-amber-100 dark:border-amber-900/20">
                                                    <span className="text-amber-500">?</span>
                                                    {item}
                                                </li>
                                            ))}
                                        </ul>
                                    ) : (
                                        <p className="text-sm text-gray-400 italic">No missing info detected.</p>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Codebase Tab */}
                    {activeTab === 'files' && generation && (
                        <div className="absolute inset-0 overflow-hidden">
                            <div className="grid grid-cols-2 h-full divide-x divide-gray-200 dark:divide-gray-800">
                                {/* Left: AI Prompt */}
                                <div className="flex flex-col h-full bg-blue-50/30 dark:bg-blue-900/5 min-h-0">
                                    <div className="p-4 border-b border-gray-200 dark:border-gray-800 flex justify-between items-center bg-blue-50 dark:bg-blue-900/20 shrink-0">
                                        <h4 className="font-bold text-sm text-blue-800 dark:text-blue-200 flex items-center gap-2">
                                            <Sparkles className="w-4 h-4" /> Startup Prompt
                                        </h4>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={handleDeepReview}
                                                disabled={isReviewing}
                                                className="text-xs bg-indigo-100 hover:bg-indigo-200 text-indigo-700 px-3 py-1.5 rounded-lg transition-colors font-medium border border-indigo-200 dark:border-indigo-800 flex items-center gap-1"
                                                title="Run a comprehensive analysis of the entire codebase"
                                            >
                                                {isReviewing ? <Loader2 className="w-3 h-3 animate-spin" /> : <BrainCircuit className="w-3 h-3" />}
                                                Deep Review
                                            </button>
                                            <button
                                                onClick={() => {
                                                    navigator.clipboard.writeText(generation.cursorPrompt);
                                                    setIsCopied(true);
                                                    setTimeout(() => setIsCopied(false), 2000);
                                                }}
                                                className="text-xs bg-blue-100 hover:bg-blue-200 text-blue-700 px-3 py-1.5 rounded-lg transition-colors font-medium border border-blue-200 dark:border-blue-800 flex items-center gap-1"
                                            >
                                                {isCopied ? (
                                                    <>
                                                        <Check className="w-3 h-3" />
                                                        Copied!
                                                    </>
                                                ) : (
                                                    <>
                                                        <FileCode className="w-3 h-3" />
                                                        Copy Prompt
                                                    </>
                                                )}
                                            </button>
                                        </div>
                                    </div>
                                    <div className="flex-1 p-4 overflow-y-auto min-h-0">
                                        <pre className="text-xs font-mono bg-white dark:bg-gray-900 p-4 rounded-xl border border-blue-100 dark:border-blue-900/30 whitespace-pre-wrap text-gray-600 dark:text-gray-300 h-full overflow-y-auto">
                                            {generation.cursorPrompt}
                                        </pre>
                                    </div>
                                </div>

                                {/* Right: File Tree */}
                                <div className="flex flex-col h-full bg-white dark:bg-gray-900/50">
                                    <div className="p-4 border-b border-gray-200 dark:border-gray-800 flex justify-between items-center shrink-0">
                                        <h4 className="font-bold text-sm text-gray-700 dark:text-gray-200 flex items-center gap-2">
                                            <FileCode className="w-4 h-4" /> Project Blueprint
                                        </h4>
                                    </div>
                                    <div className="flex-1 p-4 overflow-y-auto min-h-0">
                                        <FileTreeDisplay content={generation.projectTree} globalPrompt={generation.cursorPrompt} />
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Stack Tab */}
                    {activeTab === 'stack' && generation && (
                        <div className="absolute inset-0 p-6 overflow-y-auto">
                            <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                                <Layers className="w-5 h-5 text-orange-500" />
                                Technology Stack
                            </h3>
                            <ToolStackTable content={generation.toolStack} />
                        </div>
                    )}
                </div>

                {isReviewing && (
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-20">
                        <div className="bg-white dark:bg-gray-900 rounded-xl p-6 w-full max-w-md text-center border border-gray-200 dark:border-gray-800 shadow-lg">
                            <Loader2 className="w-6 h-6 animate-spin mx-auto text-indigo-500" />
                            <div className="mt-3 text-sm text-gray-600 dark:text-gray-300">{reviewProgress || "Running deep review..."}</div>
                        </div>
                    </div>
                )}

                {reviewReport && (
                    <div className="absolute inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-30">
                        <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-3xl max-h-[80vh] flex flex-col border border-gray-200 dark:border-gray-800 shadow-xl overflow-hidden">
                            <div className="p-4 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
                                <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Deep Review Report</h4>
                                <button
                                    onClick={() => setReviewReport(null)}
                                    className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300"
                                >
                                    Close
                                </button>
                            </div>
                            <div className="p-4 overflow-y-auto">
                                <article className="prose prose-sm dark:prose-invert">
                                    <ReactMarkdown>{reviewReport || ""}</ReactMarkdown>
                                </article>
                            </div>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}

type TabButtonProps = {
    active: boolean;
    onClick: () => void;
    icon: ReactNode;
    label: string;
    disabled?: boolean;
};

function TabButton({ active, onClick, icon, label, disabled }: TabButtonProps) {
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${active
                ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm border border-gray-200 dark:border-gray-700'
                : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800/60'} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
            {icon}
            <span>{label}</span>
        </button>
    );
}

export default function WizardPage() {
    return (
        <Suspense fallback={<div className="flex h-screen items-center justify-center">Loading...</div>}>
            <WizardContent />
        </Suspense>
    );
}
