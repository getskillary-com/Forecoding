"use client";

import { useState, useEffect, useRef, Suspense, type ReactNode } from "react";
import { Send, Sparkles, Loader2, FileCode, BrainCircuit, Activity, Layers, Check, Paperclip, X, FileText, Square } from "lucide-react";
import {
    Message,
    EvaluationResponse,
    GenerationResponse,
    DiagramGovernance,
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
const EVALUATE_DESIGN_MEMORY_CHARS = 14_000;
const EVALUATE_COMPACT_DESIGN_MEMORY_CHARS = 5_000;
const EVALUATE_RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504, 520, 522, 523, 524]);
const DIAGRAM_POLICY = "incremental_auto_apply_v1" as const;
const GENERATE_ONE_CLICK_MODE = "strict_build_v1" as const;
const GENERATE_IDE_PROFILE = "generic" as const;
const SCAFFOLD_OUTPUT_LANGUAGE_THRESHOLD = 0.08;

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

function buildDefaultDiagramGovernance(): DiagramGovernance {
    return {
        pendingDiagram: null,
        pendingSourceRequestId: null,
        pendingUpdatedAt: null,
        lastDecision: "none",
        lastDecisionNote: null,
        lastDecisionAt: null
    };
}

function normalizeDiagramGovernance(value: DiagramGovernance | null | undefined): DiagramGovernance {
    const fallback = buildDefaultDiagramGovernance();
    if (!value || typeof value !== "object") return fallback;

    return {
        pendingDiagram: null,
        pendingSourceRequestId: null,
        pendingUpdatedAt: null,
        lastDecision:
            value.lastDecision === "applied" || value.lastDecision === "rejected" || value.lastDecision === "none"
                ? value.lastDecision
                : "none",
        lastDecisionNote: typeof value.lastDecisionNote === "string" ? value.lastDecisionNote : null,
        lastDecisionAt: typeof value.lastDecisionAt === "number" ? value.lastDecisionAt : null
    };
}

function normalizeMermaidForComparison(raw: string | null | undefined): string {
    if (!raw) return "";

    return raw
        .replace(/```mermaid\s*/gi, "")
        .replace(/```/g, "")
        .replace(/\r/g, "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => line.replace(/[ \t]+/g, " "))
        .join("\n")
        .trim();
}

function hasMeaningfulDiagramChange(current: string, candidate: string): boolean {
    return normalizeMermaidForComparison(current) !== normalizeMermaidForComparison(candidate);
}

function countChineseChars(text: string) {
    return (text.match(/[\u3400-\u9fff]/g) || []).length;
}

function countLatinChars(text: string) {
    return (text.match(/[A-Za-z]/g) || []).length;
}

function detectOutputLanguageFromText(text: string): "zh" | "en" {
    if (!text.trim()) return "en";

    const chinese = countChineseChars(text);
    const latin = countLatinChars(text);

    if (chinese >= 6) return "zh";
    if (chinese >= 2 && chinese / Math.max(1, chinese + latin) >= SCAFFOLD_OUTPUT_LANGUAGE_THRESHOLD) {
        return "zh";
    }

    return "en";
}

function inferScaffoldOutputLanguage(messages: Message[]): "zh" | "en" {
    const recentUserText = messages
        .filter((m) => m.role === "user")
        .slice(-8)
        .map((m) => m.content || "")
        .join("\n");

    if (recentUserText.trim()) {
        return detectOutputLanguageFromText(recentUserText);
    }

    const fullText = messages.map((m) => m.content || "").join("\n");
    return detectOutputLanguageFromText(fullText);
}

function inferTemplateKindHintFromTree(tree?: FileNode[]): "next_root" | "next_src" | "monorepo_multiapp" | undefined {
    if (!tree || tree.length === 0) return undefined;

    const topLevel = new Set(
        tree
            .map((node) => node?.name)
            .filter((name): name is string => typeof name === "string" && name.trim().length > 0)
    );

    if (topLevel.has("apps") || topLevel.has("packages")) return "monorepo_multiapp";
    if (topLevel.has("src")) return "next_src";
    if (topLevel.has("app")) return "next_root";
    return undefined;
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

function stripWrappingQuotes(value: string) {
    return value.replace(/^["']|["']$/g, "").trim();
}

function isGenericOptionLabel(label: string) {
    const normalized = label.trim().toLowerCase();
    if (!normalized) return true;

    return /^(option|choice|selection|answer|question|item|step|type|mode|entry|device)\b/.test(normalized);
}

function normalizeSingleQuestion(raw: string) {
    const normalized = raw.replace(/\r\n/g, "\n").trim();
    if (!normalized) return "";

    const lines = normalized
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    if (lines.length === 0) return "";

    const selected: string[] = [];
    for (const line of lines) {
        selected.push(line);
        if (/[?？]/.test(line)) break;
    }

    return selected.join("\n").trim() || lines[0];
}

function extractFallbackAssistantText(raw: string) {
    const normalized = raw.replace(/\r\n/g, "\n").trim();
    if (!normalized) return "";

    const questionMatch = normalized.match(/<question>([\s\S]*?)(?:<\/question>|$)/i);
    if (questionMatch && questionMatch[1]) {
        const questionText = normalizeSingleQuestion(questionMatch[1]);
        if (questionText) return questionText;
    }

    const plainText = normalized
        .replace(/<thinking>[\s\S]*?(?:<\/thinking>|$)/gi, " ")
        .replace(/<diagram>[\s\S]*?(?:<\/diagram>|$)/gi, " ")
        .replace(/<analysis_clarified>[\s\S]*?(?:<\/analysis_clarified>|$)/gi, " ")
        .replace(/<analysis_missing>[\s\S]*?(?:<\/analysis_missing>|$)/gi, " ")
        .replace(/<density>[\s\S]*?(?:<\/density>|$)/gi, " ")
        .replace(/<is_ready>[\s\S]*?(?:<\/is_ready>|$)/gi, " ")
        .replace(/<options>[\s\S]*?(?:<\/options>|$)/gi, " ")
        .replace(/<\/?[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    if (!plainText) return "";
    return clipText(plainText, 600);
}

function parseOptionsBlock(raw: string) {
    const parsed = raw
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => line.replace(/^[-*]\s*/, ""))
        .map((line) => stripWrappingQuotes(line))
        .map((line) => {
            const [rawLabel, ...rest] = line.split("::");
            const label = stripWrappingQuotes(rawLabel || "");
            const valueRaw = stripWrappingQuotes(rest.join("::"));
            const value = valueRaw || label;

            if (!label && !value) return null;
            return {
                label: label || value,
                value
            };
        })
        .filter((item): item is { label: string; value: string } => Boolean(item));

    if (parsed.length === 0) return [];

    const labelCounts = new Map<string, number>();
    for (const option of parsed) {
        const key = option.label.toLowerCase();
        labelCounts.set(key, (labelCounts.get(key) || 0) + 1);
    }

    const dedupe = new Set<string>();

    return parsed
        .map((option) => {
            const label = option.label.trim();
            const value = option.value.trim() || label;
            const duplicatedLabel = (labelCounts.get(label.toLowerCase()) || 0) > 1;
            const shouldPromoteValueToLabel = Boolean(
                value &&
                value.toLowerCase() !== label.toLowerCase() &&
                (duplicatedLabel || isGenericOptionLabel(label))
            );

            return {
                label: shouldPromoteValueToLabel ? value : label,
                value
            };
        })
        .filter((option) => {
            if (!option.label) return false;
            const key = `${option.label.toLowerCase()}::${option.value.toLowerCase()}`;
            if (dedupe.has(key)) return false;
            dedupe.add(key);
            return true;
        });
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

function buildDesignMemory(
    baselineDiagram: string,
    evaluation: EvaluationResponse | null,
    diagramGovernance: DiagramGovernance,
    maxChars: number = EVALUATE_DESIGN_MEMORY_CHARS
) {
    const clarified = evaluation?.analysis.clarified || [];
    const missing = evaluation?.analysis.missing || [];
    const lastDecisionAt = diagramGovernance.lastDecisionAt
        ? new Date(diagramGovernance.lastDecisionAt).toISOString()
        : null;

    const sections = [
        "# Stable Baseline Architecture",
        "Treat this as source of truth unless user explicitly requests structural changes.",
        "```mermaid",
        baselineDiagram || "graph TD\nStart[No baseline architecture yet]",
        "```",
        "",
        "# Confirmed Requirements",
        clarified.length > 0
            ? clarified.slice(0, 30).map((item) => `- ${clipText(item, 300)}`).join("\n")
            : "- None",
        "",
        "# Outstanding Ambiguities",
        missing.length > 0
            ? missing.slice(0, 20).map((item) => `- ${clipText(item, 300)}`).join("\n")
            : "- None",
        "",
        "# Diagram Governance",
        `- Policy: ${DIAGRAM_POLICY}`,
        `- Last Decision: ${diagramGovernance.lastDecision || "none"}`,
        `- Last Decision Time: ${lastDecisionAt || "N/A"}`,
        `- Last Decision Note: ${clipText(diagramGovernance.lastDecisionNote || "N/A", 500)}`,
        "- Update Mode: Auto-apply accepted diagram changes; no manual approval queue."
    ];

    return clipText(sections.join("\n").trim(), maxChars);
}

function summarizeHtmlErrorBody(html: string) {
    const source = (html || "").trim();
    if (!source) return "";

    const titleMatch = source.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const h1Match = source.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    const h2Match = source.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
    const candidate = titleMatch?.[1] || h1Match?.[1] || h2Match?.[1] || source;

    const plain = candidate
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    return clipText(plain || "Internal Server Error", 200);
}

function normalizeEvaluateErrorDetail(raw: string) {
    const source = (raw || "").trim();
    if (!source) return "";

    const looksLikeHtml = /<!doctype html|<html|<head|<body|<style|<\/[a-z]+>/i.test(source);
    if (looksLikeHtml) {
        return summarizeHtmlErrorBody(source);
    }

    const looksLikeCssDump = /\bbody\s*\{[\s\S]{20,2000}\}|\bh1\s*,\s*h2|\bfont-family\s*:/i.test(source);
    if (looksLikeCssDump) {
        return "Internal Server Error from upstream gateway. Please retry.";
    }

    const plain = source
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\b[a-z0-9_.#,\-:\s]{1,200}\{[^{}]{1,4000}\}/gi, " ")
        .replace(/\s+/g, " ")
        .trim();

    if (!plain) return "Internal Server Error";
    if (/internal server error/i.test(plain)) {
        return clipText("Internal Server Error from upstream gateway. Please retry.", 220);
    }

    return clipText(plain, 220);
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
    compactMode: boolean,
    designMemory: string | null,
    diagramPolicy: string
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
    const designMemoryText = designMemory
        ? clipText(
            designMemory,
            compactMode ? EVALUATE_COMPACT_DESIGN_MEMORY_CHARS : EVALUATE_DESIGN_MEMORY_CHARS
        )
        : null;

    return JSON.stringify({
        messages: evaluateMessages,
        context,
        generationReady,
        designMemory: designMemoryText,
        diagramPolicy
    });
}

function compactProjectTreeForPricing(nodes?: FileNode[]): FileNode[] {
    if (!nodes?.length) return [];

    return nodes.map((node) => {
        if (node.type === "folder") {
            return {
                name: node.name,
                type: "folder",
                children: compactProjectTreeForPricing(node.children)
            };
        }

        return {
            name: node.name,
            type: "file"
        };
    });
}

function buildPricingProjectSnapshot(
    project: Project | null,
    currentVersion: ProjectVersion | null,
    messages: Message[],
    evaluation: EvaluationResponse | null,
    generation: GenerationResponse | null,
    currentDiagram: string,
    diagramGovernance: DiagramGovernance,
    tasks: Task[]
): Project | null {
    if (!project || !currentVersion) return null;

    const compactMessages: Message[] = messages.map((message) => ({
        role: message.role,
        content: message.content,
        options: message.options,
        attachments: message.attachments?.map((attachment) => ({
            ...attachment,
            // Pricing only needs attachment count, not payload bytes.
            content: ""
        }))
    }));

    const compactGeneration: GenerationResponse | null = generation
        ? {
            ...generation,
            projectTree: compactProjectTreeForPricing(generation.projectTree)
        }
        : null;

    const snapshotVersion: ProjectVersion = {
        ...currentVersion,
        data: {
            ...currentVersion.data,
            messages: compactMessages,
            evaluation,
            generation: compactGeneration,
            currentDiagram,
            diagramGovernance,
            tasks,
            paymentStatus: currentVersion.data.paymentStatus
        }
    };

    const versionExists = project.versions.some((version) => version.id === snapshotVersion.id);
    const versions = versionExists
        ? project.versions.map((version) => (version.id === snapshotVersion.id ? snapshotVersion : version))
        : [...project.versions, snapshotVersion];

    return {
        ...project,
        updatedAt: Date.now(),
        versions
    };
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
    const [isAdmin, setIsAdmin] = useState(false);
    const [isAdminStatusLoaded, setIsAdminStatusLoaded] = useState(false);
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
    const [diagramGovernance, setDiagramGovernance] = useState<DiagramGovernance>(
        normalizeDiagramGovernance(cachedSnapshot?.data.diagramGovernance)
    );

    const [activeTab, setActiveTab] = useState<'prd' | 'architecture' | 'roadmap' | 'files' | 'stack'>(
        cachedSnapshot?.data.generation ? 'files' : 'architecture'
    );

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const baseMessageIndex = Math.max(0, messages.length - messageWindow);
    const visibleMessages = messages.slice(baseMessageIndex);
    const hiddenMessageCount = baseMessageIndex;
    const hasPaid = currentVersion?.data.paymentStatus === "paid";
    const requiresPayment = !hasPaid && !isAdmin;
    const architectureViewerCode = currentDiagram;

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

    // 0. Resolve admin mode
    useEffect(() => {
        let cancelled = false;

        const loadAdminStatus = async () => {
            setIsAdminStatusLoaded(false);
            try {
                const res = await fetch("/api/admin/status", { cache: "no-store" });
                if (!res.ok) {
                    if (!cancelled) setIsAdmin(false);
                    return;
                }

                const payload = (await res.json()) as { isAdmin?: boolean };
                if (!cancelled) {
                    setIsAdmin(payload.isAdmin === true);
                }
            } catch {
                if (!cancelled) setIsAdmin(false);
            } finally {
                if (!cancelled) setIsAdminStatusLoaded(true);
            }
        };

        void loadAdminStatus();
        return () => {
            cancelled = true;
        };
    }, []);

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
            setDiagramGovernance(normalizeDiagramGovernance(data.diagramGovernance));
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
        } else if (payment === "cancelled" && !isAdmin) {
            setGenerateError("Payment cancelled.");
        }

        const params = new URLSearchParams();
        params.set("projectId", projectId);
        params.set("versionId", currentVersion.id);
        router.replace(`/wizard?${params.toString()}`);
    }, [searchParams, currentVersion, projectId, router, isAdmin]);

    // 1f. Fetch complexity-based quote for unpaid projects
    useEffect(() => {
        if (!projectId || !evaluation?.is_ready || hasPaid || isAdmin || !isAdminStatusLoaded) {
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
                    body: JSON.stringify({
                        projectId,
                        projectSnapshot: buildPricingProjectSnapshot(
                            project,
                            currentVersion,
                            messages,
                            evaluation,
                            generation,
                            currentDiagram,
                            diagramGovernance,
                            tasks
                        )
                    }),
                    signal: controller.signal
                });

                if (res.status === 401) {
                    if (!cancelled) setCheckoutQuote(null);
                    return;
                }

                const payload = (await res.json()) as {
                    quote?: CheckoutQuote;
                    error?: string;
                    adminBypass?: boolean;
                };
                if (payload.adminBypass) {
                    if (!cancelled) setCheckoutQuote(null);
                    return;
                }
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
        isAdmin,
        isAdminStatusLoaded,
        project,
        currentVersion,
        messages,
        evaluation,
        generation,
        currentDiagram,
        diagramGovernance,
        tasks
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
                diagramGovernance,
                tasks,
                paymentStatus: currentVersion.data.paymentStatus
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
        diagramGovernance,
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
            const designMemory = buildDesignMemory(
                currentDiagram,
                evaluation,
                diagramGovernance,
                EVALUATE_DESIGN_MEMORY_CHARS
            );
            const controller = new AbortController();
            evaluateAbortRef.current = controller;

            const requestBody = buildEvaluateRequestBody(
                newMessages,
                structureContext,
                Boolean(generation),
                false,
                designMemory,
                DIAGRAM_POLICY
            );

            if (requestBody.length > EVALUATE_MAX_REQUEST_CHARS) {
                throw new Error("Evaluate request is too large. Please shorten the conversation or remove large attachments.");
            }

            const runEvaluateRequest = async (body: string) => fetch("/api/evaluate", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "text/event-stream"
                },
                body,
                cache: "no-store",
                signal: controller.signal
            });

            let res = await runEvaluateRequest(requestBody);

            if (!res.ok && EVALUATE_RETRYABLE_STATUS.has(res.status)) {
                const compactRequestBody = buildEvaluateRequestBody(
                    newMessages,
                    structureContext,
                    Boolean(generation),
                    true,
                    designMemory,
                    DIAGRAM_POLICY
                );

                if (compactRequestBody.length <= EVALUATE_MAX_REQUEST_CHARS) {
                    res = await runEvaluateRequest(compactRequestBody);
                }
            }

            if (!res.ok) {
                let detail = `${res.status} ${res.statusText}`;
                const contentType = (res.headers.get("content-type") || "").toLowerCase();
                const serverRequestId = res.headers.get("x-evaluate-request-id") || "";

                try {
                    if (contentType.includes("application/json")) {
                        const payload = await res.json() as { error?: string; details?: string };
                        const normalizedPayloadDetails = normalizeEvaluateErrorDetail(payload.details || "");
                        if (payload.error) {
                            detail = normalizedPayloadDetails
                                ? `${payload.error}: ${normalizedPayloadDetails}`
                                : payload.error;
                        } else if (normalizedPayloadDetails) {
                            detail = normalizedPayloadDetails;
                        }
                    } else {
                        const text = (await res.text()).trim();
                        if (text) {
                            detail = normalizeEvaluateErrorDetail(text);
                        }
                    }
                } catch {
                    // Use default detail above.
                }

                if (res.status === 524) {
                    detail = `${detail}. Gateway timeout from CDN/origin (524). Please retry.`;
                }

                if (serverRequestId) {
                    detail = `${detail} (ref: ${serverRequestId})`;
                }

                throw new Error(`Failed to evaluate (${res.status}): ${detail}`);
            }

            if (!res.body) {
                throw new Error("Failed to evaluate: empty response body");
            }

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            const baselineDiagramForRequest = currentDiagram;
            const baselineDiagramNormalized = normalizeMermaidForComparison(baselineDiagramForRequest);
            let latestAppliedDiagram = baselineDiagramForRequest;
            let latestAppliedDiagramNormalized = baselineDiagramNormalized;
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

                    const normalizedCandidate = normalizeMermaidForComparison(code);
                    if (
                        normalizedCandidate &&
                        normalizedCandidate !== latestAppliedDiagramNormalized &&
                        hasMeaningfulDiagramChange(latestAppliedDiagram, code)
                    ) {
                        latestAppliedDiagram = code;
                        latestAppliedDiagramNormalized = normalizedCandidate;
                        setCurrentDiagram(code);
                        setDiagramGovernance((prev) => ({
                            ...prev,
                            pendingDiagram: null,
                            pendingSourceRequestId: null,
                            pendingUpdatedAt: null,
                            lastDecision: "applied",
                            lastDecisionNote: "Auto-applied architecture update from assistant response.",
                            lastDecisionAt: Date.now()
                        }));
                    }
                }

                const questionMatch = buffer.match(/<question>([\s\S]*?)(?:<\/question>|$)/i);
                if (questionMatch && questionMatch[1]) {
                    const q = normalizeSingleQuestion(questionMatch[1]);
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
                if (densityMatch) {
                    currentEval.density_score = parseInt(densityMatch[1]);
                    if (currentEval.density_score >= 100) {
                        setMessages(prev => {
                            if (evalRequestIdRef.current !== requestId) return prev;
                            const updated = [...prev];
                            const current = updated[assistantIndex];
                            if (!current || current.role !== "assistant") return prev;
                            updated[assistantIndex] = { ...current, options: [] };
                            return updated;
                        });
                    }
                }

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
                const optionsMatch = buffer.match(/<options>([\s\S]*?)<\/options>/i);
                if (optionsMatch) {
                    const options = currentEval.density_score >= 100
                        ? []
                        : parseOptionsBlock(optionsMatch[1]);
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

            if (evalRequestIdRef.current === requestId) {
                const fallbackText = extractFallbackAssistantText(buffer) || "Model response format was invalid. Please retry.";
                setMessages(prev => {
                    if (evalRequestIdRef.current !== requestId) return prev;
                    const updated = [...prev];
                    const current = updated[assistantIndex];
                    if (!current || current.role !== "assistant") return prev;
                    if (current.content.trim().length > 0) return prev;
                    if (current.options && current.options.length > 0) return prev;
                    updated[assistantIndex] = { ...current, content: fallbackText, options: [] };
                    return updated;
                });
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

    const handleOptionClick = (option: { label: string; value: string }) => {
        const optionLabel = option.label.trim();
        const optionValue = option.value.trim();
        const textToSend = optionValue || optionLabel;
        if (!textToSend) return;

        setInput(textToSend);
        void handleSend(textToSend);
    };

    const handleResizeStart = (e: React.PointerEvent) => {
        e.preventDefault();
        isResizingRef.current = true;
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
    };

    // --- Generation Handler ---
    const generateScaffold = async () => {
        if (generateInFlightRef.current) return;
        generateInFlightRef.current = true;
        setIsGenerating(true);
        setGenerateError(null);
        setHasUserEdited(true);
        try {
            await yieldToBrowser();
            const historyText = messages.map(m => `${m.role}: ${m.content}`).join("\n") +
                `\n\nFinal Analysis: ${JSON.stringify(evaluation?.analysis)}`;
            const outputLanguage = inferScaffoldOutputLanguage(messages);
            const templateKindHint = inferTemplateKindHintFromTree(generation?.projectTree);

            const res = await fetch("/api/generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    summary: historyText,
                    diagram: currentDiagram,
                    projectName: project?.name,
                    outputLanguage,
                    oneClickMode: GENERATE_ONE_CLICK_MODE,
                    ideProfile: GENERATE_IDE_PROFILE,
                    templateKindHint,
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
            if (data.preflightReport && !data.preflightReport.pass) {
                const codes = data.preflightReport.issues.map((issue) => issue.code).join(", ");
                throw new Error(`Scaffold preflight failed: ${codes || "unknown"}`);
            }
            setGeneration(data);

            // Auto switch tab
            setActiveTab('files');

            // Mock Task Generation
            setTasks([
                { id: '1', title: 'Setup Project Structure', status: 'pending', description: 'Initialize scaffold.', source: 'scaffold' },
                { id: '2', title: 'Implement Core Features', status: 'pending', description: 'Based on Scaffold.', source: 'scaffold' },
            ]);

        } catch (error) {
            console.error(error);
            setGenerateError(error instanceof Error ? error.message : "Scaffold generation failed.");
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
        if (isAdmin) {
            setGenerateError("Admin mode bypasses payment. Please generate directly.");
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
                    cancelPath,
                    projectSnapshot: buildPricingProjectSnapshot(
                        project,
                        currentVersion,
                        messages,
                        evaluation,
                        generation,
                        currentDiagram,
                        diagramGovernance,
                        tasks
                    )
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
        if (requiresPayment) {
            await startCheckout();
            return;
        }
        await generateScaffold();
    };

    if (!project || !currentVersion) return <WizardSkeleton />;

    return (
        <>
            <div className="relative flex h-screen w-full overflow-hidden font-sans text-slate-900 dark:text-slate-100">
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(13,93,255,0.16),transparent_70%)]" />
                {/* Project Sidebar + Chat (Left) */}
                <VersionSidebar project={project} width={sidebarWidth}>
                <div className="relative z-10 flex h-full min-h-0 flex-col">
                    <div className="flex-1 min-h-0">
                        <div
                            className="relative z-10 flex h-full flex-col border-l border-[color:var(--border)] bg-white/82 shadow-[var(--shadow-sm)] backdrop-blur-sm dark:bg-slate-900/72"
                            onPaste={handlePaste}
                        >
                            {/* Header */}
                            <div className="flex items-center justify-between border-b border-[color:var(--border)] bg-white/70 px-4 py-3 backdrop-blur-sm dark:bg-slate-900/75">
                                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-300">
                                    {project.name} Workspace
                                </span>
                                {evaluation && <DensityProgress score={evaluation.density_score} />}
                            </div>

                            {/* Chat Area */}
                            <div className="flex-1 space-y-6 overflow-y-auto bg-gradient-to-b from-white/55 to-transparent p-4 scrollbar-hide dark:from-slate-900/30">
                                {hiddenMessageCount > 0 && (
                                    <div className="flex justify-center">
                                        <button
                                            onClick={() => {
                                                setMessageWindow((prev) => Math.min(messages.length, prev + MESSAGE_WINDOW_STEP));
                                            }}
                                            className="rounded-full border border-[color:var(--border)] bg-white/90 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-white dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
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
                                        <div className="rounded-xl rounded-tl-none bg-slate-100 px-4 py-2 text-sm text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                                            Thinking...
                                        </div>
                                    </div>
                                )}

                                <div ref={messagesEndRef} />
                            </div>

                            {/* Input Area */}
                            <div className="border-t border-[color:var(--border)] bg-white/80 p-4 dark:bg-slate-900/75">
                                {evaluation?.is_ready ? (
                                    <div className="flex flex-col gap-2">
                                        {generation ? (
                                            <>
                                                <div className="flex w-full cursor-default items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-6 py-4 font-semibold text-emerald-700 dark:border-emerald-700/40 dark:bg-emerald-900/20 dark:text-emerald-300">
                                                    <Check className="w-5 h-5" />
                                                    Scaffold Generated
                                                </div>
                                                <p className="text-center text-xs font-medium text-emerald-600 dark:text-emerald-400">Scaffold generated successfully! Check the Scaffold tab.</p>
                                            </>
                                        ) : (
                                            <>
                                            <button
                                                onClick={handleGenerate}
                                                disabled={isGenerating || isCheckingOut || !isAdminStatusLoaded}
                                                className="fc-button-primary flex w-full items-center justify-center gap-2 px-6 py-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                                            >
                                                {isGenerating || isCheckingOut
                                                    ? <Loader2 className="animate-spin" />
                                                    : <Sparkles className="w-5 h-5" />}
                                                {!isAdminStatusLoaded
                                                    ? "Checking access..."
                                                    : isCheckingOut
                                                    ? "Redirecting to Payment..."
                                                    : isGenerating
                                                        ? "Architecting Solution..."
                                                        : !requiresPayment
                                                            ? "Generate Scaffold"
                                                            : checkoutQuote?.displayAmount
                                                                ? `Proceed to Payment (${checkoutQuote.displayAmount})`
                                                                : isQuoteLoading
                                                                    ? "Proceed to Payment (Calculating...)"
                                                                    : "Proceed to Payment"}
                                            </button>
                                            {generateError && (
                                                <div className="text-xs text-red-500 text-center">{generateError}</div>
                                            )}
                                            <p className="text-center text-xs text-slate-500 dark:text-slate-300">
                                                {!isAdminStatusLoaded
                                                    ? "Checking permissions..."
                                                    : isAdmin
                                                    ? "Admin mode: payment bypass enabled"
                                                    : hasPaid
                                                        ? "Ready to build or update scaffold"
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
                                            <div className="flex gap-2 overflow-x-auto px-1 pb-2">
                                                {pendingAttachments.map((att, idx) => (
                                                    att.type === 'image' ? (
                                                        <div key={idx} className="relative group shrink-0">
                                                            <div className="h-20 w-20 overflow-hidden rounded-xl border-2 border-blue-200 shadow-sm dark:border-blue-800">
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
                                                        <div key={idx} className="relative group flex shrink-0 items-center gap-2 rounded-xl border border-[color:var(--border)] bg-slate-100 p-2 pr-8 dark:bg-slate-800">
                                                            <FileText className="h-5 w-5 text-slate-500 dark:text-slate-300" />
                                                            <span className="max-w-[100px] truncate text-xs text-slate-600 dark:text-slate-300" title={att.name}>{att.name}</span>
                                                            <button
                                                                onClick={() => removeAttachment(idx)}
                                                                className="absolute right-1 top-1 rounded-full p-1 transition-colors hover:bg-slate-200 dark:hover:bg-slate-600"
                                                            >
                                                                <X className="h-3 w-3 text-slate-500 dark:text-slate-300" />
                                                            </button>
                                                        </div>
                                                    )
                                                ))}
                                            </div>
                                        )}

                                        <div className="relative flex items-end gap-2 rounded-xl border border-[color:var(--border)] bg-white/95 p-2 transition-all focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-500/30 dark:bg-slate-800/80">
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
                                                className="mb-1 rounded-lg p-2 text-slate-400 transition-colors hover:bg-blue-50 hover:text-blue-500 dark:text-slate-300 dark:hover:bg-blue-900/20"
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
                                                className="min-h-[40px] max-h-[150px] flex-1 resize-none overflow-hidden border-none bg-transparent p-2 text-slate-900 focus:outline-none focus:ring-0 dark:text-slate-100"
                                            />

                                            <button
                                                onClick={() => handleSend()}
                                                disabled={isGenerating || (!isLoading && !input.trim() && pendingAttachments.length === 0)}
                                                className="fc-button-primary mb-1 rounded-lg p-2 disabled:cursor-not-allowed disabled:opacity-50"
                                            >
                                                {isLoading ? <Square className="w-5 h-5" /> : <Send className="w-5 h-5" />}
                                            </button>
                                        </div>
                                        {isLoading && (
                                            <p className="px-1 text-[11px] text-slate-500 dark:text-slate-300">
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
                className="z-20 w-1.5 flex-shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-blue-200/60 dark:hover:bg-blue-800/50"
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize chat panel"
                style={{ touchAction: "none" }}
            />

            {/* Studio Panel (Right) - v2 Layout */}
            <main className="relative z-10 flex h-full min-w-0 flex-1 flex-col overflow-hidden p-4 md:p-6">
                <div className="fc-surface mb-3 flex flex-shrink-0 items-center justify-between rounded-2xl px-4 py-3">
                    <BrandLogo
                        showText={false}
                        iconClassName="w-[clamp(20px,2vw,28px)] h-[clamp(20px,2vw,28px)]"
                    />
                    <div className="flex items-center gap-2">
                        <UserCenter signOutCallbackUrl="/" />
                    </div>
                </div>

                {/* Tabs */}
                <div className="fc-surface mb-4 flex flex-shrink-0 space-x-1 overflow-x-auto rounded-2xl p-2">
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
                        label="Scaffold"
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
                <div className="fc-surface-strong relative flex-1 min-h-0 overflow-hidden rounded-[var(--radius-2xl)]">

                    {/* Architecture Tab */}
                    {activeTab === 'architecture' && (
                        <div className="absolute inset-0 p-4 flex flex-col">
                            <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-300">
                                <span>Live System Diagram</span>
                                <span className="flex items-center gap-1">
                                    <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                                    Auto Updating
                                </span>
                            </div>

                            <div className="flex-1 min-h-0 flex flex-col gap-3">
                                <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-dashed border-[color:var(--border)] bg-slate-50/70 dark:bg-black/25">
                                    <ArchitectureViewer code={architectureViewerCode} />
                                </div>
                            </div>
                        </div>
                    )}

                    {/* PRD Tab */}
                    {activeTab === 'prd' && (
                        <div className="absolute inset-0 p-6 overflow-y-auto custom-scrollbar">
                            <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-slate-100">
                                <Activity className="h-5 w-5 text-blue-500" />
                                Feature Analysis
                            </h3>

                            <div className="grid gap-6">
                                <div className="space-y-3">
                                    <h4 className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-600 dark:text-emerald-400">Confirmed Requirements</h4>
                                    {evaluation?.analysis.clarified.length ? (
                                        <ul className="space-y-2">
                                            {evaluation.analysis.clarified.map((item, i) => (
                                                <li key={i} className="flex gap-2 rounded-lg border border-emerald-100 bg-emerald-50 p-3 text-sm text-slate-700 dark:border-emerald-800/40 dark:bg-emerald-900/15 dark:text-slate-200">
                                                    <span className="text-emerald-500">+</span>
                                                    {item}
                                                </li>
                                            ))}
                                        </ul>
                                    ) : (
                                        <p className="text-sm italic text-slate-400">Waiting for details...</p>
                                    )}
                                </div>

                                <div className="space-y-3">
                                    <h4 className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-500 dark:text-amber-400">Pending Questions</h4>
                                    {evaluation?.analysis.missing.length ? (
                                        <ul className="space-y-2">
                                            {evaluation.analysis.missing.map((item, i) => (
                                                <li key={i} className="flex gap-2 rounded-lg border border-amber-100 bg-amber-50 p-3 text-sm text-slate-700 dark:border-amber-800/40 dark:bg-amber-900/15 dark:text-slate-200">
                                                    <span className="text-amber-500">?</span>
                                                    {item}
                                                </li>
                                            ))}
                                        </ul>
                                    ) : (
                                        <p className="text-sm italic text-slate-400">No missing info detected.</p>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Scaffold Tab */}
                    {activeTab === 'files' && generation && (
                        <div className="absolute inset-0 p-4 overflow-hidden">
                            <FileTreeDisplay content={generation.projectTree} projectName={project?.name} />
                        </div>
                    )}

                    {/* Stack Tab */}
                    {activeTab === 'stack' && generation && (
                        <div className="absolute inset-0 p-6 overflow-y-auto">
                            <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-slate-100">
                                <Layers className="h-5 w-5 text-orange-500" />
                                Technology Stack
                            </h3>
                            <ToolStackTable content={generation.toolStack} />
                        </div>
                    )}

                </div>
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
            className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition-all ${active
                ? 'border border-blue-200 bg-blue-50 text-blue-700 shadow-sm dark:border-blue-700/40 dark:bg-blue-900/20 dark:text-blue-200'
                : 'text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800/65'} ${disabled ? 'cursor-not-allowed opacity-45' : ''}`}
        >
            {icon}
            <span>{label}</span>
        </button>
    );
}

function WizardSkeleton() {
    return (
        <div className="relative flex h-screen w-full overflow-hidden font-sans text-slate-900 dark:text-slate-100">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(13,93,255,0.16),transparent_70%)]" />
            <div className="relative z-10 flex h-full w-[420px] min-w-[320px] max-w-[720px] flex-col border-r border-[color:var(--border)] bg-white/85 backdrop-blur-sm dark:bg-slate-900/75">
                <div className="border-b border-[color:var(--border)] bg-white/60 p-4 dark:bg-slate-900/75">
                    <div className="h-4 w-40 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
                </div>
                <div className="flex-1 p-4 space-y-4 overflow-hidden">
                    <div className="h-20 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />
                    <div className="h-16 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />
                    <div className="h-24 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />
                    <div className="h-14 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />
                </div>
                <div className="border-t border-[color:var(--border)] p-4">
                    <div className="h-12 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />
                </div>
            </div>

            <div className="relative z-10 h-full min-w-0 flex-1 overflow-hidden p-4 md:p-6">
                <div className="fc-surface mb-3 flex items-center justify-between rounded-2xl px-4 py-3">
                    <div className="h-6 w-6 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
                    <div className="h-8 w-20 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
                </div>
                <div className="fc-surface mb-3 rounded-xl p-3">
                    <div className="h-4 w-36 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
                    <div className="mt-2 h-3 w-48 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
                </div>
                <div className="mb-4 flex gap-2">
                    <div className="h-8 w-28 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-800" />
                    <div className="h-8 w-24 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-800" />
                    <div className="h-8 w-24 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-800" />
                </div>
                <div className="fc-surface-strong flex-1 min-h-0 rounded-2xl p-6">
                    <div className="h-4 w-40 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
                    <div className="mt-4 h-56 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />
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
