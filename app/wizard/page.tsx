"use client";

import { useState, useEffect, useRef, Suspense, type ReactNode } from "react";
import { Send, Sparkles, Loader2, FileCode, BrainCircuit, Activity, Layers, Check, Paperclip, X, FileText, Square } from "lucide-react";
import {
    Message,
    EvaluationResponse,
    GenerationResponse,
    Project,
    Task,
    ProjectVersion,
    Attachment,
    FileNode
} from "@/types";
import { ChatBubble } from "@/components/ChatBubble";
import { DensityProgress } from "@/components/DensityProgress";
import dynamic from "next/dynamic";
const ArchitectureViewer = dynamic(() => import("@/components/ArchitectureViewer"), {
    ssr: false,
    loading: () => (
        <div className="p-4 text-sm text-gray-500 dark:text-gray-400">
            Loading architecture diagram...
        </div>
    )
});
const FileTreeDisplay = dynamic(() => import("@/components/FileTreeDisplay").then((m) => m.FileTreeDisplay), {
    ssr: false,
    loading: () => (
        <div className="p-4 text-sm text-gray-500 dark:text-gray-400">
            Loading file tree...
        </div>
    )
});
const ToolStackTable = dynamic(() => import("@/components/ToolStackTable").then((m) => m.ToolStackTable), {
    ssr: false,
    loading: () => (
        <div className="p-4 text-sm text-gray-500 dark:text-gray-400">
            Loading tech stack...
        </div>
    )
});
import { VersionSidebar } from "@/components/VersionSidebar";
import { UserCenter } from "@/components/UserCenter";
import { BrandLogo } from "@/components/BrandLogo";
import ReactMarkdown from 'react-markdown';
import { useSearchParams, useRouter } from "next/navigation";
import {
    getCachedProjectSnapshot,
    readProjectsFromLocalStorage,
    writeProjectsToLocalStorage
} from "@/lib/workspace-cache";
const STRUCTURE_CONTEXT_MAX_CHARS = 12000;
const STRUCTURE_SNIPPET_MAX_CHARS = 200;
const MESSAGE_WINDOW_SIZE = 60;
const MESSAGE_WINDOW_STEP = 40;
const EVALUATE_MAX_HISTORY_MESSAGES = 24;
const EVALUATE_MAX_MESSAGE_CONTENT_CHARS = 8000;
const EVALUATE_MAX_TEXT_ATTACHMENT_CHARS = 20000;
const EVALUATE_MAX_BINARY_ATTACHMENT_CHARS = 750000;
const EVALUATE_MAX_RECENT_BINARY_ATTACHMENTS = 2;
const EVALUATE_MAX_REQUEST_CHARS = 1200000;
const EVALUATE_COMPACT_HISTORY_MESSAGES = 10;
const EVALUATE_COMPACT_MESSAGE_CONTENT_CHARS = 2400;
const EVALUATE_COMPACT_TEXT_ATTACHMENT_CHARS = 6000;
const EVALUATE_COMPACT_CONTEXT_CHARS = 4000;
const EVALUATE_RETRYABLE_STATUS = new Set([429, 502, 503, 504, 524]);

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

function yieldToBrowser(): Promise<void> {
    return new Promise((resolve) => {
        if (typeof window === "undefined") {
            resolve();
            return;
        }
        requestAnimationFrame(() => resolve());
    });
}

function parseOptionsBlock(raw: string) {
    return raw
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => line.replace(/^[-*]\s*/, ""))
        .map((line) => line.replace(/^["']|["']$/g, ""))
        .map((line) => {
            const [rawLabel, ...rest] = line.split("::");
            const label = (rawLabel || "").trim();
            const valueRaw = rest.join("::").trim();
            const value = valueRaw || label;
            if (!label) return null;
            return { label, value };
        })
        .filter((item): item is { label: string; value: string } => Boolean(item));
}

type CheckoutQuote = {
    unitAmountCents: number;
    currency: string;
    displayAmount: string;
    complexityScore: number;
    complexityTier: "simple" | "standard" | "advanced" | "professional" | "enterprise";
    factors?: string[];
};

type EvaluateMessageBuildOptions = {
    historySize?: number;
    maxMessageContentChars?: number;
    maxTextAttachmentChars?: number;
    maxBinaryAttachmentChars?: number;
    maxRecentBinaryAttachments?: number;
    allowBinaryAttachments?: boolean;
};

function clipText(text: string, maxChars: number) {
    if (text.length <= maxChars) return text;
    return text.slice(0, maxChars) + "\n... [truncated]";
}

function buildAttachmentPlaceholder(attachment: Attachment, reason: string): Attachment {
    return {
        type: "text",
        mimeType: "text/plain",
        name: attachment.name,
        content: `[Attachment omitted: ${reason}. File: ${attachment.name} (${attachment.mimeType})]`
    };
}

function buildEvaluateMessages(messages: Message[], options: EvaluateMessageBuildOptions = {}) {
    const historySize = options.historySize ?? EVALUATE_MAX_HISTORY_MESSAGES;
    const maxMessageContentChars = options.maxMessageContentChars ?? EVALUATE_MAX_MESSAGE_CONTENT_CHARS;
    const maxTextAttachmentChars = options.maxTextAttachmentChars ?? EVALUATE_MAX_TEXT_ATTACHMENT_CHARS;
    const maxBinaryAttachmentChars = options.maxBinaryAttachmentChars ?? EVALUATE_MAX_BINARY_ATTACHMENT_CHARS;
    const maxRecentBinaryAttachments = options.maxRecentBinaryAttachments ?? EVALUATE_MAX_RECENT_BINARY_ATTACHMENTS;
    const allowBinaryAttachments = options.allowBinaryAttachments ?? true;

    const history = messages.slice(-historySize);
    const lastUserOffset = [...history].reverse().findIndex((m) => m.role === "user");
    const lastUserIndex = lastUserOffset >= 0 ? history.length - 1 - lastUserOffset : -1;

    return history.map((message, index) => {
        const nextMessage: Message = {
            ...message,
            content: clipText(message.content || "", maxMessageContentChars)
        };

        if (!message.attachments?.length) {
            return nextMessage;
        }

        const canKeepBinary = index === lastUserIndex;
        let keptBinaryCount = 0;

        nextMessage.attachments = message.attachments.map((attachment) => {
            if (attachment.type === "text") {
                return {
                    ...attachment,
                    content: clipText(attachment.content, maxTextAttachmentChars)
                };
            }

            if (!allowBinaryAttachments) {
                return buildAttachmentPlaceholder(attachment, "disabled for compact retry");
            }

            if (!canKeepBinary) {
                return buildAttachmentPlaceholder(attachment, "kept only in the latest user turn");
            }

            if (keptBinaryCount >= maxRecentBinaryAttachments) {
                return buildAttachmentPlaceholder(attachment, "too many binary attachments in one turn");
            }

            const rawBinary = attachment.content.includes("base64,")
                ? attachment.content.split("base64,")[1]
                : attachment.content;

            if (!rawBinary || rawBinary.length > maxBinaryAttachmentChars) {
                return buildAttachmentPlaceholder(attachment, "file too large");
            }

            keptBinaryCount += 1;
            return attachment;
        });

        return nextMessage;
    });
}

function buildEvaluateRequestBody(
    messages: Message[],
    structureContext: string | null,
    generationReady: boolean,
    compactMode: boolean
) {
    const compactOptions: EvaluateMessageBuildOptions = compactMode
        ? {
            historySize: EVALUATE_COMPACT_HISTORY_MESSAGES,
            maxMessageContentChars: EVALUATE_COMPACT_MESSAGE_CONTENT_CHARS,
            maxTextAttachmentChars: EVALUATE_COMPACT_TEXT_ATTACHMENT_CHARS,
            maxBinaryAttachmentChars: 0,
            maxRecentBinaryAttachments: 0,
            allowBinaryAttachments: false
        }
        : {};

    const evaluateMessages = buildEvaluateMessages(messages, compactOptions);
    const context = compactMode && structureContext
        ? clipText(structureContext, EVALUATE_COMPACT_CONTEXT_CHARS)
        : structureContext;

    return JSON.stringify({
        messages: evaluateMessages,
        context,
        generationReady
    });
}

function WizardContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const projectId = searchParams.get("projectId");
    const versionId = searchParams.get("versionId");
    const cachedSnapshot = getCachedProjectSnapshot(projectId);
    const SIDEBAR_MIN = 320;
    const SIDEBAR_MAX = 720;
    const MAIN_MIN = 420;

    // --- State ---
    const [project, setProject] = useState<Project | null>(cachedSnapshot?.project ?? null);
    const [currentVersion, setCurrentVersion] = useState<ProjectVersion | null>(cachedSnapshot?.version ?? null);
    const [isHydrating, setIsHydrating] = useState(false);
    const [loadedVersionId, setLoadedVersionId] = useState<string | null>(null);
    const [hasUserEdited, setHasUserEdited] = useState(false);

    const [messages, setMessages] = useState<Message[]>(cachedSnapshot?.data.messages ?? []);
    const [input, setInput] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [messageWindow, setMessageWindow] = useState(MESSAGE_WINDOW_SIZE);

    // Core Domain State
    const [evaluation, setEvaluation] = useState<EvaluationResponse | null>(cachedSnapshot?.data.evaluation ?? null);
    const [generation, setGeneration] = useState<GenerationResponse | null>(cachedSnapshot?.data.generation ?? null);
    const [tasks, setTasks] = useState<Task[]>(cachedSnapshot?.data.tasks ?? []);

    // UI State
    const [isGenerating, setIsGenerating] = useState(false);
    const [isCheckingOut, setIsCheckingOut] = useState(false);
    const [isQuoteLoading, setIsQuoteLoading] = useState(false);
    const [checkoutQuote, setCheckoutQuote] = useState<CheckoutQuote | null>(null);
    const [generateError, setGenerateError] = useState<string | null>(null);
    const [sidebarWidth, setSidebarWidth] = useState(420);
    const isResizingRef = useRef(false);
    const generateInFlightRef = useRef(false);
    const evaluateAbortRef = useRef<AbortController | null>(null);
    const evalRequestIdRef = useRef(0);

    // Chat Attachments
    const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [currentDiagram, setCurrentDiagram] = useState(
        cachedSnapshot?.data.currentDiagram || "graph TD\nStart[Waiting for input...]"
    );

    const [activeTab, setActiveTab] = useState<'prd' | 'architecture' | 'roadmap' | 'files' | 'stack'>(
        cachedSnapshot?.data.generation ? 'files' : 'architecture'
    );
    const [isCopied, setIsCopied] = useState(false);

    // Batch Review State
    const [isReviewing, setIsReviewing] = useState(false);
    const [reviewProgress, setReviewProgress] = useState<string>("");
    const [reviewReport, setReviewReport] = useState<string | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const startupPromptText = generation?.startupPrompt || generation?.cursorPrompt || "";
    const startupPromptTitle = "Startup Prompt";
    const baseMessageIndex = Math.max(0, messages.length - messageWindow);
    const visibleMessages = messages.slice(baseMessageIndex);
    const hiddenMessageCount = baseMessageIndex;
    const hasPaid = currentVersion?.data.paymentStatus === "paid";

    const syncWorkspaceRemote = async (projects: Project[]) => {
        try {
            await fetch("/api/workspace", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ projects })
            });
        } catch (error) {
            console.error("Failed to sync workspace", error);
        }
    };


    // --- Effects ---

    // 1. Load Project & Version Data
    useEffect(() => {
        if (typeof window === "undefined" || !projectId) return;

        let cancelled = false;

        const hydrateFromProject = (foundProject: Project) => {
            if (cancelled) return;

            setProject(foundProject);

            const latestVersion = foundProject.versions[foundProject.versions.length - 1];
            if (!latestVersion) return;

            setCurrentVersion(latestVersion);
            setLoadedVersionId(latestVersion.id);

            const data = latestVersion.data;
            setMessages(data.messages);
            setMessageWindow(MESSAGE_WINDOW_SIZE);
            setEvaluation(data.evaluation);
            setGeneration(data.generation);
            setCurrentDiagram(data.currentDiagram);
            setTasks(data.tasks);

            if (data.generation) setActiveTab("files");

            if (versionId && versionId !== latestVersion.id) {
                router.replace(`/wizard?projectId=${projectId}&versionId=${latestVersion.id}`);
            }
        };

        const hydrate = async () => {
            setIsHydrating(true);
            setLoadedVersionId(null);
            setHasUserEdited(false);
            await yieldToBrowser();

            const localProjects = readProjectsFromLocalStorage();
            const localProject = localProjects.find((p) => p.id === projectId);
            if (localProject) {
                hydrateFromProject(localProject);
            }

            try {
                const url = projectId
                    ? `/api/workspace?projectId=${encodeURIComponent(projectId)}`
                    : "/api/workspace";
                const res = await fetch(url, { cache: "no-store" });
                if (res.ok) {
                    const data = (await res.json()) as { projects?: Project[] };
                    if (Array.isArray(data.projects)) {
                        if (data.projects.length > 0 || localProjects.length === 0) {
                            if (projectId) {
                                const existing = readProjectsFromLocalStorage();
                                const merged = data.projects.length > 0
                                    ? existing.filter((p) => p.id !== projectId).concat(data.projects)
                                    : existing;
                                writeProjectsToLocalStorage(merged);
                            } else {
                                writeProjectsToLocalStorage(data.projects);
                            }
                            const remoteProject = data.projects.find((p) => p.id === projectId);
                            if (remoteProject) hydrateFromProject(remoteProject);
                        } else {
                            void syncWorkspaceRemote(localProjects);
                        }
                    }
                }
            } catch (error) {
                console.error("Failed to load remote workspace", error);
            } finally {
                if (!cancelled) {
                    setIsHydrating(false);
                }
            }
        };

        void hydrate();

        return () => {
            cancelled = true;
        };
    }, [projectId, versionId, router]);

    // 1e. Handle payment redirect flags
    useEffect(() => {
        if (!projectId) return;
        const payment = searchParams.get("payment");
        if (!payment) return;
        if (!currentVersion) return;

        if (payment === "success") {
            if (currentVersion.data.paymentStatus !== "paid") {
                setHasUserEdited(true);
                setCurrentVersion({
                    ...currentVersion,
                    data: {
                        ...currentVersion.data,
                        paymentStatus: "paid"
                    }
                });
            }
        } else if (payment === "cancelled") {
            setGenerateError("Payment cancelled.");
        }

        const params = new URLSearchParams();
        params.set("projectId", projectId);
        params.set("versionId", currentVersion.id);
        router.replace(`/wizard?${params.toString()}`);
    }, [searchParams, currentVersion, projectId, router]);

    // 1f. Fetch complexity-based quote for unpaid projects
    useEffect(() => {
        if (!projectId || !evaluation?.is_ready || hasPaid) {
            setCheckoutQuote(null);
            setIsQuoteLoading(false);
            return;
        }

        let cancelled = false;
        const controller = new AbortController();
        const timer = window.setTimeout(async () => {
            setIsQuoteLoading(true);
            try {
                const res = await fetch("/api/payments/stripe/quote", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ projectId }),
                    signal: controller.signal
                });

                if (res.status === 401) {
                    if (!cancelled) setCheckoutQuote(null);
                    return;
                }

                const payload = (await res.json()) as { quote?: CheckoutQuote; error?: string };
                if (!res.ok || !payload.quote) {
                    throw new Error(payload.error || "Failed to load checkout quote.");
                }

                if (!cancelled) {
                    setCheckoutQuote(payload.quote);
                }
            } catch (error) {
                if (error instanceof DOMException && error.name === "AbortError") return;
                if (!cancelled) setCheckoutQuote(null);
            } finally {
                if (!cancelled) setIsQuoteLoading(false);
            }
        }, 350);

        return () => {
            cancelled = true;
            controller.abort();
            window.clearTimeout(timer);
        };
    }, [
        projectId,
        hasPaid,
        evaluation?.is_ready,
        messages.length,
        currentVersion?.id,
        generation?.projectTree?.length
    ]);

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
        const projects = readProjectsFromLocalStorage();

        const exists = projects.some((p) => p.id === project.id);
        const newProjects = exists
            ? projects.map((p) => (p.id === project.id ? updatedProject : p))
            : [updatedProject, ...projects];

        writeProjectsToLocalStorage(newProjects);
        const syncTimer = window.setTimeout(() => {
            void syncWorkspaceRemote(newProjects);
        }, 400);

        return () => {
            window.clearTimeout(syncTimer);
        };

        // Update local state references to avoid stale closures if needed, 
        // but we rely on the effect dependencies to trigger updates.
        // Ideally we shouldn't setProject here to act as a verified save, 
        // but we DO need to update the parent 'project' state if we want the sidebar to reflect changes immediately.
        // However, infinite loop risk if we include project in deps.
        // So we only update localStorage here.

    }, [
        messages,
        evaluation,
        generation,
        currentDiagram,
        tasks,
        project,
        currentVersion,
        projectId,
        isHydrating,
        loadedVersionId,
        hasUserEdited
    ]);

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

    const updateAssistantPlaceholder = (text: string) => {
        setMessages(prev => {
            if (prev.length === 0) return prev;
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last.role !== "assistant") return prev;
            updated[updated.length - 1] = { ...last, content: text };
            return updated;
        });
    };

    const cancelEvaluation = (message?: string) => {
        if (evaluateAbortRef.current) {
            evaluateAbortRef.current.abort();
            evaluateAbortRef.current = null;
        }
        evalRequestIdRef.current += 1;
        setIsLoading(false);
        if (message) updateAssistantPlaceholder(message);
    };

    const handleSend = async (overrideInput?: string) => {
        const textToSend = overrideInput || input;

        if (isLoading && !textToSend.trim() && pendingAttachments.length === 0) {
            cancelEvaluation("Response cancelled.");
            return;
        }

        // Allow sending if text OR attachments exist
        if (!textToSend.trim() && pendingAttachments.length === 0) return;

        if (isLoading) {
            cancelEvaluation();
        }

        const attachmentsToSend = [...pendingAttachments];

        const requestId = evalRequestIdRef.current + 1;
        evalRequestIdRef.current = requestId;

        // Optimistic UI Update
        setHasUserEdited(true);
        const newUserMessage: Message = {
            role: "user",
            content: textToSend,
            attachments: attachmentsToSend
        };

        const newMessages = [...messages, newUserMessage];
        const assistantPlaceholder: Message = { role: "assistant", content: "" };
        const assistantIndex = newMessages.length;
        setMessages([...newMessages, assistantPlaceholder]);
        setMessageWindow(MESSAGE_WINDOW_SIZE);
        setInput("");
        setPendingAttachments([]);
        setIsLoading(true);

        try {
            await yieldToBrowser();
            const structureContext = buildProjectStructureContext(generation?.projectTree);
            const controller = new AbortController();
            evaluateAbortRef.current = controller;

            const requestBody = buildEvaluateRequestBody(
                newMessages,
                structureContext,
                Boolean(generation),
                false
            );

            if (requestBody.length > EVALUATE_MAX_REQUEST_CHARS) {
                throw new Error("Evaluate request is too large. Please shorten the conversation or remove large attachments.");
            }

            const runEvaluateRequest = async (body: string) => fetch("/api/evaluate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body,
                signal: controller.signal
            });

            let res = await runEvaluateRequest(requestBody);

            if (!res.ok && EVALUATE_RETRYABLE_STATUS.has(res.status)) {
                const compactRequestBody = buildEvaluateRequestBody(
                    newMessages,
                    structureContext,
                    Boolean(generation),
                    true
                );

                if (compactRequestBody.length <= EVALUATE_MAX_REQUEST_CHARS) {
                    res = await runEvaluateRequest(compactRequestBody);
                }
            }

            if (!res.ok) {
                let detail = `${res.status} ${res.statusText}`;
                const contentType = (res.headers.get("content-type") || "").toLowerCase();

                try {
                    if (contentType.includes("application/json")) {
                        const payload = await res.json() as { error?: string; details?: string };
                        if (payload.error) {
                            detail = payload.details ? `${payload.error}: ${payload.details}` : payload.error;
                        }
                    } else {
                        const text = (await res.text()).trim();
                        if (text) detail = clipText(text, 300);
                    }
                } catch {
                    // Use default detail above.
                }

                if (res.status === 524) {
                    detail = `${detail}. Gateway timeout from CDN/origin (524). Please retry.`;
                }

                throw new Error(`Failed to evaluate (${res.status}): ${detail}`);
            }

            if (!res.body) {
                throw new Error("Failed to evaluate: empty response body");
            }

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            const currentEval: EvaluationResponse = {
                density_score: evaluation?.density_score || 0,
                is_ready: false,
                current_diagram: currentDiagram,
                analysis: evaluation?.analysis || { clarified: [], missing: [] },
                next_step: { reasoning: "", question: null }
            };

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                if (evalRequestIdRef.current !== requestId) break;

                const chunk = decoder.decode(value, { stream: true });
                buffer += chunk;

                // --- Stream Parsing (Identical logic) ---
                const diagramMatch = buffer.match(/<diagram>([\s\S]*?)<\/diagram>/);
                if (diagramMatch && diagramMatch[1]) {
                    const rawContent = diagramMatch[1].trim();
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
                            if (evalRequestIdRef.current !== requestId) return prev;
                            const updated = [...prev];
                            const current = updated[assistantIndex];
                            if (!current || current.role !== "assistant") return prev;
                            updated[assistantIndex] = { ...current, content: q };
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
                    const options = parseOptionsBlock(optionsMatch[1]);
                    setMessages(prev => {
                        if (evalRequestIdRef.current !== requestId) return prev;
                        const updated = [...prev];
                        const current = updated[assistantIndex];
                        if (!current || current.role !== "assistant") return prev;
                        updated[assistantIndex] = { ...current, options };
                        return updated;
                    });
                }

                setEvaluation({ ...currentEval });
            }

        } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") {
                // Swallow abort errors
                return;
            }
            console.error(error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            setMessages(prev => {
                if (evalRequestIdRef.current !== requestId) return prev;
                const updated = [...prev];
                const current = updated[assistantIndex];
                if (!current || current.role !== "assistant") return prev;
                updated[assistantIndex] = { ...current, content: `Error: ${errorMessage}`, options: [] };
                return updated;
            });
        } finally {
            if (evalRequestIdRef.current === requestId) {
                setIsLoading(false);
            }
            if (evaluateAbortRef.current) {
                evaluateAbortRef.current = null;
            }
        }
    };

    const handleOptionClick = (value: string) => {
        setInput(value);
        void handleSend(value);
    };

    const handleResizeStart = (e: React.PointerEvent) => {
        e.preventDefault();
        isResizingRef.current = true;
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
    };

    // --- Generation Handler ---
    const generateBlueprint = async () => {
        if (generateInFlightRef.current) return;
        generateInFlightRef.current = true;
        setIsGenerating(true);
        setGenerateError(null);
        setHasUserEdited(true);
        try {
            await yieldToBrowser();
            const historyText = messages.map(m => `${m.role}: ${m.content}`).join("\n") +
                `\n\nFinal Analysis: ${JSON.stringify(evaluation?.analysis)}`;

            const res = await fetch("/api/generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    summary: historyText,
                    diagram: currentDiagram,
                    projectName: project?.name,
                    // If this version has a generation already (or base version had one), we can pass it?
                    // Actually, for v2, `generation` state was initialized from base. That is our "existingProjectTree".
                    currentProjectTree: generation?.projectTree
                }),
            });

            if (!res.ok) {
                let errorMessage = "Failed to generate";
                try {
                    const payload = await res.json() as { error?: string; details?: string };
                    if (payload.error) {
                        errorMessage = payload.details ? `${payload.error}: ${payload.details}` : payload.error;
                    }
                } catch {
                    // ignore parse error and keep fallback message
                }
                throw new Error(errorMessage);
            }
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
            setGenerateError(error instanceof Error ? error.message : "Blueprint generation failed.");
        } finally {
            setIsGenerating(false);
            generateInFlightRef.current = false;
        }
    };

    const startCheckout = async () => {
        if (!projectId || !currentVersion) {
            setGenerateError("Missing project context for checkout.");
            return;
        }
        if (isCheckingOut) return;
        setIsCheckingOut(true);

        try {
            const baseParams = new URLSearchParams();
            baseParams.set("projectId", projectId);
            baseParams.set("versionId", currentVersion.id);
            const successPath = `/wizard?${baseParams.toString()}&payment=success`;
            const cancelPath = `/wizard?${baseParams.toString()}&payment=cancelled`;

            const res = await fetch("/api/payments/stripe/checkout", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    projectId,
                    projectName: project?.name || "Project Credit",
                    successPath,
                    cancelPath
                })
            });

            if (res.status === 401) {
                router.push("/login");
                return;
            }

            const data = (await res.json()) as { checkoutUrl?: string; error?: string };
            if (!res.ok || !data.checkoutUrl) {
                throw new Error(data.error || "Unable to start Stripe checkout.");
            }

            window.location.assign(data.checkoutUrl);
        } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to start checkout.";
            setGenerateError(message);
        } finally {
            setIsCheckingOut(false);
        }
    };

    const handleGenerate = async () => {
        if (!project?.id) return;
        if (isGenerating || isCheckingOut) return;

        setGenerateError(null);
        if (!hasPaid) {
            await startCheckout();
            return;
        }
        await generateBlueprint();
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

    if (!project || !currentVersion) return <WizardSkeleton />;

    return (
        <>
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
                                {hiddenMessageCount > 0 && (
                                    <div className="flex justify-center">
                                        <button
                                            onClick={() => {
                                                setMessageWindow((prev) => Math.min(messages.length, prev + MESSAGE_WINDOW_STEP));
                                            }}
                                            className="px-3 py-1.5 text-xs rounded-full border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                                        >
                                            Show {Math.min(MESSAGE_WINDOW_STEP, hiddenMessageCount)} earlier messages ({hiddenMessageCount} hidden)
                                        </button>
                                    </div>
                                )}

                                {visibleMessages.map((msg, idx) => {
                                    const messageIndex = baseMessageIndex + idx;
                                    return (
                                        <ChatBubble key={messageIndex} message={msg} onOptionClick={handleOptionClick} />
                                    );
                                })}

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
                                                disabled={isGenerating || isCheckingOut}
                                                className="w-full flex items-center justify-center gap-2 px-6 py-4 bg-green-600 hover:bg-green-700 text-white rounded-xl font-bold shadow-lg transition-all active:scale-95"
                                            >
                                                {isGenerating || isCheckingOut
                                                    ? <Loader2 className="animate-spin" />
                                                    : <Sparkles className="w-5 h-5" />}
                                                {isCheckingOut
                                                    ? "Redirecting to Payment..."
                                                    : isGenerating
                                                        ? "Architecting Solution..."
                                                        : hasPaid
                                                            ? "Generate Blueprint"
                                                            : checkoutQuote?.displayAmount
                                                                ? `Proceed to Payment (${checkoutQuote.displayAmount})`
                                                                : isQuoteLoading
                                                                    ? "Proceed to Payment (Calculating...)"
                                                                    : "Proceed to Payment"}
                                            </button>
                                            {generateError && (
                                                <div className="text-xs text-red-500 text-center">{generateError}</div>
                                            )}
                                            <p className="text-xs text-center text-gray-500">
                                                {hasPaid
                                                    ? "Ready to build or update blueprint"
                                                    : checkoutQuote
                                                        ? `Estimated ${checkoutQuote.displayAmount} (${checkoutQuote.complexityTier} complexity).`
                                                        : isQuoteLoading
                                                            ? "Calculating complexity-based price..."
                                                            : "Payment required before generation"}
                                            </p>
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
                                                disabled={isGenerating}
                                                rows={1}
                                                className="flex-1 p-2 bg-transparent border-none focus:ring-0 focus:outline-none resize-none overflow-hidden min-h-[40px] max-h-[150px]"
                                            />

                                            <button
                                                onClick={() => handleSend()}
                                                disabled={isGenerating || (!isLoading && !input.trim() && pendingAttachments.length === 0)}
                                                className="p-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:hover:bg-blue-600 text-white rounded-lg transition-colors mb-1 shadow-sm"
                                            >
                                                {isLoading ? <Square className="w-5 h-5" /> : <Send className="w-5 h-5" />}
                                            </button>
                                        </div>
                                        {isLoading && (
                                            <p className="text-[11px] text-gray-500 dark:text-gray-400 px-1">
                                                AI is responding. Press the square button to stop and ask a new question.
                                            </p>
                                        )}
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
                <div className="mb-3 flex items-center justify-between flex-shrink-0">
                    <BrandLogo
                        showText={false}
                        iconClassName="w-[clamp(20px,2vw,28px)] h-[clamp(20px,2vw,28px)]"
                    />
                    <div className="flex items-center gap-2">
                        <UserCenter signOutCallbackUrl="/" />
                    </div>
                </div>

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
                                            <Sparkles className="w-4 h-4" /> {startupPromptTitle}
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
                                                    navigator.clipboard.writeText(startupPromptText);
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
                                            {startupPromptText}
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
                                        <FileTreeDisplay content={generation.projectTree} globalPrompt={generation.cursorPrompt} projectName={project?.name} />
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
        </>
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

function WizardSkeleton() {
    return (
        <div className="flex h-screen w-full bg-gray-50 dark:bg-black overflow-hidden font-sans text-gray-900 dark:text-gray-100">
            <div className="w-[420px] min-w-[320px] max-w-[720px] h-full border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/50 flex flex-col">
                <div className="p-4 border-b border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50">
                    <div className="h-4 w-40 bg-gray-200 dark:bg-gray-800 rounded animate-pulse" />
                </div>
                <div className="flex-1 p-4 space-y-4 overflow-hidden">
                    <div className="h-20 bg-gray-100 dark:bg-gray-800 rounded-xl animate-pulse" />
                    <div className="h-16 bg-gray-100 dark:bg-gray-800 rounded-xl animate-pulse" />
                    <div className="h-24 bg-gray-100 dark:bg-gray-800 rounded-xl animate-pulse" />
                    <div className="h-14 bg-gray-100 dark:bg-gray-800 rounded-xl animate-pulse" />
                </div>
                <div className="p-4 border-t border-gray-200 dark:border-gray-800">
                    <div className="h-12 bg-gray-100 dark:bg-gray-800 rounded-xl animate-pulse" />
                </div>
            </div>

            <div className="flex-1 min-w-0 h-full bg-gray-100 dark:bg-gray-950 p-4 md:p-6 overflow-hidden">
                <div className="mb-3 flex items-center justify-between">
                    <div className="h-6 w-6 bg-gray-200 dark:bg-gray-800 rounded animate-pulse" />
                    <div className="h-8 w-20 bg-gray-200 dark:bg-gray-800 rounded animate-pulse" />
                </div>
                <div className="mb-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/60 p-3">
                    <div className="h-4 w-36 bg-gray-200 dark:bg-gray-800 rounded animate-pulse" />
                    <div className="mt-2 h-3 w-48 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
                </div>
                <div className="mb-4 flex gap-2">
                    <div className="h-8 w-28 bg-gray-200 dark:bg-gray-800 rounded-lg animate-pulse" />
                    <div className="h-8 w-24 bg-gray-200 dark:bg-gray-800 rounded-lg animate-pulse" />
                    <div className="h-8 w-24 bg-gray-200 dark:bg-gray-800 rounded-lg animate-pulse" />
                </div>
                <div className="flex-1 min-h-0 bg-white dark:bg-gray-900/50 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm p-6">
                    <div className="h-4 w-40 bg-gray-200 dark:bg-gray-800 rounded animate-pulse" />
                    <div className="mt-4 h-56 bg-gray-100 dark:bg-gray-800 rounded-xl animate-pulse" />
                </div>
            </div>
        </div>
    );
}

export default function WizardPage() {
    return (
        <Suspense fallback={<div className="flex h-screen items-center justify-center">Loading...</div>}>
            <WizardContent />
        </Suspense>
    );
}
