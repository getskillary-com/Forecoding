"use client";

import { useState, useEffect, useRef, Suspense, type ReactNode } from "react";
import { Send, Sparkles, Loader2, FileCode, BrainCircuit, Layers, Check, Paperclip, X, FileText, Square } from "lucide-react";
import {
    ArchitecturePack,
    ArchitectureStage,
    DecisionRecord,
    Message,
    MessageAction,
    MessageOption,
    MessageQuestionStatus,
    EvaluationResponse,
    GenerationResponse,
    DiagramGovernance,
    DesignStage,
    GuardrailChecklist,
    HandoffValidation,
    ReadinessChecklist,
    ReadinessOverride,
    ReadinessRequirementKey,
    SourceArtifact,
    UiDesignState,
    UiReadinessReport,
    UiRequirementKey,
    UiRequirements,
    UiDesignSpec,
    Project,
    Task,
    ProjectVersion,
    Attachment,
    FileNode
} from "@/types";
import { ChatBubble } from "@/components/ChatBubble";
import dynamic from "next/dynamic";
const ArchitectureViewer = dynamic(() => import("@/components/ArchitectureViewer"), {
    ssr: false,
    loading: () => <div className="h-full w-full" />
});
const FileTreeDisplay = dynamic(() => import("@/components/FileTreeDisplay").then((m) => m.FileTreeDisplay), {
    ssr: false,
    loading: () => <div className="h-full w-full" />
});
const ToolStackTable = dynamic(() => import("@/components/ToolStackTable").then((m) => m.ToolStackTable), {
    ssr: false,
    loading: () => <div className="h-full w-full" />
});
import { VersionSidebar } from "@/components/VersionSidebar";
import { UserCenter } from "@/components/UserCenter";
import { useSearchParams, useRouter } from "next/navigation";
import { getProjectWorkspaceLanguage, type WorkspaceLanguage } from "@/lib/project-language";
import {
    getArchitectureStageLabel,
    getWorkspaceUiText,
    translateComplexityTier,
    translateReadinessText
} from "@/lib/workspace-i18n";
import {
    getCachedProjectSnapshot,
    readProjectsFromLocalStorage,
    writeProjectsToLocalStorage
} from "@/lib/workspace-cache";
import {
    buildMinimalUiDesignSpec,
    deriveUiRequirements,
    normalizeUiDesignSpec,
    parseUiDesignSpecBlock,
    validateUiDesignSpec
} from "@/lib/ui-spec";
import {
    buildArchitecturePackScaffoldInput,
    createMinimumViableLoopChecklist,
    createReadinessChecklist,
    extractSourceArtifacts,
    findReadinessRequirement,
    getPrimaryIncompleteReadinessRequirement,
    inferArchitectureStage,
    normalizeArchitecturePack,
    normalizeDecisionRecords,
    normalizeGuardrailChecklist,
    normalizeReadinessOverrides,
    seedArchitecturePackFromAnalysis
} from "@/lib/architecture";
import { computeScaffoldEligibility } from "@/lib/scaffold-eligibility";
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
const EVALUATE_SOURCE_CONTEXT_CHARS = 6_000;
const EVALUATE_COMPACT_SOURCE_CONTEXT_CHARS = 2_500;
const EVALUATE_RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504, 520, 522, 523, 524]);
const GENERATE_MAX_HISTORY_MESSAGES = 24;
const GENERATE_MAX_MESSAGE_CONTENT_CHARS = 2_000;
const GENERATE_MAX_ANALYSIS_CHARS = 10_000;
const GENERATE_MAX_SUMMARY_CHARS = 50_000;
const DIAGRAM_POLICY = "incremental_auto_apply_v1" as const;
const GENERATE_OUTPUT_MODE = "runnable_scaffold" as const;
const GENERATE_ONE_CLICK_MODE = "strict_build_v1" as const;
const GENERATE_IDE_PROFILE = "generic" as const;
const SOURCE_CONTEXT_ITEM_EXCERPT_CHARS = 700;
const SOURCE_CONTEXT_MAX_ITEMS = 6;
const SOURCE_SEARCH_TERM_MAX_COUNT = 24;
const GENERATE_SCAFFOLD_PATTERN = /generate scaffold|scaffold generation|start scaffold generation|generate scaffold now|开始生成(?:代码)?脚手架|生成(?:代码)?脚手架|立即生成|start scaffold/i;
const OPEN_PRD_PATTERN = /open prd|show prd|prd record|product requirements|打开prd|查看prd|需求记录|prd记录/i;
const DEFER_RESPONSE_PATTERN = /more detail|common options|not sure|add detail|补充|细节|选项|不确定|更多细节|常见选项/i;
const AFFIRMATIVE_RESPONSE_PATTERN = /^(?:yes|y|agree|agreed|proceed|continue|go ahead|do it|recommended|default|confirm|confirmed|generate scaffold(?: now)?|start scaffold(?: generation)?|立即生成|开始生成(?:代码)?脚手架|生成(?:代码)?脚手架|按推荐方案继续|按你推荐的默认方案继续|按默认方案继续|同意|是的|继续)$/i;
const SOURCE_SEARCH_STOP_WORDS = new Set([
    "the",
    "and",
    "for",
    "with",
    "this",
    "that",
    "from",
    "into",
    "about",
    "need",
    "want",
    "build",
    "make",
    "please",
    "then",
    "also"
]);
const UI_REQUIREMENT_KEYS: UiRequirementKey[] = [
    "visualStyle",
    "colorSystem",
    "typography",
    "keyScreens",
    "uiComponents",
    "responsiveStrategy",
    "interactionMotion",
    "statesAndFeedback"
];

const UI_REQUIREMENT_LABELS: Record<UiRequirementKey, string> = {
    visualStyle: "Visual style",
    colorSystem: "Color system",
    typography: "Typography",
    keyScreens: "Key screens",
    uiComponents: "UI components",
    responsiveStrategy: "Responsive strategy",
    interactionMotion: "Interaction motion",
    statesAndFeedback: "States and feedback"
};

function readFileContentFromTree(nodes: FileNode[], targetPath: string, prefix = ""): string {
    for (const node of nodes || []) {
        if (!node || typeof node !== "object" || typeof node.name !== "string") continue;
        const currentPath = prefix ? `${prefix}/${node.name}` : node.name;
        if (node.type === "file" && currentPath === targetPath) {
            return typeof node.content === "string" ? node.content : "";
        }
        if (node.type === "folder" && Array.isArray(node.children)) {
            const nested = readFileContentFromTree(node.children, targetPath, currentPath);
            if (nested) return nested;
        }
    }

    return "";
}

function upsertFileContentInTree(nodes: FileNode[], targetPath: string, content: string): FileNode[] {
    const segments = targetPath.split("/").filter(Boolean);
    if (segments.length === 0) return Array.isArray(nodes) ? [...nodes] : [];

    const visit = (items: FileNode[], depth: number): FileNode[] => {
        const next = Array.isArray(items) ? [...items] : [];
        const segment = segments[depth];
        const index = next.findIndex((node) => node?.name === segment);
        const isLeaf = depth === segments.length - 1;

        if (isLeaf) {
            const nextFile: FileNode = {
                name: segment,
                type: "file",
                content
            };
            if (index >= 0) {
                next[index] = nextFile;
            } else {
                next.push(nextFile);
            }
            return next;
        }

        const existing = index >= 0 ? next[index] : null;
        const existingChildren = existing?.type === "folder" && Array.isArray(existing.children)
            ? existing.children
            : [];
        const nextFolder: FileNode = {
            name: segment,
            type: "folder",
            children: visit(existingChildren, depth + 1)
        };

        if (index >= 0) {
            next[index] = nextFolder;
        } else {
            next.push(nextFolder);
        }

        return next;
    };

    return visit(nodes, 0);
}

function parseHandoffValidationFromTree(generation: GenerationResponse | null): HandoffValidation | null {
    if (!generation || !Array.isArray(generation.projectTree) || generation.projectTree.length === 0) return null;
    const rawReport = readFileContentFromTree(generation.projectTree, "VALIDATION_REPORT.json").trim();
    if (!rawReport) return null;

    try {
        const parsed = JSON.parse(rawReport) as Record<string, unknown>;
        const rawSummary = parsed.summary && typeof parsed.summary === "object"
            ? parsed.summary as Record<string, unknown>
            : {};
        const rawIssues = Array.isArray(parsed.issues)
            ? parsed.issues.filter((issue): issue is Record<string, unknown> => Boolean(issue && typeof issue === "object"))
            : [];
        const rawStatus = typeof parsed.status === "string" ? parsed.status.trim().toLowerCase() : "";
        const passFlag = typeof parsed.pass === "boolean" ? parsed.pass : null;

        let status: HandoffValidation["status"] = "pending";
        if (rawStatus === "pending") {
            status = "pending";
        } else if (passFlag === true || rawStatus === "passed" || rawStatus === "pass" || rawStatus === "success") {
            status = "passed";
        } else if (passFlag === false || rawStatus === "failed" || rawStatus === "fail" || rawStatus === "error") {
            status = "failed";
        } else if (rawIssues.length > 0) {
            status = "failed";
        }

        return {
            status,
            command: "npm run validate:handoff",
            reportPath: "VALIDATION_REPORT.json",
            scriptPath: "scripts/validate-generated-handoff.mjs",
            updatedAt: typeof parsed.generatedAt === "string" && parsed.generatedAt.trim()
                ? parsed.generatedAt.trim()
                : undefined,
            summary: {
                placeholdersRemaining: typeof rawSummary.placeholdersRemaining === "boolean"
                    ? rawSummary.placeholdersRemaining
                    : rawIssues.some((issue) => issue.code === "PLACEHOLDERS_REMAINING"),
                lintPassed: typeof rawSummary.lintPassed === "boolean" ? rawSummary.lintPassed : status === "passed",
                typecheckPassed: typeof rawSummary.typecheckPassed === "boolean" ? rawSummary.typecheckPassed : status === "passed",
                buildPassed: typeof rawSummary.buildPassed === "boolean" ? rawSummary.buildPassed : status === "passed"
            },
            issues: rawIssues.map((issue) => ({
                code: typeof issue.code === "string" && issue.code.trim() ? issue.code.trim() : "UNKNOWN",
                message: typeof issue.message === "string" && issue.message.trim() ? issue.message.trim() : "Unknown validation issue.",
                details: typeof issue.details === "string" && issue.details.trim() ? issue.details.trim() : undefined
            }))
        };
    } catch {
        return {
            status: "failed",
            command: "npm run validate:handoff",
            reportPath: "VALIDATION_REPORT.json",
            scriptPath: "scripts/validate-generated-handoff.mjs",
            summary: {
                placeholdersRemaining: false,
                lintPassed: false,
                typecheckPassed: false,
                buildPassed: false
            },
            issues: [
                {
                    code: "INVALID_VALIDATION_REPORT",
                    message: "VALIDATION_REPORT.json is not valid JSON."
                }
            ]
        };
    }
}

function resolveGenerationHandoffValidation(generation: GenerationResponse | null): HandoffValidation | null {
    if (!generation) return null;
    return generation.handoffValidation ?? parseHandoffValidationFromTree(generation);
}

function formatHandoffUpdatedAt(value: string | undefined, language: WorkspaceLanguage) {
    if (!value) return "";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
    }).format(parsed);
}

function normalizeStringList(value: unknown, maxItems: number = 80): string[] {
    if (!Array.isArray(value)) return [];
    const dedupe = new Set<string>();
    const normalized = value
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean)
        .filter((item) => {
            const key = item.toLowerCase();
            if (dedupe.has(key)) return false;
            dedupe.add(key);
            return true;
        });
    return normalized.slice(0, maxItems);
}

function normalizeMessageAction(value: unknown): MessageAction | null {
    return value === "generate_scaffold" ||
        value === "open_prd" ||
        value === "send_message" ||
        value === "focus_requirement" ||
        value === "fill_requirement" ||
        value === "show_blockers"
        ? value
        : null;
}

function normalizeReadinessRequirementKey(value: unknown): ReadinessRequirementKey | null {
    switch (value) {
        case "business_context.product_goal":
        case "business_context.target_users":
        case "business_context.user_journeys":
        case "business_context.constraints_or_risks":
        case "boundaries.bounded_contexts":
        case "boundaries.module_responsibilities":
        case "boundaries.data_ownership":
        case "decisions.decision_records":
        case "decisions.integration_contracts":
        case "decisions.non_functional_requirements":
        case "guardrails.implementation_order":
        case "guardrails.acceptance_criteria":
        case "guardrails.test_strategy":
        case "ui.key_screens":
        case "ui.shared_components":
        case "ui.responsive_strategy":
            return value;
        default:
            return null;
    }
}

function normalizeMessageQuestionStatus(value: unknown): MessageQuestionStatus | null {
    return value === "pending" || value === "answered" || value === "stale"
        ? value
        : null;
}

function normalizeQuestionKey(value: string) {
    return value
        .replace(/\(ref:[^)]+\)/gi, " ")
        .replace(/^(当前判断：|current view:)/i, " ")
        .replace(/^(需要确认：|please confirm:)/i, " ")
        .replace(/[?？!！.,，。:："'`]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase()
        .slice(0, 180);
}

function normalizeAttachments(value: unknown): Attachment[] | undefined {
    if (!Array.isArray(value)) return undefined;

    const normalized = value
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
        .map((item) => {
            const type =
                item.type === "image" || item.type === "text" || item.type === "pdf"
                    ? item.type
                    : null;
            const mimeType = typeof item.mimeType === "string" ? item.mimeType.trim() : "";
            const content = typeof item.content === "string" ? item.content : "";
            const name = typeof item.name === "string" ? item.name.trim() : "";
            if (!type || !mimeType || !content || !name) return null;
            return {
                type,
                mimeType,
                content,
                name
            } satisfies Attachment;
        })
        .filter((item): item is Attachment => Boolean(item));

    return normalized.length > 0 ? normalized : undefined;
}

function normalizeMessageOptionValue(value: unknown): MessageOption | null {
    if (!value || typeof value !== "object") return null;

    const candidate = value as Partial<MessageOption>;
    const label = typeof candidate.label === "string" ? candidate.label.trim() : "";
    const rawValue = typeof candidate.value === "string" ? candidate.value.trim() : "";
    const optionValue = rawValue || label;

    if (!label && !optionValue) return null;

    return {
        label: label || optionValue,
        value: optionValue,
        action: normalizeMessageAction(candidate.action) ?? undefined,
        questionKey: typeof candidate.questionKey === "string" && candidate.questionKey.trim()
            ? normalizeQuestionKey(candidate.questionKey)
            : undefined,
        requirementKey: normalizeReadinessRequirementKey(candidate.requirementKey) ?? undefined,
        stale: candidate.stale === true ? true : undefined
    };
}

function normalizeMessageValue(value: unknown): Message | null {
    if (!value || typeof value !== "object") return null;

    const candidate = value as Partial<Message>;
    const role = candidate.role === "assistant" ? "assistant" : candidate.role === "user" ? "user" : null;
    const content = typeof candidate.content === "string" ? candidate.content : "";
    if (!role) return null;

    const looksLikeTrackedQuestion =
        role === "assistant" &&
        (
            /[?？]/.test(content) ||
            /需要确认：|please confirm:/i.test(content) ||
            Array.isArray(candidate.options)
        );
    const inferredQuestionKey =
        typeof candidate.questionKey === "string" && candidate.questionKey.trim()
            ? normalizeQuestionKey(candidate.questionKey)
            : looksLikeTrackedQuestion && content.trim()
                ? normalizeQuestionKey(normalizeSingleQuestion(content))
                : undefined;
    const inferredQuestionAction =
        normalizeMessageAction(candidate.questionAction) ??
        (looksLikeTrackedQuestion && content.trim() ? inferQuestionAction(content) ?? undefined : undefined);
    const inferredQuestionRequirementKey =
        normalizeReadinessRequirementKey(candidate.questionRequirementKey) ??
        undefined;
    const options = Array.isArray(candidate.options)
        ? candidate.options.reduce<MessageOption[]>((acc, option) => {
            const normalizedOption = normalizeMessageOptionValue(option);
            if (!normalizedOption) return acc;

            acc.push({
                ...normalizedOption,
                action: resolveOptionAction(normalizedOption, inferredQuestionAction ?? null) ?? undefined,
                questionKey: inferredQuestionKey ?? normalizedOption.questionKey ?? undefined,
                requirementKey: inferredQuestionRequirementKey ?? normalizedOption.requirementKey ?? undefined
            });
            return acc;
        }, [])
        : undefined;
    const inferredQuestionStatus =
        normalizeMessageQuestionStatus(candidate.questionStatus) ??
        (looksLikeTrackedQuestion && inferredQuestionKey ? "pending" : undefined);

    return {
        role,
        content,
        options: options && options.length > 0 ? options : undefined,
        attachments: normalizeAttachments(candidate.attachments),
        questionKey: inferredQuestionKey,
        questionStatus: inferredQuestionStatus,
        questionAction: inferredQuestionAction,
        questionRequirementKey: inferredQuestionRequirementKey,
        answeredQuestionKey: typeof candidate.answeredQuestionKey === "string" && candidate.answeredQuestionKey.trim()
            ? normalizeQuestionKey(candidate.answeredQuestionKey)
            : undefined,
        triggeredAction: normalizeMessageAction(candidate.triggeredAction) ?? undefined
    };
}

function normalizeMessages(value: unknown): Message[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => normalizeMessageValue(item))
        .filter((item): item is Message => Boolean(item));
}

function inferQuestionAction(questionText: string): MessageAction | null {
    if (GENERATE_SCAFFOLD_PATTERN.test(questionText)) return "generate_scaffold";
    if (OPEN_PRD_PATTERN.test(questionText)) return "open_prd";
    return null;
}

function isAffirmativeForAction(value: string, action: MessageAction | null) {
    if (!action) return false;
    if (DEFER_RESPONSE_PATTERN.test(value)) return false;

    if (action === "generate_scaffold") {
        return GENERATE_SCAFFOLD_PATTERN.test(value) || AFFIRMATIVE_RESPONSE_PATTERN.test(value);
    }

    if (action === "open_prd") {
        return OPEN_PRD_PATTERN.test(value) || AFFIRMATIVE_RESPONSE_PATTERN.test(value);
    }

    if (action === "fill_requirement" || action === "focus_requirement" || action === "show_blockers") {
        return AFFIRMATIVE_RESPONSE_PATTERN.test(value);
    }

    return false;
}

function resolveOptionAction(
    option: Pick<MessageOption, "label" | "value" | "action">,
    questionAction: MessageAction | null
): MessageAction | null {
    if (option.action) return option.action;

    const combined = `${option.label} ${option.value}`.trim();
    if (questionAction && isAffirmativeForAction(combined, questionAction)) {
        return questionAction;
    }

    return inferQuestionAction(combined);
}

function getLatestPendingQuestion(messages: Message[]) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message.role !== "assistant") continue;
        if (!message.questionKey || message.questionStatus === "answered" || message.questionStatus === "stale") continue;
        return message;
    }
    return null;
}

function closeOpenAssistantQuestions(messages: Message[], answeredQuestionKey?: string | null) {
    return messages.map((message) => {
        if (message.role !== "assistant" || !message.questionKey) return message;
        if (message.questionStatus === "answered" || message.questionStatus === "stale") return message;

        const nextStatus: MessageQuestionStatus =
            answeredQuestionKey && message.questionKey === answeredQuestionKey
                ? "answered"
                : "stale";

        return {
            ...message,
            questionStatus: nextStatus,
            options: message.options?.map((option) => ({ ...option, stale: true }))
        };
    });
}

function buildResolvedConfirmationLog(messages: Message[], maxItems: number = 12) {
    const assistantQuestions = new Map<string, string>();
    const resolvedByQuestionKey = new Map<string, {
        questionKey: string;
        question: string;
        answer: string;
        action: MessageAction | null;
    }>();

    messages.forEach((message) => {
        if (message.role !== "assistant" || !message.questionKey) return;
        const normalizedQuestion = normalizeSingleQuestion(message.content || "");
        assistantQuestions.set(message.questionKey, normalizedQuestion || message.questionKey);
    });

    messages
        .filter((message): message is Message & { answeredQuestionKey: string } =>
            message.role === "user" &&
            typeof message.answeredQuestionKey === "string" &&
            message.answeredQuestionKey.trim().length > 0
        )
        .forEach((message) => {
            const answer = message.content.trim();
            if (!answer) return;

            resolvedByQuestionKey.set(message.answeredQuestionKey, {
                questionKey: message.answeredQuestionKey,
                question: assistantQuestions.get(message.answeredQuestionKey) || message.answeredQuestionKey,
                answer,
                action: message.triggeredAction ?? null
            });
        });

    return [...resolvedByQuestionKey.values()].slice(-maxItems);
}

function createEmptyUiRequirements(): UiRequirements {
    return {
        visualStyle: [],
        colorSystem: [],
        typography: [],
        keyScreens: [],
        uiComponents: [],
        responsiveStrategy: [],
        interactionMotion: [],
        statesAndFeedback: []
    };
}

function normalizeUiRequirements(value: unknown): UiRequirements {
    const base = createEmptyUiRequirements();
    if (!value || typeof value !== "object") return base;
    const candidate = value as Partial<UiRequirements>;
    for (const key of UI_REQUIREMENT_KEYS) {
        base[key] = normalizeStringList(candidate[key]);
    }
    return base;
}

function normalizeAnalysis(raw: EvaluationResponse["analysis"] | null | undefined): EvaluationResponse["analysis"] {
    const fallback = {
        clarified: [] as string[],
        missing: [] as string[],
        ui: createEmptyUiRequirements()
    };

    if (!raw || typeof raw !== "object") return fallback;
    return {
        clarified: normalizeStringList((raw as { clarified?: unknown }).clarified, 80),
        missing: normalizeStringList((raw as { missing?: unknown }).missing, 60),
        ui: normalizeUiRequirements((raw as { ui?: unknown }).ui)
    };
}

function normalizeEvaluation(
    value: EvaluationResponse | null | undefined,
    readinessOverrides: ReadinessOverride[] = []
): EvaluationResponse | null {
    if (!value || typeof value !== "object") return null;
    const analysis = normalizeAnalysis(value.analysis);
    const architecturePackDraft = normalizeArchitecturePack(value.architecturePackDraft, analysis.ui);
    const decisionDrafts = normalizeDecisionRecords(value.decisionDrafts);
    const guardrailDrafts = normalizeGuardrailChecklist(value.guardrailDrafts);
    const stage = normalizeArchitectureStage(
        value.stage,
        architecturePackDraft,
        decisionDrafts,
        guardrailDrafts,
        readinessOverrides
    );
    const readiness = applyArchitectureStageScoreFloor(
        normalizeReadiness(value.readiness, architecturePackDraft, decisionDrafts, guardrailDrafts, readinessOverrides)
    );
    return {
        ...value,
        analysis,
        stage,
        openQuestions: normalizeStringList(value.openQuestions ?? analysis.missing, 12),
        architecturePackDraft,
        decisionDrafts,
        guardrailDrafts,
        readiness
    };
}

function parseJsonBlock<T>(raw: string, normalizer: (value: unknown) => T): T | null {
    const source = (raw || "")
        .trim()
        .replace(/^```json/i, "")
        .replace(/^```/i, "")
        .replace(/```$/i, "")
        .trim();
    if (!source) return null;

    const parseCandidate = (text: string): T | null => {
        try {
            return normalizer(JSON.parse(text));
        } catch {
            return null;
        }
    };

    const direct = parseCandidate(source);
    if (direct) return direct;

    const objectMatch = source.match(/\{[\s\S]*\}/);
    if (objectMatch?.[0]) {
        const embeddedObject = parseCandidate(objectMatch[0]);
        if (embeddedObject) return embeddedObject;
    }

    const arrayMatch = source.match(/\[[\s\S]*\]/);
    if (arrayMatch?.[0]) {
        const embeddedArray = parseCandidate(arrayMatch[0]);
        if (embeddedArray) return embeddedArray;
    }

    return null;
}

function normalizeArchitectureStage(
    value: unknown,
    architecturePack: ArchitecturePack,
    decisionRecords: DecisionRecord[],
    guardrailChecklist: GuardrailChecklist,
    readinessOverrides: ReadinessOverride[] = []
): ArchitectureStage {
    return inferArchitectureStage(
        architecturePack,
        decisionRecords,
        guardrailChecklist,
        readinessOverrides
    );
}

function applyArchitectureStageScoreFloor(
    readiness: ReadinessChecklist
): ReadinessChecklist {
    return readiness;
}

function normalizeReadiness(
    value: unknown,
    architecturePack: ArchitecturePack,
    decisionRecords: DecisionRecord[],
    guardrailChecklist: GuardrailChecklist,
    readinessOverrides: ReadinessOverride[] = []
): ReadinessChecklist {
    const fallback = createReadinessChecklist(architecturePack, decisionRecords, guardrailChecklist, readinessOverrides);
    if (!value || typeof value !== "object") return fallback;
    const candidate = value as Partial<ReadinessChecklist>;
    return {
        ...fallback,
        nextMilestone: typeof candidate.nextMilestone === "string" && candidate.nextMilestone.trim()
            ? candidate.nextMilestone.trim()
            : fallback.nextMilestone
    };
}

function parseAnalysisList(raw: string) {
    return raw
        .split("\n")
        .map((line) => line.trim().replace(/^- /, ""))
        .filter(Boolean);
}

function parseAnalysisUiBlock(raw: string): UiRequirements {
    const source = (raw || "")
        .trim()
        .replace(/^```json/i, "")
        .replace(/^```/i, "")
        .replace(/```$/i, "")
        .trim();
    if (!source) return createEmptyUiRequirements();

    const parseJsonCandidate = (text: string): UiRequirements | null => {
        try {
            const parsed = JSON.parse(text) as unknown;
            return normalizeUiRequirements(parsed);
        } catch {
            return null;
        }
    };

    const direct = parseJsonCandidate(source);
    if (direct) return direct;

    const objectMatch = source.match(/\{[\s\S]*\}/);
    if (objectMatch?.[0]) {
        const embedded = parseJsonCandidate(objectMatch[0]);
        if (embedded) return embedded;
    }

    return createEmptyUiRequirements();
}

function createUiReadinessReport(
    uiDesignSpec: UiDesignSpec | null,
    evaluation: EvaluationResponse | null,
    updatedAt: number = Date.now()
): UiReadinessReport {
    const ui = uiDesignSpec ? deriveUiRequirements(uiDesignSpec) : normalizeUiRequirements(evaluation?.analysis?.ui);
    const missingKeys = UI_REQUIREMENT_KEYS.filter((key) => ui[key].length === 0);
    const errors = validateUiDesignSpec(uiDesignSpec);
    const completed = errors.length === 0;
    const filledCount = UI_REQUIREMENT_KEYS.length - missingKeys.length;
    return {
        score: completed
            ? 100
            : Math.min(99, Math.round((filledCount / UI_REQUIREMENT_KEYS.length) * 100)),
        completed,
        missingKeys,
        missingLabels: missingKeys.map((key) => UI_REQUIREMENT_LABELS[key]),
        updatedAt
    };
}

function normalizeUiReadinessReport(
    raw: unknown,
    evaluation: EvaluationResponse | null,
    uiDesignSpec: UiDesignSpec | null
): UiReadinessReport {
    const fallback = createUiReadinessReport(uiDesignSpec, evaluation);
    if (!raw || typeof raw !== "object") return fallback;
    const candidate = raw as Partial<UiReadinessReport>;
    const computed = createUiReadinessReport(
        uiDesignSpec,
        evaluation,
        typeof candidate.updatedAt === "number" ? candidate.updatedAt : Date.now()
    );
    return {
        score: computed.score,
        completed: computed.completed,
        missingKeys: computed.missingKeys,
        missingLabels: computed.missingLabels,
        updatedAt: typeof candidate.updatedAt === "number" ? candidate.updatedAt : computed.updatedAt
    };
}

function normalizeUiDesignState(
    raw: unknown,
    evaluation: EvaluationResponse | null,
    uiDesignSpec: UiDesignSpec | null
): UiDesignState {
    if (!raw || typeof raw !== "object") {
        return {
            needsResync: false,
            readiness: createUiReadinessReport(uiDesignSpec, evaluation)
        };
    }
    const candidate = raw as Partial<UiDesignState>;
    return {
        needsResync: candidate.needsResync === true,
        readiness: normalizeUiReadinessReport(candidate.readiness, evaluation, uiDesignSpec)
    };
}

function areArrayValuesEqual(a: string[], b: string[]) {
    if (a.length !== b.length) return false;
    return a.every((item, idx) => item === b[idx]);
}

function normalizeSourceArtifacts(value: unknown): SourceArtifact[] {
    if (!Array.isArray(value)) return [];
    return value
        .filter((item): item is SourceArtifact => Boolean(item && typeof item === "object"))
        .map((item, index) => {
            const sourceType =
                item.sourceType === "chat" || item.sourceType === "text" || item.sourceType === "pdf" || item.sourceType === "image"
                    ? item.sourceType
                    : "text";
            return {
                id: typeof item.id === "string" && item.id.trim() ? item.id : `artifact-${index}`,
                sourceType,
                name: typeof item.name === "string" && item.name.trim() ? item.name.trim() : `Artifact ${index + 1}`,
                summary: typeof item.summary === "string" ? item.summary.trim() : "",
                excerpt: typeof item.excerpt === "string"
                    ? clipText(item.excerpt.trim(), 2400)
                    : ((sourceType === "chat" || sourceType === "text") && typeof item.summary === "string"
                        ? clipText(item.summary.trim(), 2400)
                        : ""),
                mimeType: typeof item.mimeType === "string" && item.mimeType.trim() ? item.mimeType.trim() : undefined,
                sourceMessageIndex: typeof item.sourceMessageIndex === "number" ? item.sourceMessageIndex : undefined,
                attachmentIndex: typeof item.attachmentIndex === "number" ? item.attachmentIndex : undefined,
                createdAt: typeof item.createdAt === "number" ? item.createdAt : Date.now()
            };
        })
        .slice(-40);
}

function normalizeVersionDesignState(data: ProjectVersion["data"] | null | undefined) {
    const messages = normalizeMessages(data?.messages);
    const readinessOverrides = normalizeReadinessOverrides(data?.readinessOverrides);
    const evaluation = normalizeEvaluation(data?.evaluation ?? null, readinessOverrides);
    const uiDesignSpec = normalizeUiDesignSpec(data?.uiDesignSpec, evaluation?.analysis?.ui);
    const uiDesignState = normalizeUiDesignState(data?.uiDesignState, evaluation, uiDesignSpec);
    const architecturePack = normalizeArchitecturePack(
        data?.architecturePack ?? evaluation?.architecturePackDraft ?? seedArchitecturePackFromAnalysis(evaluation?.analysis, evaluation?.analysis?.ui),
        uiDesignSpec ? deriveUiRequirements(uiDesignSpec) : evaluation?.analysis?.ui
    );
    const decisionRecords = normalizeDecisionRecords(data?.decisionRecords ?? evaluation?.decisionDrafts);
    const guardrailChecklist = normalizeGuardrailChecklist(data?.guardrailChecklist ?? evaluation?.guardrailDrafts);
    const sourceArtifacts = normalizeSourceArtifacts(data?.sourceArtifacts);
    const scaffoldEligibility = computeScaffoldEligibility({
        architecturePack,
        decisionRecords,
        guardrailChecklist,
        readinessOverrides
    });
    const architectureStage = normalizeArchitectureStage(
        data?.architectureStage ?? evaluation?.stage,
        architecturePack,
        decisionRecords,
        guardrailChecklist,
        readinessOverrides
    );
    const readiness = applyArchitectureStageScoreFloor(scaffoldEligibility.readiness);
    const rawStoredStage = (data as { designStage?: unknown } | null | undefined)?.designStage;
    const hasLegacyUiStage = rawStoredStage === "ui_design";
    const designStage = hasLegacyUiStage
        ? "functional_architecture"
        : scaffoldEligibility.designStage;
    const functionalLockedAt =
        typeof data?.functionalLockedAt === "number"
            ? (hasLegacyUiStage ? null : data.functionalLockedAt)
            : (designStage !== "functional_architecture" ? Date.now() : null);
    const uiReadyAt =
        typeof data?.uiReadyAt === "number"
            ? (hasLegacyUiStage ? null : data.uiReadyAt)
            : (designStage === "ready_to_generate" ? Date.now() : null);

    return {
        messages,
        evaluation,
        designStage,
        uiDesignState,
        uiDesignSpec,
        architecturePack,
        decisionRecords,
        guardrailChecklist,
        sourceArtifacts,
        architectureStage,
        readiness,
        readinessOverrides,
        functionalLockedAt,
        uiReadyAt
    };
}

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

function extractSourceSearchTerms(text: string) {
    const source = (text || "").toLowerCase();
    const terms = new Set<string>();
    const asciiMatches = source.match(/[a-z0-9][a-z0-9_-]{1,31}/g) || [];

    for (const word of asciiMatches) {
        if (SOURCE_SEARCH_STOP_WORDS.has(word)) continue;
        terms.add(word);
        if (terms.size >= SOURCE_SEARCH_TERM_MAX_COUNT) {
            return [...terms];
        }
    }

    const cjkMatches = source.match(/[\u4e00-\u9fff]{2,16}/g) || [];
    for (const phrase of cjkMatches) {
        terms.add(phrase);
        const maxGram = Math.min(4, phrase.length);
        for (let gram = 2; gram <= maxGram; gram += 1) {
            for (let index = 0; index <= phrase.length - gram && index < 8; index += 1) {
                terms.add(phrase.slice(index, index + gram));
                if (terms.size >= SOURCE_SEARCH_TERM_MAX_COUNT) {
                    return [...terms];
                }
            }
        }
    }

    return [...terms];
}

function buildSourceArtifactHaystack(artifact: SourceArtifact) {
    return [
        artifact.name,
        artifact.summary,
        artifact.excerpt || "",
        artifact.mimeType || ""
    ]
        .join("\n")
        .toLowerCase();
}

function scoreSourceArtifact(
    artifact: SourceArtifact,
    searchTerms: string[],
    recencyRank: number
) {
    const haystack = buildSourceArtifactHaystack(artifact);
    let score = Math.max(0, 8 - recencyRank);

    for (const term of searchTerms) {
        if (!term || !haystack.includes(term)) continue;
        score += term.length >= 6 ? 7 : term.length >= 4 ? 5 : 3;
    }

    if (artifact.excerpt) score += 3;
    if (artifact.sourceType === "text") score += 2;
    if (artifact.sourceType === "chat") score += 1;

    return score;
}

function renderSourceArtifactEvidence(artifact: SourceArtifact) {
    const lines = [
        `- ${artifact.name} [${artifact.sourceType}]`,
        `  Summary: ${clipText(artifact.summary || artifact.name, 220)}`
    ];

    if (artifact.excerpt) {
        lines.push(`  Evidence: ${clipText(artifact.excerpt, SOURCE_CONTEXT_ITEM_EXCERPT_CHARS)}`);
    }

    return lines.join("\n");
}

function buildSourceContext(
    sourceArtifacts: SourceArtifact[],
    messages: Message[],
    maxChars: number = EVALUATE_SOURCE_CONTEXT_CHARS
) {
    if (!sourceArtifacts.length) return null;

    const recentUserText = messages
        .filter((message) => message.role === "user")
        .slice(-4)
        .map((message) => message.content || "")
        .join("\n");
    const searchTerms = extractSourceSearchTerms(recentUserText);
    const recencyOrdered = [...sourceArtifacts].sort((a, b) => b.createdAt - a.createdAt);
    const scored = recencyOrdered.map((artifact, recencyRank) => ({
        artifact,
        score: scoreSourceArtifact(artifact, searchTerms, recencyRank)
    }));
    const ranked = (scored.some((item) => item.score > 8)
        ? scored
        : recencyOrdered.map((artifact, recencyRank) => ({
            artifact,
            score: Math.max(0, 8 - recencyRank)
        })))
        .sort((a, b) => b.score - a.score || b.artifact.createdAt - a.artifact.createdAt);

    const sections = [
        "# Retrieved Source Evidence",
        "Treat these snippets as durable user-provided evidence. Prefer them over reconstructing old context from recent chat alone.",
        "If evidence conflicts with the latest user turn, call out the conflict and ask for confirmation."
    ];
    let selectedCount = 0;

    for (const { artifact } of ranked) {
        if (selectedCount >= SOURCE_CONTEXT_MAX_ITEMS) break;
        const nextBlock = renderSourceArtifactEvidence(artifact);
        const candidate = [...sections, nextBlock].join("\n\n");
        if (candidate.length > maxChars && selectedCount > 0) break;
        sections.push(nextBlock);
        selectedCount += 1;
    }

    if (selectedCount === 0) return null;
    return clipText(sections.join("\n\n"), maxChars);
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

function detectResponseLanguage(...texts: string[]) {
    return /[\u4e00-\u9fff]/.test(texts.join(" ")) ? "zh" : "en";
}

function parseQuestionBlock(raw: string) {
    const normalized = raw.replace(/\r\n/g, "\n").trim();
    if (!normalized) {
        return {
            recommendation: "",
            question: "",
            displayText: ""
        };
    }

    const lines = normalized
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    if (lines.length === 0) {
        return {
            recommendation: "",
            question: "",
            displayText: ""
        };
    }

    const questionIndex = lines.findIndex((line) => /[?？]/.test(line));
    const recommendation = questionIndex > 0
        ? lines.slice(0, questionIndex).join(" ").trim()
        : questionIndex === -1 && lines.length > 1
            ? lines.slice(0, -1).join(" ").trim()
            : "";
    const question = questionIndex >= 0
        ? lines.slice(questionIndex).join(" ").trim()
        : lines[lines.length - 1];
    const language = detectResponseLanguage(recommendation, question);
    const parts: string[] = [];

    if (recommendation) {
        parts.push(clipText(recommendation, 280));
    }

    if (question) {
        parts.push(`${language === "zh" ? "需要确认：" : "Please confirm:"}\n${clipText(question, 260)}`);
    }

    return {
        recommendation,
        question,
        displayText: parts.join("\n\n").trim() || clipText(lines.join(" "), 360)
    };
}

function normalizeSingleQuestion(raw: string) {
    const parsed = parseQuestionBlock(raw);
    if (parsed.question) return clipText(parsed.question, 260);
    return clipText(raw.replace(/\s+/g, " ").trim(), 260);
}

function buildAssistantDisplayContent(
    rawQuestion: string,
    analysis?: EvaluationResponse["analysis"] | null,
    forcedLanguage?: WorkspaceLanguage
) {
    const parsed = parseQuestionBlock(rawQuestion);
    if (parsed.recommendation) return parsed.displayText;

    const clarified = normalizeAnalysis(analysis).clarified
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 2);

    if (clarified.length === 0) {
        return parsed.displayText || clipText(rawQuestion.replace(/\s+/g, " ").trim(), 360);
    }

    const language = forcedLanguage ?? detectResponseLanguage(rawQuestion, clarified.join(" "));
    const summaryTitle = language === "zh" ? "当前判断：" : "Current view:";
    const parts = [
        `${summaryTitle}\n- ${clarified.join("\n- ")}`
    ];

    if (parsed.question) {
        parts.push(`${language === "zh" ? "需要确认：" : "Please confirm:"}\n${clipText(parsed.question, 260)}`);
    }

    return parts.join("\n\n");
}

function buildCommonFallbackOptions(
    language: "zh" | "en",
    questionAction: MessageAction | null = null
): MessageOption[] {
    if (questionAction === "generate_scaffold") {
        if (language === "zh") {
            return [
                { label: "开始生成脚手架", value: "开始生成脚手架。", action: "generate_scaffold" },
                { label: "我来补充细节", value: "我来补充更多具体细节，请继续问我关键问题。" },
                { label: "打开 PRD", value: "请切换到 PRD 记录页，我想先确认需求沉淀。", action: "open_prd" },
                { label: "暂时不生成", value: "我暂时不生成，请继续完善架构包。" }
            ];
        }

        return [
            { label: "Generate scaffold now", value: "Generate scaffold now.", action: "generate_scaffold" },
            { label: "I will add more detail", value: "I will add more specific detail. Please continue with the key questions." },
            { label: "Open PRD", value: "Open the PRD tab first so I can double-check the requirements.", action: "open_prd" },
            { label: "Not yet", value: "Not yet. Please continue refining the architecture pack." }
        ];
    }

    if (language === "zh") {
        return [
            { label: "按推荐方案继续", value: "按你推荐的默认方案继续。" },
            { label: "我来补充细节", value: "我来补充更多具体细节，请继续问我关键问题。" },
            { label: "给我常见选项", value: "请给我 2 到 3 个常见方案并说明取舍。" },
            { label: "暂时不确定", value: "我暂时不确定，请按最稳妥的默认方案推进。" }
        ];
    }

    return [
        { label: "Proceed with your recommendation", value: "Proceed with your recommended default approach." },
        { label: "I will add more detail", value: "I will add more specific detail. Please continue with the key questions." },
        { label: "Show me common options", value: "Please show me 2 or 3 common options and explain the tradeoffs." },
        { label: "I'm not sure yet", value: "I'm not sure yet. Please continue with the safest default approach." }
    ];
}

function getReadinessRequirementLabel(
    requirementKey: ReadinessRequirementKey,
    language: "zh" | "en"
) {
    const labels: Record<ReadinessRequirementKey, { zh: string; en: string }> = {
        "business_context.product_goal": { zh: "产品目标", en: "product goal" },
        "business_context.target_users": { zh: "目标用户", en: "target users" },
        "business_context.user_journeys": { zh: "用户旅程", en: "user journeys" },
        "business_context.constraints_or_risks": { zh: "约束与风险", en: "constraints and risks" },
        "boundaries.bounded_contexts": { zh: "限界上下文", en: "bounded contexts" },
        "boundaries.module_responsibilities": { zh: "模块职责", en: "module responsibilities" },
        "boundaries.data_ownership": { zh: "数据归属", en: "data ownership" },
        "decisions.decision_records": { zh: "架构决策", en: "architecture decisions" },
        "decisions.integration_contracts": { zh: "集成契约", en: "integration contracts" },
        "decisions.non_functional_requirements": { zh: "非功能性需求", en: "non-functional requirements" },
        "guardrails.implementation_order": { zh: "实现顺序", en: "implementation order" },
        "guardrails.acceptance_criteria": { zh: "验收标准", en: "acceptance criteria" },
        "guardrails.test_strategy": { zh: "测试策略", en: "test strategy" },
        "ui.key_screens": { zh: "关键界面", en: "key screens" },
        "ui.shared_components": { zh: "共享 UI 组件", en: "shared UI components" },
        "ui.responsive_strategy": { zh: "响应式策略", en: "responsive strategy" }
    };

    return labels[requirementKey][language];
}

function isSingleScreenScopeCandidate(
    architecturePack: ArchitecturePack,
    messages: Message[]
) {
    const keyScreenCount = architecturePack.experienceConstraints.keyScreens.filter((item) => item.trim().length > 0).length;
    if (keyScreenCount !== 1) return false;

    const messageContext = messages
        .slice(-12)
        .map((message) => message.content)
        .join(" ");

    return /single screen|only the main|main calculator interface|only one screen|一个主界面|单屏|只有.*界面|仅需.*界面/i.test(messageContext) ||
        /calculator|计算器/i.test(`${architecturePack.businessContext.productGoal} ${architecturePack.experienceConstraints.keyScreens.join(" ")}`);
}

function buildFocusedRequirementQuestion(
    language: "zh" | "en",
    requirementKey: ReadinessRequirementKey,
    architecturePack: ArchitecturePack,
    messages: Message[]
) {
    if (requirementKey === "decisions.non_functional_requirements") {
        const content = language === "zh"
            ? `当前判断：
- 现在只缺一个额外的非功能性需求就能通过当前门槛。
- 对这个计算器类产品，我推荐补充“准确性”，因为它直接决定计算结果是否可靠。

需要确认：
是否按推荐把“准确性”加入架构包？`
            : `Current view:
- You only need one more non-functional requirement to clear the current gate.
- For a calculator-style product, I recommend adding accuracy because reliable results are core to the product.

Please confirm:
Should I add accuracy to the architecture pack now?`;

        const questionText = language === "zh"
            ? "是否按推荐把“准确性”加入架构包？"
            : "Should I add accuracy to the architecture pack now?";

        return {
            content,
            options: language === "zh"
                ? [
                    { label: "按推荐添加准确性", value: "请按推荐添加准确性。", action: "fill_requirement" as const, requirementKey },
                    { label: "我来指定其他需求", value: "我来指定另一个非功能性需求。" },
                    { label: "列出当前阻塞项", value: "请列出当前阻塞项。", action: "show_blockers" as const, requirementKey }
                ]
                : [
                    { label: "Add accuracy", value: "Add accuracy as recommended.", action: "fill_requirement" as const, requirementKey },
                    { label: "I will specify another one", value: "I will specify a different non-functional requirement." },
                    { label: "List blockers", value: "List the current blockers.", action: "show_blockers" as const, requirementKey }
                ],
            questionKey: normalizeQuestionKey(questionText),
            questionAction: "fill_requirement" as const,
            questionRequirementKey: requirementKey
        };
    }

    if (requirementKey === "ui.key_screens" && isSingleScreenScopeCandidate(architecturePack, messages)) {
        const content = language === "zh"
            ? `当前判断：
- 你已经明确这是一个单屏工作流产品，只有主计算界面是有意为之。
- 对这种范围较窄的工具型产品，更合理的做法是应用“单屏例外”，而不是强行补出 3 个伪界面。

需要确认：
是否按推荐应用单屏例外，并放行这个 UI 门槛？`
            : `Current view:
- You already defined this as an intentional single-screen workflow.
- For a narrow utility product, the better default is to apply a single-screen exception instead of inventing fake supporting screens.

Please confirm:
Should I apply the single-screen exception and waive this UI threshold?`;

        const questionText = language === "zh"
            ? "是否按推荐应用单屏例外，并放行这个 UI 门槛？"
            : "Should I apply the single-screen exception and waive this UI threshold?";

        return {
            content,
            options: language === "zh"
                ? [
                    { label: "应用单屏例外", value: "请应用单屏例外。", action: "fill_requirement" as const, requirementKey },
                    { label: "我来手动定义屏幕", value: "我来手动定义关键界面。" },
                    { label: "列出当前阻塞项", value: "请列出当前阻塞项。", action: "show_blockers" as const, requirementKey }
                ]
                : [
                    { label: "Apply single-screen exception", value: "Apply the single-screen exception.", action: "fill_requirement" as const, requirementKey },
                    { label: "I will define screens manually", value: "I will define the key screens manually." },
                    { label: "List blockers", value: "List the current blockers.", action: "show_blockers" as const, requirementKey }
                ],
            questionKey: normalizeQuestionKey(questionText),
            questionAction: "fill_requirement" as const,
            questionRequirementKey: requirementKey
        };
    }

    const label = getReadinessRequirementLabel(requirementKey, language);
    const content = language === "zh"
        ? `当前判断：
- 当前主要缺口是“${label}”。
- 我建议先把这一项补齐，因为它是现在最直接的阻塞项。

需要确认：
是否先集中补齐这个缺口？`
        : `Current view:
- The primary gap right now is ${label}.
- I recommend fixing this first because it is the most direct blocker.

Please confirm:
Should we focus on this gap first?`;
    const questionText = language === "zh" ? "是否先集中补齐这个缺口？" : "Should we focus on this gap first?";

    return {
        content,
        options: language === "zh"
            ? [
                { label: "按推荐继续", value: "按推荐继续补齐这个缺口。", action: "fill_requirement" as const, requirementKey },
                { label: "列出当前阻塞项", value: "请列出所有当前阻塞项。", action: "show_blockers" as const, requirementKey },
                { label: "我来手动补充", value: `我来手动补充${label}。` }
            ]
            : [
                { label: "Proceed with recommendation", value: "Proceed with the recommended fix.", action: "fill_requirement" as const, requirementKey },
                { label: "List blockers", value: "List all current blockers.", action: "show_blockers" as const, requirementKey },
                { label: "I will fill it manually", value: `I will fill ${label} manually.` }
            ],
        questionKey: normalizeQuestionKey(questionText),
        questionAction: "fill_requirement" as const,
        questionRequirementKey: requirementKey
    };
}

function buildBlockersSummary(
    language: "zh" | "en",
    readiness: ReadinessChecklist
) {
    const incompleteRequirements = readiness.criteria.flatMap((criterion) =>
        criterion.requirements.filter((requirement) => requirement.status === "missing" || requirement.status === "partial")
    );

    if (incompleteRequirements.length === 0) {
        return language === "zh" ? "当前没有未完成的 readiness 阻塞项。" : "There are no remaining readiness blockers.";
    }

    const lines = incompleteRequirements
        .slice(0, 6)
        .map((requirement) => `- ${getReadinessRequirementLabel(requirement.key, language)}: ${requirement.missing[0] || "Needs more detail."}`);

    return [
        language === "zh" ? "当前阻塞项：" : "Current blockers:",
        ...lines
    ].join("\n");
}

function buildPrdSummaryLines(
    language: "zh" | "en",
    evaluation: EvaluationResponse | null,
    architecturePack: ArchitecturePack,
    readiness: ReadinessChecklist
) {
    const lines: string[] = [];

    if (architecturePack.businessContext.productGoal.trim()) {
        lines.push(architecturePack.businessContext.productGoal.trim());
    }

    if (evaluation?.analysis?.clarified?.length) {
        lines.push(...evaluation.analysis.clarified.slice(0, 3).map((item) => clipText(item, 180)));
    }

    if (lines.length === 0) {
        lines.push(
            language === "zh"
                ? `当前 Readiness ${Math.round(readiness.score)}%，请继续补充产品目标与关键流程。`
                : `Current readiness is ${Math.round(readiness.score)}%. Continue clarifying the product goal and key flows.`
        );
    }

    return lines.slice(0, 4);
}

function buildPrdConversationSignals(
    language: "zh" | "en",
    messages: Message[]
) {
    const confirmations = buildResolvedConfirmationLog(messages, 4).map((item) =>
        language === "zh"
            ? `已确认：${clipText(item.question, 72)} -> ${clipText(item.answer, 96)}`
            : `Confirmed: ${clipText(item.question, 72)} -> ${clipText(item.answer, 96)}`
    );

    const recentUserNotes = messages
        .filter((message) => message.role === "user" && message.content.trim().length > 0)
        .slice(-4)
        .map((message) =>
            language === "zh"
                ? `用户：${clipText(message.content.trim(), 140)}`
                : `User: ${clipText(message.content.trim(), 140)}`
        );

    return [...confirmations, ...recentUserNotes].slice(0, 6);
}

function buildPrdArchitectureSnapshot(
    language: "zh" | "en",
    architecturePack: ArchitecturePack,
    readiness: ReadinessChecklist
) {
    const items: string[] = [];

    if (architecturePack.businessContext.targetUsers.length > 0) {
        items.push(
            language === "zh"
                ? `目标用户：${architecturePack.businessContext.targetUsers.slice(0, 3).join("、")}`
                : `Target users: ${architecturePack.businessContext.targetUsers.slice(0, 3).join(", ")}`
        );
    }

    if (architecturePack.businessContext.userJourneys.length > 0) {
        items.push(
            language === "zh"
                ? `关键流程：${architecturePack.businessContext.userJourneys.slice(0, 3).join("；")}`
                : `Key journeys: ${architecturePack.businessContext.userJourneys.slice(0, 3).join("; ")}`
        );
    }

    if (architecturePack.boundedContexts.length > 0) {
        items.push(
            language === "zh"
                ? `限界上下文：${architecturePack.boundedContexts.slice(0, 3).map((item) => item.name).join("、")}`
                : `Bounded contexts: ${architecturePack.boundedContexts.slice(0, 3).map((item) => item.name).join(", ")}`
        );
    }

    if (architecturePack.experienceConstraints.keyScreens.length > 0) {
        items.push(
            language === "zh"
                ? `关键界面：${architecturePack.experienceConstraints.keyScreens.slice(0, 3).join("、")}`
                : `Key screens: ${architecturePack.experienceConstraints.keyScreens.slice(0, 3).join(", ")}`
        );
    }

    items.push(
        language === "zh"
            ? `当前 Readiness：${Math.round(readiness.score)}%`
            : `Current readiness: ${Math.round(readiness.score)}%`
    );

    return items;
}

function buildBlockedGenerateQuestion(
    language: "zh" | "en",
    architectureStage: ArchitectureStage,
    readiness: ReadinessChecklist,
    architecturePack: ArchitecturePack,
    messages: Message[]
) {
    const stageLabel = getArchitectureStageLabel(language, architectureStage);
    const primaryBlocker = translateReadinessText(
        language,
        readiness.blockingIssues[0] || "Add the missing architecture detail before generation."
    );
    const primaryRequirement = getPrimaryIncompleteReadinessRequirement(readiness);

    if (!readiness.functionalReady || !readiness.uiReady) {
        const content = language === "zh"
            ? `当前判断：
- 现在还不能开始生成代码脚手架。
- 当前阶段仍是 ${stageLabel}，Readiness ${Math.round(readiness.score)}%。主要阻塞项：${primaryBlocker}

需要确认：
请先补齐这个缺口，或者继续让我完善架构包。`
            : `Current view:
- Scaffold generation is still blocked.
- The architect stage is still ${stageLabel} and readiness is ${Math.round(readiness.score)}%. Primary blocker: ${primaryBlocker}

Please confirm:
Should we fill this gap first, or should I continue refining the architecture pack?`;

        const options = language === "zh"
            ? [
                {
                    label: "我来补充这个缺口",
                    value: "我来补充这个缺口，请继续问我最关键的问题。",
                    action: "focus_requirement" as const,
                    requirementKey: primaryRequirement?.key
                },
                {
                    label: "列出当前阻塞项",
                    value: "请明确列出当前阻塞生成的缺口，并告诉我先补哪一个。",
                    action: "show_blockers" as const,
                    requirementKey: primaryRequirement?.key
                },
                {
                    label: primaryRequirement?.key === "ui.key_screens" && isSingleScreenScopeCandidate(architecturePack, messages)
                        ? "按推荐应用单屏例外"
                        : "按默认方案继续完善",
                    value: "按你推荐的默认方案继续完善架构包。",
                    action: "fill_requirement" as const,
                    requirementKey: primaryRequirement?.key
                }
            ]
            : [
                {
                    label: "I will fill the gap",
                    value: "I will fill this gap. Please ask me the most important missing question.",
                    action: "focus_requirement" as const,
                    requirementKey: primaryRequirement?.key
                },
                {
                    label: "List blockers",
                    value: "Please list the current generation blockers and tell me which one to fix first.",
                    action: "show_blockers" as const,
                    requirementKey: primaryRequirement?.key
                },
                {
                    label: primaryRequirement?.key === "ui.key_screens" && isSingleScreenScopeCandidate(architecturePack, messages)
                        ? "Apply single-screen exception"
                        : "Keep refining",
                    value: "Continue refining the architecture pack using your recommended default approach.",
                    action: "fill_requirement" as const,
                    requirementKey: primaryRequirement?.key
                }
            ];

        const questionText = language === "zh"
            ? "请先补齐这个缺口，或者继续让我完善架构包。"
            : "Should we fill this gap first, or should I continue refining the architecture pack?";

        return {
            content,
            options,
            questionKey: normalizeQuestionKey(questionText),
            questionAction: primaryRequirement ? "fill_requirement" as const : undefined,
            questionRequirementKey: primaryRequirement?.key
        };
    }
    const content = language === "zh"
        ? `当前判断：
- 当前阻塞项已经解除，可以进入脚手架生成阶段。

需要确认：
是否现在开始生成代码脚手架？`
        : `Current view:
- The current blockers are cleared and scaffold generation can proceed.

Please confirm:
Do you want to start scaffold generation now?`;
    const questionText = language === "zh"
        ? "是否现在开始生成代码脚手架？"
        : "Do you want to start scaffold generation now?";

    return {
        content,
        options: buildCommonFallbackOptions(language, "generate_scaffold"),
        questionKey: normalizeQuestionKey(questionText),
        questionAction: "generate_scaffold" as const,
        questionRequirementKey: undefined
    };
}

function ensureCommonQuestionOptions(
    questionText: string,
    options: MessageOption[],
    contextText: string,
    questionAction: MessageAction | null = null,
    questionKey?: string | null,
    requirementKey?: ReadinessRequirementKey | null,
    forcedLanguage?: WorkspaceLanguage
) {
    const normalizedQuestion = questionText.trim();
    const effectiveQuestionAction = questionAction ?? inferQuestionAction(normalizedQuestion);
    const normalized = options.reduce<MessageOption[]>((acc, option) => {
        acc.push({
            ...option,
            action: resolveOptionAction(option, effectiveQuestionAction) ?? undefined,
            questionKey: questionKey ?? option.questionKey ?? undefined,
            requirementKey: requirementKey ?? option.requirementKey ?? undefined
        });
        return acc;
    }, []);
    if (!normalizedQuestion) return normalized;

    const languageSeed = normalized.length > 0
        ? normalized.map((option) => `${option.label} ${option.value}`).join(" ")
        : `${normalizedQuestion} ${contextText}`;
    const language = forcedLanguage ?? detectResponseLanguage(languageSeed);
    const seen = new Set(
        normalized.map((option) => `${option.label.trim().toLowerCase()}::${option.value.trim().toLowerCase()}::${option.action || ""}`)
    );
    if (normalized.length >= 2) return normalized.slice(0, 4);

    const common = buildCommonFallbackOptions(language, effectiveQuestionAction);

    for (const option of common) {
        if (normalized.length >= 4) break;
        const key = `${option.label.toLowerCase()}::${option.value.toLowerCase()}::${option.action || ""}`;
        if (seen.has(key)) continue;
        normalized.push({
            ...option,
            questionKey: questionKey ?? option.questionKey,
            requirementKey: requirementKey ?? option.requirementKey
        });
        seen.add(key);
    }

    return normalized.slice(0, 4);
}

function extractFallbackAssistantText(raw: string) {
    const normalized = raw.replace(/\r\n/g, "\n").trim();
    if (!normalized) return "";

    const questionMatch = normalized.match(/<question>([\s\S]*?)(?:<\/question>|$)/i);
    if (questionMatch && questionMatch[1]) {
        const questionText = buildAssistantDisplayContent(questionMatch[1]);
        if (questionText) return questionText;
    }

    const plainText = normalized
        .replace(/<thinking>[\s\S]*?(?:<\/thinking>|$)/gi, " ")
        .replace(/<diagram>[\s\S]*?(?:<\/diagram>|$)/gi, " ")
        .replace(/<analysis_clarified>[\s\S]*?(?:<\/analysis_clarified>|$)/gi, " ")
        .replace(/<analysis_missing>[\s\S]*?(?:<\/analysis_missing>|$)/gi, " ")
        .replace(/<architecture_pack>[\s\S]*?(?:<\/architecture_pack>|$)/gi, " ")
        .replace(/<decision_records>[\s\S]*?(?:<\/decision_records>|$)/gi, " ")
        .replace(/<guardrails>[\s\S]*?(?:<\/guardrails>|$)/gi, " ")
        .replace(/<readiness>[\s\S]*?(?:<\/readiness>|$)/gi, " ")
        .replace(/<analysis_ui>[\s\S]*?(?:<\/analysis_ui>|$)/gi, " ")
        .replace(/<analysis_ui_spec>[\s\S]*?(?:<\/analysis_ui_spec>|$)/gi, " ")
        .replace(/<density>[\s\S]*?(?:<\/density>|$)/gi, " ")
        .replace(/<is_ready>[\s\S]*?(?:<\/is_ready>|$)/gi, " ")
        .replace(/<stage>[\s\S]*?(?:<\/stage>|$)/gi, " ")
        .replace(/<options>[\s\S]*?(?:<\/options>|$)/gi, " ")
        .replace(/<\/?[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    if (!plainText) return "";
    return clipText(plainText, 600);
}

function parseOptionsBlock(raw: string): MessageOption[] {
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
        .filter((item): item is MessageOption => Boolean(item));

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
    uiDesignScore?: number;
    pricingBreakdown?: {
        conversationScore: number;
        detailScore: number;
        requirementScore: number;
        architectureScore: number;
        maturityScore: number;
        keywordScore: number;
        uiDesignScore: number;
        totalScore: number;
    };
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
    architecturePack: ArchitecturePack,
    decisionRecords: DecisionRecord[],
    guardrailChecklist: GuardrailChecklist,
    readinessOverrides: ReadinessOverride[],
    messages: Message[],
    maxChars: number = EVALUATE_DESIGN_MEMORY_CHARS
) {
    const normalizedAnalysis = normalizeAnalysis(evaluation?.analysis);
    const readiness = createReadinessChecklist(architecturePack, decisionRecords, guardrailChecklist, readinessOverrides);
    const minimumViableLoop = createMinimumViableLoopChecklist(
        architecturePack,
        decisionRecords,
        guardrailChecklist,
        readinessOverrides
    );
    const clarified = normalizedAnalysis.clarified;
    const resolvedConfirmations = buildResolvedConfirmationLog(messages);
    const resolvedQuestionKeys = new Set(
        resolvedConfirmations.map((item) => normalizeQuestionKey(item.questionKey))
    );
    const missing = normalizedAnalysis.missing.filter((item) => !resolvedQuestionKeys.has(normalizeQuestionKey(item)));
    const ui = normalizeUiRequirements(normalizedAnalysis.ui);
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
        "# Resolved Confirmations",
        resolvedConfirmations.length > 0
            ? resolvedConfirmations
                .map((item) => `- Q: ${clipText(item.question, 220)} | A: ${clipText(item.answer, 220)}`)
                .join("\n")
            : "- None",
        "",
        "# Outstanding Ambiguities",
        missing.length > 0
            ? missing.slice(0, 20).map((item) => `- ${clipText(item, 300)}`).join("\n")
            : "- None",
        "",
        "# Architecture Pack Snapshot",
        clipText(buildArchitecturePackScaffoldInput(architecturePack, decisionRecords, guardrailChecklist), 5000),
        "",
        "# Readiness Criteria",
        readiness.criteria
            .map((criterion) => `- ${criterion.label}: ${criterion.status} (${criterion.satisfiedCount}/${criterion.requiredCount})${criterion.missing.length > 0 ? ` | Missing: ${criterion.missing.join(" ; ")}` : ""}`)
            .join("\n"),
        "",
        "# Scope Overrides",
        readinessOverrides.length > 0
            ? readinessOverrides.map((override) => `- ${override.requirementKey}: ${clipText(override.rationale, 220)}`).join("\n")
            : "- None",
        "",
        "# Minimum Viable Loop",
        `- Ready: ${minimumViableLoop.ready ? "yes" : "no"}`,
        `- Score: ${minimumViableLoop.score}`,
        minimumViableLoop.blockingIssues.length > 0
            ? `- Blocking: ${minimumViableLoop.blockingIssues.join(" ; ")}`
            : "- Blocking: none",
        "",
        "# UI Requirement Profile",
        ...UI_REQUIREMENT_KEYS.map((key) => {
            const items = ui[key];
            const title = UI_REQUIREMENT_LABELS[key];
            if (items.length === 0) return `- ${title}: (missing)`;
            return `- ${title}: ${items.map((item) => clipText(item, 200)).join(" | ")}`;
        }),
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

function buildGenerateSummary(
    architecturePack: ArchitecturePack,
    decisionRecords: DecisionRecord[],
    guardrailChecklist: GuardrailChecklist,
    messages: Message[]
) {
    const recentMessages = messages.slice(-GENERATE_MAX_HISTORY_MESSAGES);
    const transcript = recentMessages
        .map((message) => `${message.role}: ${clipText((message.content || "").trim(), GENERATE_MAX_MESSAGE_CONTENT_CHARS)}`)
        .join("\n");
    const architecturePackText = clipText(
        buildArchitecturePackScaffoldInput(architecturePack, decisionRecords, guardrailChecklist),
        GENERATE_MAX_ANALYSIS_CHARS
    );
    return clipText(`${architecturePackText}\n\nRecent Conversation:\n${transcript}`.trim(), GENERATE_MAX_SUMMARY_CHARS);
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

function normalizeEvaluateNetworkError(error: unknown, endpoint: string) {
    if (error instanceof DOMException && error.name === "AbortError") {
        return null;
    }

    const message = error instanceof Error ? error.message : String(error || "");
    const normalized = message.trim();
    const lowered = normalized.toLowerCase();
    const isFetchNetworkError =
        error instanceof TypeError &&
        (
            lowered.includes("failed to fetch") ||
            lowered.includes("networkerror") ||
            lowered.includes("load failed") ||
            lowered.includes("fetch failed")
        );
    const mentionsClosedConnection =
        lowered.includes("err_connection_closed") ||
        lowered.includes("connection closed") ||
        lowered.includes("connection reset") ||
        lowered.includes("socket hang up");

    if (!isFetchNetworkError && !mentionsClosedConnection) {
        return null;
    }

    return `Network error calling ${endpoint}: the connection closed before a response arrived. This usually means the dev server, hosting proxy, or upstream AI stream dropped the request. Retry once; if it keeps happening, inspect the ${endpoint} server logs.`;
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
    sourceContext: string | null,
    generationReady: boolean,
    compactMode: boolean,
    designMemory: string | null,
    diagramPolicy: string,
    outputLanguage: WorkspaceLanguage
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
    const sourceContextText = sourceContext
        ? clipText(
            sourceContext,
            compactMode ? EVALUATE_COMPACT_SOURCE_CONTEXT_CHARS : EVALUATE_SOURCE_CONTEXT_CHARS
        )
        : null;
    const designMemoryText = designMemory
        ? clipText(
            designMemory,
            compactMode ? EVALUATE_COMPACT_DESIGN_MEMORY_CHARS : EVALUATE_DESIGN_MEMORY_CHARS
        )
        : null;

    return JSON.stringify({
        messages: evaluateMessages,
        context,
        sourceContext: sourceContextText,
        generationReady,
        designMemory: designMemoryText,
        diagramPolicy,
        outputLanguage
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

function compactSourceArtifactsForPricing(artifacts: SourceArtifact[]): SourceArtifact[] {
    return artifacts.slice(-12).map((artifact) => ({
        id: artifact.id,
        sourceType: artifact.sourceType,
        name: artifact.name,
        summary: clipText(artifact.summary || artifact.name, 160),
        mimeType: artifact.mimeType,
        createdAt: artifact.createdAt
    }));
}

function buildPricingProjectSnapshot(
    project: Project | null,
    currentVersion: ProjectVersion | null,
    messages: Message[],
    evaluation: EvaluationResponse | null,
    generation: GenerationResponse | null,
    currentDiagram: string,
    diagramGovernance: DiagramGovernance,
    tasks: Task[],
    designStage: DesignStage,
    uiDesignState: UiDesignState,
    uiDesignSpec: UiDesignSpec | null,
    architecturePack: ArchitecturePack,
    decisionRecords: DecisionRecord[],
    guardrailChecklist: GuardrailChecklist,
    readinessOverrides: ReadinessOverride[],
    sourceArtifacts: SourceArtifact[],
    architectureStage: ArchitectureStage,
    functionalLockedAt: number | null,
    uiReadyAt: number | null
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
        })),
        questionKey: message.questionKey,
        questionStatus: message.questionStatus,
        questionAction: message.questionAction,
        questionRequirementKey: message.questionRequirementKey,
        answeredQuestionKey: message.answeredQuestionKey,
        triggeredAction: message.triggeredAction
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
            paymentStatus: currentVersion.data.paymentStatus,
            designStage,
            uiDesignState,
            uiDesignSpec: uiDesignSpec ?? undefined,
            architecturePack,
            decisionRecords,
            guardrailChecklist,
            readinessOverrides,
            sourceArtifacts: compactSourceArtifactsForPricing(sourceArtifacts),
            architectureStage,
            functionalLockedAt,
            uiReadyAt
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
    const initialNormalizedState = normalizeVersionDesignState(cachedSnapshot?.data ?? null);
    const rawCachedStage = (cachedSnapshot?.data as { designStage?: unknown } | undefined)?.designStage;
    const initialEvaluation = initialNormalizedState.evaluation;
    const initialUiDesignSpec = initialNormalizedState.uiDesignSpec;
    const initialUiDesignState = initialNormalizedState.uiDesignState;
    const hasLegacyInitialUiStage = rawCachedStage === "ui_design";
    const initialDesignStage = hasLegacyInitialUiStage
        ? "functional_architecture"
        : initialNormalizedState.designStage;
    const initialFunctionalLockedAt = initialNormalizedState.functionalLockedAt;
    const initialUiReadyAt = initialNormalizedState.uiReadyAt;
    const SIDEBAR_MIN = 320;
    const SIDEBAR_MAX = 720;
    const MAIN_MIN = 420;

    // --- State ---
    const [project, setProject] = useState<Project | null>(cachedSnapshot?.project ?? null);
    const [currentVersion, setCurrentVersion] = useState<ProjectVersion | null>(cachedSnapshot?.version ?? null);
    const [isHydrating, setIsHydrating] = useState(false);
    const [loadedVersionId, setLoadedVersionId] = useState<string | null>(null);
    const [hasUserEdited, setHasUserEdited] = useState(false);

    const [messages, setMessages] = useState<Message[]>(initialNormalizedState.messages);
    const [input, setInput] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [messageWindow, setMessageWindow] = useState(MESSAGE_WINDOW_SIZE);

    // Core Domain State
    const [evaluation, setEvaluation] = useState<EvaluationResponse | null>(initialEvaluation);
    const [generation, setGeneration] = useState<GenerationResponse | null>(cachedSnapshot?.data.generation ?? null);
    const [tasks, setTasks] = useState<Task[]>(cachedSnapshot?.data.tasks ?? []);
    const [designStage, setDesignStage] = useState<DesignStage>(initialDesignStage);
    const [uiDesignState, setUiDesignState] = useState<UiDesignState>(initialUiDesignState);
    const [uiDesignSpec, setUiDesignSpec] = useState<UiDesignSpec | null>(initialUiDesignSpec);
    const [architecturePack, setArchitecturePack] = useState<ArchitecturePack>(initialNormalizedState.architecturePack);
    const [decisionRecords, setDecisionRecords] = useState<DecisionRecord[]>(initialNormalizedState.decisionRecords);
    const [guardrailChecklist, setGuardrailChecklist] = useState<GuardrailChecklist>(initialNormalizedState.guardrailChecklist);
    const [readinessOverrides, setReadinessOverrides] = useState<ReadinessOverride[]>(initialNormalizedState.readinessOverrides);
    const [sourceArtifacts, setSourceArtifacts] = useState<SourceArtifact[]>(initialNormalizedState.sourceArtifacts);
    const [architectureStage, setArchitectureStage] = useState<ArchitectureStage>(initialNormalizedState.architectureStage);
    const [architectureReadiness, setArchitectureReadiness] = useState<ReadinessChecklist>(initialNormalizedState.readiness);
    const [functionalLockedAt, setFunctionalLockedAt] = useState<number | null>(initialFunctionalLockedAt);
    const [uiReadyAt, setUiReadyAt] = useState<number | null>(initialUiReadyAt);

    // UI State
    const [isGenerating, setIsGenerating] = useState(false);
    const [isCheckingOut, setIsCheckingOut] = useState(false);
    const [isQuoteLoading, setIsQuoteLoading] = useState(false);
    const [checkoutQuote, setCheckoutQuote] = useState<CheckoutQuote | null>(null);
    const [generateError, setGenerateError] = useState<string | null>(null);
    const [isAdmin, setIsAdmin] = useState(false);
    const [isAdminStatusLoaded, setIsAdminStatusLoaded] = useState(false);
    const [sidebarWidth, setSidebarWidth] = useState(420);
    const [handoffImportFeedback, setHandoffImportFeedback] = useState<{
        type: "success" | "error";
        message: string;
    } | null>(null);
    const isResizingRef = useRef(false);
    const generateInFlightRef = useRef(false);
    const evaluateAbortRef = useRef<AbortController | null>(null);
    const evalRequestIdRef = useRef(0);

    // Chat Attachments
    const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const validationReportInputRef = useRef<HTMLInputElement>(null);

    const [currentDiagram, setCurrentDiagram] = useState(
        cachedSnapshot?.data.currentDiagram || "graph TD\nStart[Waiting for input...]"
    );
    const [diagramGovernance, setDiagramGovernance] = useState<DiagramGovernance>(
        normalizeDiagramGovernance(cachedSnapshot?.data.diagramGovernance)
    );

    const [activeTab, setActiveTab] = useState<'architecture' | 'prd' | 'files' | 'stack'>(
        cachedSnapshot?.data.generation ? 'files' : 'architecture'
    );

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const workspaceLanguage = getProjectWorkspaceLanguage(project);
    const uiText = getWorkspaceUiText(workspaceLanguage);
    const handoffValidation = resolveGenerationHandoffValidation(generation);
    const baseMessageIndex = Math.max(0, messages.length - messageWindow);
    const visibleMessages = messages.slice(baseMessageIndex);
    const hiddenMessageCount = baseMessageIndex;
    const hasPaid = currentVersion?.data.paymentStatus === "paid";
    const requiresPayment = !hasPaid && !isAdmin;
    const scaffoldEligibility = computeScaffoldEligibility({
        architecturePack,
        decisionRecords,
        guardrailChecklist,
        readinessOverrides
    });
    const minimumViableLoop = scaffoldEligibility.minimumViableLoop;
    const minimumViableLoopReady = minimumViableLoop.ready;
    const architectureCompletion = scaffoldEligibility.readiness.score;
    const minimumLoopBlockers = scaffoldEligibility.blockingReasons.length > 0
        ? scaffoldEligibility.blockingReasons
        : minimumViableLoop.blockingIssues;
    const isReadyToGenerateStage = scaffoldEligibility.canGenerate;
    const architectureViewerCode = currentDiagram;
    const isConversationLocked = Boolean(generation);
    const lockedChatDescription = workspaceLanguage === "zh"
        ? "当前版本的脚手架已生成，聊天输入现已关闭。"
        : "This version's scaffold has been generated. Chat input is now disabled.";
    const lockedInputPlaceholder = workspaceLanguage === "zh"
        ? "当前版本已完成脚手架生成，无法继续输入。"
        : "This version is locked after scaffold generation.";

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
            const normalizedDesignState = normalizeVersionDesignState(data);
            setMessages(normalizedDesignState.messages);
            setMessageWindow(MESSAGE_WINDOW_SIZE);
            setEvaluation(normalizedDesignState.evaluation);
            setGeneration(data.generation);
            setCurrentDiagram(data.currentDiagram);
            setDiagramGovernance(normalizeDiagramGovernance(data.diagramGovernance));
            setTasks(data.tasks);
            setDesignStage(normalizedDesignState.designStage);
            setUiDesignState(normalizedDesignState.uiDesignState);
            setUiDesignSpec(normalizedDesignState.uiDesignSpec);
            setArchitecturePack(normalizedDesignState.architecturePack);
            setDecisionRecords(normalizedDesignState.decisionRecords);
            setGuardrailChecklist(normalizedDesignState.guardrailChecklist);
            setReadinessOverrides(normalizedDesignState.readinessOverrides);
            setSourceArtifacts(normalizedDesignState.sourceArtifacts);
            setArchitectureStage(normalizedDesignState.architectureStage);
            setArchitectureReadiness(normalizedDesignState.readiness);
            setFunctionalLockedAt(normalizedDesignState.functionalLockedAt);
            setUiReadyAt(normalizedDesignState.uiReadyAt);

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
            setGenerateError(uiText.paymentCancelled);
        }

        const params = new URLSearchParams();
        params.set("projectId", projectId);
        params.set("versionId", currentVersion.id);
        router.replace(`/wizard?${params.toString()}`);
    }, [searchParams, currentVersion, projectId, router, isAdmin, uiText.paymentCancelled]);

    // 1f. Refresh derived state from architecture pack + experience constraints.
    useEffect(() => {
        const now = Date.now();
        const nextReadiness = createUiReadinessReport(uiDesignSpec, evaluation, now);
        const readinessChanged =
            nextReadiness.score !== uiDesignState.readiness.score ||
            nextReadiness.completed !== uiDesignState.readiness.completed ||
            !areArrayValuesEqual(nextReadiness.missingKeys, uiDesignState.readiness.missingKeys) ||
            !areArrayValuesEqual(nextReadiness.missingLabels, uiDesignState.readiness.missingLabels);

        const normalizedArchitecturePack = normalizeArchitecturePack(
            architecturePack,
            uiDesignSpec ? deriveUiRequirements(uiDesignSpec) : evaluation?.analysis?.ui
        );
        const packChanged = JSON.stringify(normalizedArchitecturePack) !== JSON.stringify(architecturePack);
        const nextScaffoldEligibility = computeScaffoldEligibility({
            architecturePack: normalizedArchitecturePack,
            decisionRecords,
            guardrailChecklist,
            readinessOverrides
        });
        const nextArchitectureStage = normalizeArchitectureStage(
            evaluation?.stage ?? architectureStage,
            normalizedArchitecturePack,
            decisionRecords,
            guardrailChecklist,
            readinessOverrides
        );
        const nextArchitectureReadiness = applyArchitectureStageScoreFloor(nextScaffoldEligibility.readiness);
        const architectureReadinessChanged =
            JSON.stringify(nextArchitectureReadiness) !== JSON.stringify(architectureReadiness);
        const architectureStageChanged = nextArchitectureStage !== architectureStage;
        const nextStage = nextScaffoldEligibility.designStage;
        const stageChanged = nextStage !== designStage;
        const nextNeedsResync = nextStage === "functional_architecture" ? uiDesignState.needsResync : false;
        const needsResyncChanged = nextNeedsResync !== uiDesignState.needsResync;
        const nextSourceArtifacts = extractSourceArtifacts(messages);
        const sourceArtifactsChanged = JSON.stringify(nextSourceArtifacts) !== JSON.stringify(sourceArtifacts);

        const nextFunctionalLockedAt = nextStage === "functional_architecture" ? null : (functionalLockedAt ?? now);
        const functionalLockedAtChanged = nextFunctionalLockedAt !== functionalLockedAt;

        const nextUiReadyAt = nextStage === "ready_to_generate" ? (uiReadyAt ?? now) : null;
        const uiReadyAtChanged = nextUiReadyAt !== uiReadyAt;

        if (
            !readinessChanged &&
            !packChanged &&
            !architectureReadinessChanged &&
            !architectureStageChanged &&
            !sourceArtifactsChanged &&
            !stageChanged &&
            !needsResyncChanged &&
            !functionalLockedAtChanged &&
            !uiReadyAtChanged
        ) {
            return;
        }

        setHasUserEdited(true);
        if (packChanged) setArchitecturePack(normalizedArchitecturePack);
        if (architectureReadinessChanged) setArchitectureReadiness(nextArchitectureReadiness);
        if (architectureStageChanged) setArchitectureStage(nextArchitectureStage);
        if (sourceArtifactsChanged) setSourceArtifacts(nextSourceArtifacts);
        if (stageChanged) setDesignStage(nextStage);
        if (readinessChanged || needsResyncChanged) {
            setUiDesignState({
                needsResync: nextNeedsResync,
                readiness: readinessChanged ? nextReadiness : uiDesignState.readiness
            });
        }
        if (functionalLockedAtChanged) setFunctionalLockedAt(nextFunctionalLockedAt);
        if (uiReadyAtChanged) setUiReadyAt(nextUiReadyAt);
    }, [
        evaluation,
        uiDesignSpec,
        uiDesignState,
        architecturePack,
        decisionRecords,
        guardrailChecklist,
        readinessOverrides,
        architectureReadiness,
        architectureStage,
        sourceArtifacts,
        messages,
        designStage,
        functionalLockedAt,
        uiReadyAt
    ]);

    // 1g. Fetch complexity-based quote for unpaid projects
    useEffect(() => {
        if (!projectId || !isReadyToGenerateStage || hasPaid || isAdmin || !isAdminStatusLoaded) {
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
                            tasks,
                            designStage,
                            uiDesignState,
                            uiDesignSpec,
                            architecturePack,
                            decisionRecords,
                            guardrailChecklist,
                            readinessOverrides,
                            sourceArtifacts,
                            architectureStage,
                            functionalLockedAt,
                            uiReadyAt
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
        isReadyToGenerateStage,
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
        tasks,
        designStage,
        uiDesignState,
        uiDesignSpec,
        architecturePack,
        decisionRecords,
        guardrailChecklist,
        readinessOverrides,
        sourceArtifacts,
        architectureStage,
        functionalLockedAt,
        uiReadyAt
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
                paymentStatus: currentVersion.data.paymentStatus,
                designStage,
                uiDesignState,
                uiDesignSpec: uiDesignSpec ?? undefined,
                architecturePack,
                decisionRecords,
                guardrailChecklist,
                readinessOverrides,
                sourceArtifacts,
                architectureStage,
                functionalLockedAt,
                uiReadyAt
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
        designStage,
        uiDesignState,
        uiDesignSpec,
        architecturePack,
        decisionRecords,
        guardrailChecklist,
        readinessOverrides,
        sourceArtifacts,
        architectureStage,
        functionalLockedAt,
        uiReadyAt,
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
        if (isConversationLocked) {
            if (fileInputRef.current) fileInputRef.current.value = "";
            return;
        }

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
        if (isConversationLocked) {
            e.preventDefault();
            return;
        }

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

    const buildAssistantQuestionMessage = (input: {
        content: string;
        options?: MessageOption[];
        questionKey?: string | null;
        questionAction?: MessageAction | null;
        questionRequirementKey?: ReadinessRequirementKey | null;
    }): Message => ({
        role: "assistant",
        content: input.content,
        options: input.options,
        questionKey: input.questionKey ?? undefined,
        questionStatus: input.questionKey ? "pending" : undefined,
        questionAction: input.questionAction ?? undefined,
        questionRequirementKey: input.questionRequirementKey ?? undefined
    });

    const buildReadyToGenerateMessage = (
        language: "zh" | "en"
    ) => {
        const content = language === "zh"
            ? `当前判断：
- 当前架构门槛已经补齐。
- 现在可以进入脚手架生成阶段。 

需要确认：
是否现在开始生成代码脚手架？`
            : `Current view:
- The current architecture gate is now satisfied.
- You can proceed to scaffold generation.

Please confirm:
Do you want to start scaffold generation now?`;
        const questionText = language === "zh"
            ? "是否现在开始生成代码脚手架？"
            : "Do you want to start scaffold generation now?";
        return {
            content,
            options: buildCommonFallbackOptions(language, "generate_scaffold").map((option) => ({
                ...option,
                action: option.action ?? (option.label.toLowerCase().includes("generate") || option.label.includes("生成")
                    ? "generate_scaffold"
                    : option.action)
            })),
            questionKey: normalizeQuestionKey(questionText),
            questionAction: "generate_scaffold" as const
        };
    };

    const buildRequirementAlternativesMessage = (
        language: "zh" | "en",
        requirementKey: ReadinessRequirementKey
    ) => {
        return buildAssistantQuestionMessage({
            content: buildBlockersSummary(language, scaffoldEligibility.readiness),
            options: language === "zh"
                ? [
                    { label: "按推荐继续", value: "按推荐继续。", action: "fill_requirement", requirementKey },
                    { label: "我来手动补充", value: "我来手动补充。" }
                ]
                : [
                    { label: "Proceed with recommendation", value: "Proceed with the recommendation.", action: "fill_requirement", requirementKey },
                    { label: "I will fill it manually", value: "I will fill it manually." }
                ],
            questionKey: normalizeQuestionKey(language === "zh" ? "是否按推荐继续补齐这个缺口？" : "Should I proceed with the recommended fix?"),
            questionAction: "fill_requirement",
            questionRequirementKey: requirementKey
        });
    };

    const applyDefaultRequirementResolution = (
        requirementKey: ReadinessRequirementKey,
        language: "zh" | "en",
        baseMessages: Message[]
    ) => {
        if (requirementKey === "decisions.non_functional_requirements") {
            const existingText = architecturePack.nonFunctionalRequirements
                .map((item) => `${item.category} ${item.requirement} ${item.rationale}`.toLowerCase());
            const existing = new Set(
                architecturePack.nonFunctionalRequirements
                    .map((item) => `${item.category} ${item.requirement} ${item.rationale}`.toLowerCase())
            );
            const candidates = [
                {
                    category: language === "zh" ? "质量" : "quality",
                    requirement: language === "zh" ? "准确性" : "Accuracy",
                    rationale: language === "zh"
                        ? "确保基础四则运算在各种输入下都返回可靠且一致的结果。"
                        : "Ensure the core arithmetic operations always return reliable and consistent results."
                },
                {
                    category: language === "zh" ? "体验" : "usability",
                    requirement: language === "zh" ? "易用性" : "Usability",
                    rationale: language === "zh"
                        ? "让日常计算在最少步骤内完成，降低误触和理解成本。"
                        : "Keep daily calculations easy to complete with minimal friction and low cognitive load."
                }
            ];
            const nextRequirement = candidates.find((candidate) =>
                !existing.has(`${candidate.category} ${candidate.requirement} ${candidate.rationale}`.toLowerCase()) &&
                !existingText.some((item) => item.includes(candidate.requirement.toLowerCase()))
            );
            if (nextRequirement) {
                return {
                    architecturePack: {
                        ...architecturePack,
                        nonFunctionalRequirements: [...architecturePack.nonFunctionalRequirements, nextRequirement]
                    },
                    guardrailChecklist,
                    readinessOverrides,
                    summary: language === "zh"
                        ? `已按推荐补充非功能性需求“${nextRequirement.requirement}”。`
                        : `Added the recommended non-functional requirement: ${nextRequirement.requirement}.`,
                    applied: true
                };
            }
        }

        if (requirementKey === "ui.key_screens") {
            if (isSingleScreenScopeCandidate(architecturePack, baseMessages)) {
                const nextOverrides = normalizeReadinessOverrides([
                    ...readinessOverrides,
                    {
                        key: "single_screen_experience",
                        requirementKey: "ui.key_screens",
                        rationale: language === "zh"
                            ? "该产品明确采用单屏工作流，主计算界面已覆盖核心使用场景，因此豁免 3 个 key screens 的默认门槛。"
                            : "This product intentionally uses a single-screen workflow, so the default 3-screen threshold is waived."
                    }
                ]);
                return {
                    architecturePack,
                    guardrailChecklist,
                    readinessOverrides: nextOverrides,
                    summary: language === "zh"
                        ? "已按推荐应用单屏例外，并豁免 key screens 的默认数量门槛。"
                        : "Applied the recommended single-screen exception and waived the default key-screen threshold.",
                    applied: true
                };
            }

            const existingScreens = architecturePack.experienceConstraints.keyScreens.filter((item) => item.trim().length > 0);
            const fallbackScreens = language === "zh"
                ? ["主工作界面", "历史记录界面", "设置界面"]
                : ["Main workspace", "History screen", "Settings screen"];
            const mergedScreens = [...new Set([...existingScreens, ...fallbackScreens])].slice(0, 3);
            return {
                architecturePack: {
                    ...architecturePack,
                    experienceConstraints: {
                        ...architecturePack.experienceConstraints,
                        keyScreens: mergedScreens
                    }
                },
                guardrailChecklist,
                readinessOverrides,
                summary: language === "zh"
                    ? "已按推荐补齐关键界面定义。"
                    : "Filled the key screen definitions using the recommended defaults.",
                applied: true
            };
        }

        return {
            architecturePack,
            guardrailChecklist,
            readinessOverrides,
            summary: "",
            applied: false
        };
    };

    const appendDeterministicAssistantResponse = (
        baseMessages: Message[],
        assistantMessage: Message
    ) => {
        setMessages([...baseMessages, assistantMessage]);
    };

    const handleRequirementAction = (
        action: "focus_requirement" | "fill_requirement" | "show_blockers",
        requirementKey: ReadinessRequirementKey | null,
        baseMessages: Message[]
    ) => {
        if (!requirementKey) return false;
        if (!findReadinessRequirement(scaffoldEligibility.readiness, requirementKey)) return false;

        const language = workspaceLanguage;

        if (action === "focus_requirement") {
            const focused = buildFocusedRequirementQuestion(language, requirementKey, architecturePack, baseMessages);
            appendDeterministicAssistantResponse(baseMessages, buildAssistantQuestionMessage(focused));
            return true;
        }

        if (action === "show_blockers") {
            appendDeterministicAssistantResponse(
                baseMessages,
                buildRequirementAlternativesMessage(language, requirementKey)
            );
            return true;
        }

        const resolution = applyDefaultRequirementResolution(requirementKey, language, baseMessages);
        if (!resolution.applied) {
            const focused = buildFocusedRequirementQuestion(language, requirementKey, architecturePack, baseMessages);
            appendDeterministicAssistantResponse(baseMessages, buildAssistantQuestionMessage(focused));
            return true;
        }

        setHasUserEdited(true);
        setArchitecturePack(resolution.architecturePack);
        setGuardrailChecklist(resolution.guardrailChecklist);
        setReadinessOverrides(resolution.readinessOverrides);

        const nextEligibility = computeScaffoldEligibility({
            architecturePack: resolution.architecturePack,
            decisionRecords,
            guardrailChecklist: resolution.guardrailChecklist,
            readinessOverrides: resolution.readinessOverrides
        });
        const nextStage = inferArchitectureStage(
            resolution.architecturePack,
            decisionRecords,
            resolution.guardrailChecklist,
            resolution.readinessOverrides
        );
        setArchitectureReadiness(nextEligibility.readiness);
        setArchitectureStage(nextStage);
        setEvaluation((prev) => prev
            ? {
                ...prev,
                architecturePackDraft: resolution.architecturePack,
                guardrailDrafts: resolution.guardrailChecklist,
                readiness: nextEligibility.readiness,
                stage: nextStage,
                density_score: nextEligibility.readiness.score,
                is_ready: nextEligibility.readiness.functionalReady && nextEligibility.readiness.uiReady
            }
            : prev
        );
        setGenerateError(null);

        const followUp = nextEligibility.canGenerate
            ? buildReadyToGenerateMessage(language)
            : buildBlockedGenerateQuestion(
                language,
                nextStage,
                nextEligibility.readiness,
                resolution.architecturePack,
                baseMessages
            );
        const combinedContent = `${resolution.summary}\n\n${followUp.content}`.trim();
        appendDeterministicAssistantResponse(
            baseMessages,
            buildAssistantQuestionMessage({
                ...followUp,
                content: combinedContent
            })
        );
        return true;
    };

    const handleSend = async (overrideInput?: string, selectedOption?: MessageOption) => {
        if (isConversationLocked) return;

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
        const latestPendingQuestion = getLatestPendingQuestion(messages);
        const answeredQuestionKey = selectedOption?.questionKey
            ? normalizeQuestionKey(selectedOption.questionKey)
            : latestPendingQuestion?.questionKey ?? null;
        const contextualAction = latestPendingQuestion?.questionAction ?? null;
        const contextualRequirementKey = selectedOption?.requirementKey
            ?? latestPendingQuestion?.questionRequirementKey
            ?? null;
        const selectedOptionAction = selectedOption
            ? resolveOptionAction(selectedOption, contextualAction)
            : null;
        const typedAction = inferQuestionAction(textToSend);
        const contextualTriggeredAction =
            !selectedOptionAction && contextualAction && isAffirmativeForAction(textToSend, contextualAction)
                ? contextualAction
                : null;
        const triggeredAction = selectedOptionAction ?? contextualTriggeredAction ?? typedAction;
        const preparedMessages = closeOpenAssistantQuestions(messages, answeredQuestionKey);

        // Optimistic UI Update
        setHasUserEdited(true);
        const newUserMessage: Message = {
            role: "user",
            content: textToSend,
            attachments: attachmentsToSend,
            answeredQuestionKey: answeredQuestionKey ?? undefined,
            triggeredAction: triggeredAction ?? undefined
        };
        const newMessages = [...preparedMessages, newUserMessage];
        const latestUserContext = [...newMessages]
            .reverse()
            .find((message) => message.role === "user")
            ?.content ?? "";
        setMessageWindow(MESSAGE_WINDOW_SIZE);
        setInput("");
        setPendingAttachments([]);

        if (triggeredAction === "generate_scaffold") {
            setMessages(newMessages);
            await handleGenerate("chat", newMessages);
            return;
        }

        if (triggeredAction === "open_prd") {
            setMessages(newMessages);
            setActiveTab("prd");
            return;
        }

        if (
            (triggeredAction === "focus_requirement" ||
                triggeredAction === "fill_requirement" ||
                triggeredAction === "show_blockers") &&
            contextualRequirementKey
        ) {
            setMessages(newMessages);
            if (handleRequirementAction(triggeredAction, contextualRequirementKey, newMessages)) {
                return;
            }
        }

        const requestId = evalRequestIdRef.current + 1;
        evalRequestIdRef.current = requestId;
        const assistantPlaceholder: Message = { role: "assistant", content: "" };
        const assistantIndex = newMessages.length;
        setMessages([...newMessages, assistantPlaceholder]);
        setIsLoading(true);

        try {
            await yieldToBrowser();
            const structureContext = buildProjectStructureContext(generation?.projectTree);
            const latestSourceArtifacts = extractSourceArtifacts(newMessages);
            const sourceContext = buildSourceContext(latestSourceArtifacts, newMessages);
            const designMemory = buildDesignMemory(
                currentDiagram,
                evaluation,
                diagramGovernance,
                architecturePack,
                decisionRecords,
                guardrailChecklist,
                readinessOverrides,
                newMessages,
                EVALUATE_DESIGN_MEMORY_CHARS
            );
            const controller = new AbortController();
            evaluateAbortRef.current = controller;

            const requestBody = buildEvaluateRequestBody(
                newMessages,
                structureContext,
                sourceContext,
                Boolean(generation),
                false,
                designMemory,
                DIAGRAM_POLICY,
                workspaceLanguage
            );

            if (requestBody.length > EVALUATE_MAX_REQUEST_CHARS) {
                throw new Error("Evaluate request is too large. Please shorten the conversation or remove large attachments.");
            }

            const runEvaluateRequest = async (body: string) => {
                try {
                    return await fetch("/api/evaluate", {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            "Accept": "text/event-stream"
                        },
                        body,
                        cache: "no-store",
                        signal: controller.signal
                    });
                } catch (fetchError) {
                    const normalizedNetworkError = normalizeEvaluateNetworkError(fetchError, "/api/evaluate");
                    if (normalizedNetworkError) {
                        throw new Error(normalizedNetworkError);
                    }
                    throw fetchError;
                }
            };

            let res = await runEvaluateRequest(requestBody);

            if (!res.ok && EVALUATE_RETRYABLE_STATUS.has(res.status)) {
                const compactRequestBody = buildEvaluateRequestBody(
                    newMessages,
                    structureContext,
                    sourceContext,
                    Boolean(generation),
                    true,
                    designMemory,
                    DIAGRAM_POLICY,
                    workspaceLanguage
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
            const resolvedQuestionKeys = new Set(
                buildResolvedConfirmationLog(newMessages).map((item) => normalizeQuestionKey(item.questionKey))
            );
            let currentQuestionKey: string | null = null;
            let currentQuestionAction: MessageAction | null = null;
            let currentQuestionRequirementKey: ReadinessRequirementKey | null = null;
            const currentEval: EvaluationResponse = {
                density_score: evaluation?.density_score || 0,
                is_ready: false,
                current_diagram: currentDiagram,
                analysis: normalizeAnalysis(evaluation?.analysis),
                next_step: { reasoning: "", question: null },
                stage: architectureStage,
                openQuestions: normalizeStringList(evaluation?.openQuestions ?? evaluation?.analysis?.missing, 12),
                architecturePackDraft: architecturePack,
                decisionDrafts: decisionRecords,
                guardrailDrafts: guardrailChecklist,
                readiness: architectureReadiness
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
                    const rawQuestion = questionMatch[1];
                    const q = normalizeSingleQuestion(rawQuestion);
                    if (q) {
                        currentQuestionKey = normalizeQuestionKey(q);
                        currentQuestionAction = inferQuestionAction(rawQuestion);
                        currentQuestionRequirementKey = null;
                        currentEval.next_step.question = q;
                        const displayContent = buildAssistantDisplayContent(rawQuestion, currentEval.analysis, workspaceLanguage);
                        setMessages(prev => {
                            if (evalRequestIdRef.current !== requestId) return prev;
                            const updated = [...prev];
                            const current = updated[assistantIndex];
                            if (!current || current.role !== "assistant") return prev;
                            const ensuredOptions = ensureCommonQuestionOptions(
                                q,
                                current.options ?? [],
                                latestUserContext,
                                currentQuestionAction,
                                currentQuestionKey,
                                currentQuestionRequirementKey,
                                workspaceLanguage
                            );
                            updated[assistantIndex] = {
                                ...current,
                                content: displayContent || q,
                                options: ensuredOptions,
                                questionKey: currentQuestionKey,
                                questionStatus: "pending",
                                questionAction: currentQuestionAction ?? undefined,
                                questionRequirementKey: currentQuestionRequirementKey ?? undefined
                            };
                            return updated;
                        });
                    }
                }

                const stageMatch = buffer.match(/<stage>([\s\S]*?)<\/stage>/i);
                if (stageMatch?.[1]) {
                    const parsedStage = normalizeArchitectureStage(
                        stageMatch[1].trim(),
                        currentEval.architecturePackDraft ?? architecturePack,
                        currentEval.decisionDrafts ?? decisionRecords,
                        currentEval.guardrailDrafts ?? guardrailChecklist,
                        readinessOverrides
                    );
                    currentEval.stage = parsedStage;
                    setArchitectureStage(parsedStage);
                }

                const densityMatch = buffer.match(/<density>\s*(\d+)\s*<\/density>/);
                if (densityMatch) {
                    currentEval.density_score = parseInt(densityMatch[1]);
                }

                const readyMatch = buffer.match(/<is_ready>\s*(true|false)\s*<\/is_ready>/);
                if (readyMatch) currentEval.is_ready = readyMatch[1] === 'true';

                const clarifiedMatch = buffer.match(/<analysis_clarified>([\s\S]*?)<\/analysis_clarified>/);
                if (clarifiedMatch) {
                    currentEval.analysis.clarified = parseAnalysisList(clarifiedMatch[1]);
                }

                const missingMatch = buffer.match(/<analysis_missing>([\s\S]*?)<\/analysis_missing>/);
                if (missingMatch) {
                    currentEval.analysis.missing = parseAnalysisList(missingMatch[1])
                        .filter((item) => !resolvedQuestionKeys.has(normalizeQuestionKey(item)));
                    currentEval.openQuestions = currentEval.analysis.missing.slice(0, 8);
                }

                const uiSpecMatch = buffer.match(/<analysis_ui_spec>([\s\S]*?)<\/analysis_ui_spec>/i);
                if (uiSpecMatch) {
                    const parsedSpec = parseUiDesignSpecBlock(uiSpecMatch[1]);
                    if (parsedSpec) {
                        setUiDesignSpec(parsedSpec);
                        currentEval.analysis.ui = deriveUiRequirements(parsedSpec);
                    }
                }

                const uiMatch = buffer.match(/<analysis_ui>([\s\S]*?)<\/analysis_ui>/i);
                if (uiMatch) {
                    currentEval.analysis.ui = parseAnalysisUiBlock(uiMatch[1]);
                    setUiDesignSpec((prev) => prev ?? buildMinimalUiDesignSpec(currentEval.analysis.ui));
                }

                const architecturePackMatch = buffer.match(/<architecture_pack>([\s\S]*?)<\/architecture_pack>/i);
                if (architecturePackMatch) {
                    const parsedPack = parseJsonBlock(architecturePackMatch[1], (value) => normalizeArchitecturePack(value, currentEval.analysis.ui));
                    if (parsedPack) {
                        currentEval.architecturePackDraft = parsedPack;
                        setArchitecturePack(parsedPack);
                    }
                }

                const decisionsMatch = buffer.match(/<decision_records>([\s\S]*?)<\/decision_records>/i);
                if (decisionsMatch) {
                    const parsedDecisions = parseJsonBlock(decisionsMatch[1], normalizeDecisionRecords);
                    if (parsedDecisions) {
                        currentEval.decisionDrafts = parsedDecisions;
                        setDecisionRecords(parsedDecisions);
                    }
                }

                const guardrailsMatch = buffer.match(/<guardrails>([\s\S]*?)<\/guardrails>/i);
                if (guardrailsMatch) {
                    const parsedGuardrails = parseJsonBlock(guardrailsMatch[1], normalizeGuardrailChecklist);
                    if (parsedGuardrails) {
                        currentEval.guardrailDrafts = parsedGuardrails;
                        setGuardrailChecklist(parsedGuardrails);
                    }
                }

                currentEval.architecturePackDraft = normalizeArchitecturePack(
                    currentEval.architecturePackDraft ?? seedArchitecturePackFromAnalysis(currentEval.analysis, currentEval.analysis.ui),
                    currentEval.analysis.ui
                );

                const readinessMatch = buffer.match(/<readiness>([\s\S]*?)<\/readiness>/i);
                if (readinessMatch) {
                    const parsedReadiness = parseJsonBlock(readinessMatch[1], (value) => normalizeReadiness(
                        value,
                        currentEval.architecturePackDraft ?? architecturePack,
                        currentEval.decisionDrafts ?? decisionRecords,
                        currentEval.guardrailDrafts ?? guardrailChecklist,
                        readinessOverrides
                    ));
                    if (parsedReadiness) {
                        currentEval.readiness = parsedReadiness;
                        setArchitectureReadiness(parsedReadiness);
                    }
                }

                if (!currentEval.readiness) {
                    currentEval.readiness = createReadinessChecklist(
                        currentEval.architecturePackDraft,
                        currentEval.decisionDrafts ?? decisionRecords,
                        currentEval.guardrailDrafts ?? guardrailChecklist,
                        readinessOverrides
                    );
                }
                currentEval.is_ready = currentEval.readiness.functionalReady && currentEval.readiness.uiReady;
                currentEval.density_score = currentEval.readiness.score;

                if (!currentEval.stage) {
                    currentEval.stage = inferArchitectureStage(
                        currentEval.architecturePackDraft,
                        currentEval.decisionDrafts ?? decisionRecords,
                        currentEval.guardrailDrafts ?? guardrailChecklist,
                        readinessOverrides
                    );
                }

                // Options
                const optionsMatch = buffer.match(/<options>([\s\S]*?)<\/options>/i);
                if (optionsMatch) {
                    const options = ensureCommonQuestionOptions(
                        currentEval.next_step.question || "",
                        parseOptionsBlock(optionsMatch[1]),
                        latestUserContext,
                        currentQuestionAction,
                        currentQuestionKey,
                        currentQuestionRequirementKey,
                        workspaceLanguage
                    );
                    setMessages(prev => {
                        if (evalRequestIdRef.current !== requestId) return prev;
                        const updated = [...prev];
                        const current = updated[assistantIndex];
                        if (!current || current.role !== "assistant") return prev;
                        updated[assistantIndex] = { ...current, options };
                        return updated;
                    });
                }

                const normalizedEval = normalizeEvaluation({ ...currentEval }, readinessOverrides);
                if (normalizedEval?.architecturePackDraft) {
                    setArchitecturePack(normalizedEval.architecturePackDraft);
                }
                if (normalizedEval?.decisionDrafts) {
                    setDecisionRecords(normalizedEval.decisionDrafts);
                }
                if (normalizedEval?.guardrailDrafts) {
                    setGuardrailChecklist(normalizedEval.guardrailDrafts);
                }
                if (normalizedEval?.readiness) {
                    setArchitectureReadiness(normalizedEval.readiness);
                }
                if (normalizedEval?.stage) {
                    setArchitectureStage(normalizedEval.stage);
                }
                setEvaluation(normalizedEval);
            }

            if (evalRequestIdRef.current === requestId) {
                const resolvedEligibility = computeScaffoldEligibility({
                    architecturePack: currentEval.architecturePackDraft ?? architecturePack,
                    decisionRecords: currentEval.decisionDrafts ?? decisionRecords,
                    guardrailChecklist: currentEval.guardrailDrafts ?? guardrailChecklist,
                    readinessOverrides
                });
                const coercedGenerateQuestion = currentQuestionAction === "generate_scaffold" && !resolvedEligibility.canGenerate
                    ? buildBlockedGenerateQuestion(
                        workspaceLanguage,
                        inferArchitectureStage(
                            currentEval.architecturePackDraft ?? architecturePack,
                            currentEval.decisionDrafts ?? decisionRecords,
                            currentEval.guardrailDrafts ?? guardrailChecklist,
                            readinessOverrides
                        ),
                        resolvedEligibility.readiness,
                        currentEval.architecturePackDraft ?? architecturePack,
                        newMessages
                    )
                    : null;
                const fallbackText = extractFallbackAssistantText(buffer) || "Model response format was invalid. Please retry.";
                setMessages(prev => {
                    if (evalRequestIdRef.current !== requestId) return prev;
                    const updated = [...prev];
                    const current = updated[assistantIndex];
                    if (!current || current.role !== "assistant") return prev;
                    const fallbackOptions = ensureCommonQuestionOptions(
                        currentEval.next_step.question || fallbackText,
                        current.options ?? [],
                        latestUserContext,
                        currentQuestionAction,
                        currentQuestionKey,
                        currentQuestionRequirementKey,
                        workspaceLanguage
                    );
                    const nextContent = coercedGenerateQuestion
                        ? coercedGenerateQuestion.content
                        : current.content.trim().length > 0
                            ? current.content
                            : fallbackText;
                    const nextOptions = coercedGenerateQuestion
                        ? coercedGenerateQuestion.options
                        : current.options && current.options.length > 0
                            ? current.options
                            : fallbackOptions;
                    const nextQuestionKey = coercedGenerateQuestion
                        ? coercedGenerateQuestion.questionKey
                        : current.questionKey;
                    const nextQuestionAction = coercedGenerateQuestion
                        ? coercedGenerateQuestion.questionAction
                        : current.questionAction;
                    const nextQuestionRequirementKey = coercedGenerateQuestion
                        ? coercedGenerateQuestion.questionRequirementKey
                        : current.questionRequirementKey;
                    const nextQuestionStatus = coercedGenerateQuestion ? "pending" as const : current.questionStatus;
                    if (
                        nextContent === current.content &&
                        nextOptions === current.options &&
                        nextQuestionKey === current.questionKey &&
                        nextQuestionAction === current.questionAction &&
                        nextQuestionRequirementKey === current.questionRequirementKey &&
                        nextQuestionStatus === current.questionStatus
                    ) {
                        return prev;
                    }
                    updated[assistantIndex] = {
                        ...current,
                        content: nextContent,
                        options: nextOptions,
                        questionKey: nextQuestionKey,
                        questionAction: nextQuestionAction,
                        questionRequirementKey: nextQuestionRequirementKey,
                        questionStatus: nextQuestionStatus
                    };
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
                updated[assistantIndex] = {
                    ...current,
                    content: workspaceLanguage === "zh" ? `错误：${errorMessage}` : `Error: ${errorMessage}`,
                    options: []
                };
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

    const handleOptionClick = (option: MessageOption) => {
        if (isConversationLocked) return;

        const optionLabel = option.label.trim();
        const optionValue = option.value.trim();
        const textToSend = optionValue || optionLabel;
        if (!textToSend) return;

        setInput(textToSend);
        void handleSend(textToSend, option);
    };

    const handleResizeStart = (e: React.PointerEvent) => {
        e.preventDefault();
        isResizingRef.current = true;
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
    };

    const handleImportValidationReport = () => {
        validationReportInputRef.current?.click();
    };

    const handleValidationReportSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0] || null;
        if (!file) return;

        try {
            if (!generation) {
                throw new Error(
                    workspaceLanguage === "zh"
                        ? "当前没有可回写的脚手架结果。"
                        : "There is no generated scaffold to update."
                );
            }

            const rawText = await file.text();
            const parsed = JSON.parse(rawText) as Record<string, unknown>;
            const normalizedReport = `${JSON.stringify(parsed, null, 2)}\n`;
            const nextTree = upsertFileContentInTree(
                generation.projectTree,
                "VALIDATION_REPORT.json",
                normalizedReport
            );
            const provisionalGeneration: GenerationResponse = {
                ...generation,
                projectTree: nextTree,
                handoffValidation: undefined
            };
            const nextHandoffValidation = resolveGenerationHandoffValidation(provisionalGeneration);

            if (!nextHandoffValidation) {
                throw new Error(
                    workspaceLanguage === "zh"
                        ? "无法从导入报告中解析 handoff 校验状态。"
                        : "Unable to derive handoff validation status from the imported report."
                );
            }

            setGeneration({
                ...provisionalGeneration,
                handoffValidation: nextHandoffValidation
            });
            setHasUserEdited(true);
            setHandoffImportFeedback({
                type: "success",
                message: workspaceLanguage === "zh"
                    ? "已导入 VALIDATION_REPORT.json，工作区状态已更新。"
                    : "Imported VALIDATION_REPORT.json and refreshed workspace status."
            });
        } catch (error) {
            setHandoffImportFeedback({
                type: "error",
                message: error instanceof Error
                    ? error.message
                    : workspaceLanguage === "zh"
                        ? "导入 VALIDATION_REPORT.json 失败。"
                        : "Failed to import VALIDATION_REPORT.json."
            });
        } finally {
            if (validationReportInputRef.current) {
                validationReportInputRef.current.value = "";
            }
        }
    };

    // --- Generation Handler ---
    const generateScaffold = async () => {
        if (generateInFlightRef.current) return;
        if (!projectId || !currentVersion) {
            setGenerateError(uiText.missingGenerateContext);
            return;
        }
        generateInFlightRef.current = true;
        setIsGenerating(true);
        setGenerateError(null);
        setHandoffImportFeedback(null);
        setHasUserEdited(true);
        try {
            await yieldToBrowser();
            const historyText = buildGenerateSummary(
                architecturePack,
                decisionRecords,
                guardrailChecklist,
                messages
            );
            const outputLanguage = workspaceLanguage;
            const templateKindHint = inferTemplateKindHintFromTree(generation?.projectTree);
            const res = await fetch("/api/generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    projectId,
                    versionId: currentVersion.id,
                    summary: historyText,
                    diagram: currentDiagram,
                    projectName: project?.name,
                    outputLanguage,
                    outputMode: GENERATE_OUTPUT_MODE,
                    oneClickMode: GENERATE_ONE_CLICK_MODE,
                    ideProfile: GENERATE_IDE_PROFILE,
                    templateKindHint,
                    currentProjectTree: generation?.projectTree,
                    architecturePack,
                    decisionRecords,
                    guardrailChecklist
                })
            });

            const payload = await res.json().catch(() => null) as (
                GenerationResponse & {
                    error?: string;
                    details?: string;
                    code?: string;
                    status?: number;
                    blockingReasons?: string[];
                }
            ) | null;
            const payloadHasError = Boolean(
                payload &&
                typeof payload === "object" &&
                typeof payload.error === "string" &&
                !Array.isArray(payload.projectTree)
            );

            if (!res.ok || payloadHasError) {
                let errorMessage = uiText.failedToGenerate;
                if (payload) {
                    if (payload.error) {
                        errorMessage = payload.details ? `${payload.error}: ${payload.details}` : payload.error;
                    }
                    if (Array.isArray(payload.blockingReasons) && payload.blockingReasons.length > 0) {
                        errorMessage = payload.blockingReasons[0];
                    }
                }
                const effectiveStatus = typeof payload?.status === "number" ? payload.status : res.status;
                if (effectiveStatus === 504 && !/timeout/i.test(errorMessage)) {
                    errorMessage = `${errorMessage}. ${uiText.generateTimedOut}`;
                } else if (effectiveStatus === 524 && !/524/i.test(errorMessage)) {
                    errorMessage = `${errorMessage}. ${uiText.gatewayTimedOut}`;
                }
                throw new Error(errorMessage);
            }
            if (!payload || !Array.isArray(payload.projectTree)) {
                throw new Error(uiText.scaffoldGenerationFailed);
            }
            const data: GenerationResponse = payload;
            if (data.preflightReport && !data.preflightReport.pass) {
                const codes = data.preflightReport.issues.map((issue) => issue.code).join(", ");
                throw new Error(uiText.scaffoldPreflightFailed(codes || "unknown"));
            }
            setGeneration(data);
            setCurrentVersion((prev) => prev ? { ...prev, status: "published" } : prev);
            setInput("");
            setPendingAttachments([]);

            // Auto switch tab
            setActiveTab('files');

            // Mock Task Generation
            setTasks([
                { id: '1', title: uiText.setupProjectStructure, status: 'pending', description: uiText.setupProjectStructureDesc, source: 'scaffold' },
                { id: '2', title: uiText.implementCoreFeatures, status: 'pending', description: uiText.implementCoreFeaturesDesc, source: 'scaffold' },
            ]);

        } catch (error) {
            console.error(error);
            setGenerateError(error instanceof Error ? error.message : uiText.scaffoldGenerationFailed);
        } finally {
            setIsGenerating(false);
            generateInFlightRef.current = false;
        }
    };

    const startCheckout = async () => {
        if (!projectId || !currentVersion) {
            setGenerateError(uiText.missingCheckoutContext);
            return;
        }
        if (isAdmin) {
            setGenerateError(uiText.adminBypassesPayment);
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
                    projectName: project?.name || uiText.projectCredit,
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
                            tasks,
                            designStage,
                            uiDesignState,
                            uiDesignSpec,
                            architecturePack,
                            decisionRecords,
                            guardrailChecklist,
                            readinessOverrides,
                            sourceArtifacts,
                            architectureStage,
                            functionalLockedAt,
                            uiReadyAt
                        )
                    })
            });

            if (res.status === 401) {
                router.push("/login");
                return;
            }

            const data = (await res.json()) as { checkoutUrl?: string; error?: string };
            if (!res.ok || !data.checkoutUrl) {
                throw new Error(data.error || uiText.unableToStartStripeCheckout);
            }

            window.location.assign(data.checkoutUrl);
        } catch (error) {
            const message = error instanceof Error ? error.message : uiText.failedToStartCheckout;
            setGenerateError(message);
        } finally {
            setIsCheckingOut(false);
        }
    };

    const handleGenerate = async (source: "button" | "chat" = "button", baseMessages?: Message[]) => {
        if (!project?.id) return;
        if (isGenerating || isCheckingOut) return;

        setMessages((prev) => {
            const pending = getLatestPendingQuestion(prev);
            return closeOpenAssistantQuestions(
                prev,
                pending?.questionAction === "generate_scaffold" ? pending.questionKey : null
            );
        });

        setGenerateError(null);
        if (!minimumViableLoopReady) {
            const message = translateReadinessText(
                workspaceLanguage,
                minimumLoopBlockers[0] || uiText.completeMvlBeforeGenerate
            );
            setGenerateError(message);
            if (source === "chat") {
                const blockedResponse = buildBlockedGenerateQuestion(
                    workspaceLanguage,
                    architectureStage,
                    scaffoldEligibility.readiness,
                    architecturePack,
                    baseMessages ?? messages
                );
                setMessages((prev) => {
                    const nextBase = baseMessages ?? prev;
                    return [
                        ...nextBase,
                        {
                            role: "assistant",
                            content: blockedResponse.content,
                            options: blockedResponse.options,
                            questionKey: blockedResponse.questionKey,
                            questionStatus: "pending",
                            questionAction: blockedResponse.questionAction,
                            questionRequirementKey: blockedResponse.questionRequirementKey
                        }
                    ];
                });
            }
            return;
        }
        if (requiresPayment) {
            await startCheckout();
            return;
        }
        await generateScaffold();
    };

    const handleArchitectureNodeSelect = () => {
        setGenerateError(null);
    };

    const prdSummaryLines = buildPrdSummaryLines(
        workspaceLanguage,
        evaluation,
        architecturePack,
        architectureReadiness
    );
    const prdConversationSignals = buildPrdConversationSignals(workspaceLanguage, messages);
    const prdArchitectureSnapshot = buildPrdArchitectureSnapshot(
        workspaceLanguage,
        architecturePack,
        architectureReadiness
    );
    const prdClarifiedItems = normalizeAnalysis(evaluation?.analysis).clarified;
    const prdOpenQuestions = normalizeAnalysis(evaluation?.analysis).missing;
    const prdGuardrailItems = [
        ...guardrailChecklist.implementationOrder,
        ...guardrailChecklist.acceptanceCriteria,
        ...guardrailChecklist.testStrategy
    ].slice(0, 8);

    if (!project || !currentVersion) return <WizardSkeleton />;

    return (
        <>
            <div className="relative flex h-screen w-full overflow-hidden font-sans text-slate-900 dark:text-slate-100">
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(13,93,255,0.16),transparent_70%)]" />
                {/* Project Sidebar + Chat (Left) */}
                <VersionSidebar project={project} width={sidebarWidth} language={workspaceLanguage}>
                <div className="relative z-10 flex h-full min-h-0 flex-col">
                    <div className="flex-1 min-h-0">
                        <div
                            className="relative z-10 flex h-full flex-col border-l border-[color:var(--border)] bg-white/82 shadow-[var(--shadow-sm)] backdrop-blur-sm dark:bg-slate-900/72"
                            onPaste={handlePaste}
                        >
                            {/* Header */}
                            <div className="flex items-center justify-between border-b border-[color:var(--border)] bg-white/70 px-4 py-3 backdrop-blur-sm dark:bg-slate-900/75">
                                <div className="space-y-1">
                                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-400">{uiText.projectLabel}</p>
                                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{project.name}</p>
                                </div>
                                <UserCenter signOutCallbackUrl="/" />
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
                                            {uiText.showEarlierMessages(Math.min(MESSAGE_WINDOW_STEP, hiddenMessageCount), hiddenMessageCount)}
                                        </button>
                                    </div>
                                )}

                                {visibleMessages.map((msg, idx) => {
                                    const messageIndex = baseMessageIndex + idx;
                                    return (
                                        <ChatBubble
                                            key={messageIndex}
                                            message={msg}
                                            onOptionClick={handleOptionClick}
                                            disableOptions={isConversationLocked}
                                        />
                                    );
                                })}

                                {isLoading && (
                                    <div className="flex justify-start animate-pulse">
                                        <div className="rounded-xl rounded-tl-none bg-slate-100 px-4 py-2 text-sm text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                                            {uiText.thinking}
                                        </div>
                                    </div>
                                )}

                                <div ref={messagesEndRef} />
                            </div>

                            {/* Input Area */}
                            <div className="border-t border-[color:var(--border)] bg-white/80 p-4 dark:bg-slate-900/75">
                                <div className="mb-3 space-y-2">
                                    <div className="text-[11px] font-medium text-slate-500 dark:text-slate-300">
                                        {uiText.architectStage}: {getArchitectureStageLabel(workspaceLanguage, architectureStage)} | {uiText.readiness} {Math.round(architectureCompletion)}%
                                        {` | MVL ${minimumViableLoopReady ? uiText.mvlReady : `${Math.round(minimumViableLoop.score)}%`}`}
                                    </div>
                                </div>
                                <div className="mb-4 flex flex-col gap-2">
                                    {generation ? (
                                        <>
                                            <div className="flex w-full cursor-default items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-6 py-4 font-semibold text-emerald-700 dark:border-emerald-700/40 dark:bg-emerald-900/20 dark:text-emerald-300">
                                                <Check className="w-5 h-5" />
                                                {uiText.scaffoldGenerated}
                                            </div>
                                            <p className="text-center text-xs font-medium text-emerald-600 dark:text-emerald-400">
                                                {lockedChatDescription}
                                            </p>
                                        </>
                                    ) : (
                                        <>
                                            <button
                                                onClick={() => {
                                                    void handleGenerate();
                                                }}
                                                disabled={isGenerating || isCheckingOut || !isAdminStatusLoaded || !minimumViableLoopReady}
                                                className="fc-button-primary flex w-full items-center justify-center gap-2 px-6 py-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                                            >
                                                {isGenerating || isCheckingOut
                                                    ? <Loader2 className="animate-spin" />
                                                    : <Sparkles className="w-5 h-5" />}
                                                {!isAdminStatusLoaded
                                                    ? uiText.checkingAccess
                                                    : !minimumViableLoopReady
                                                    ? uiText.generateLockedUntilMvlReady
                                                    : isCheckingOut
                                                    ? uiText.redirectingToPayment
                                                    : isGenerating
                                                    ? uiText.architectingSolution
                                                    : !requiresPayment
                                                    ? uiText.generateScaffold
                                                    : checkoutQuote?.displayAmount
                                                    ? uiText.proceedToPaymentWithAmount(checkoutQuote.displayAmount)
                                                    : isQuoteLoading
                                                    ? uiText.proceedToPaymentCalculating
                                                    : uiText.proceedToPayment}
                                            </button>
                                            {generateError && (
                                                <div className="text-xs text-red-500 text-center">{generateError}</div>
                                            )}
                                            <p className="text-center text-xs text-slate-500 dark:text-slate-300">
                                                {!isAdminStatusLoaded
                                                    ? uiText.checkingPermissions
                                                    : !minimumViableLoopReady
                                                    ? uiText.minimumViableLoopNotReady(translateReadinessText(workspaceLanguage, minimumLoopBlockers[0] || ""))
                                                    : isAdmin
                                                    ? uiText.adminModeBypassEnabled
                                                    : hasPaid
                                                    ? uiText.readyToBuild
                                                    : checkoutQuote
                                                    ? uiText.estimatedQuote(
                                                        checkoutQuote.displayAmount,
                                                        translateComplexityTier(workspaceLanguage, checkoutQuote.complexityTier)
                                                    )
                                                    : isQuoteLoading
                                                    ? uiText.calculatingPrice
                                                    : uiText.paymentRequired}
                                            </p>
                                        </>
                                    )}
                                </div>

                                <div className="flex flex-col gap-2">
                                    {!minimumViableLoopReady && (
                                        <p className="px-1 text-[11px] text-slate-500 dark:text-slate-300">
                                            {uiText.nextMvlBlocker(translateReadinessText(workspaceLanguage, minimumLoopBlockers[0] || ""))}
                                        </p>
                                    )}
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
                                            disabled={isConversationLocked}
                                        />
                                        <button
                                            onClick={() => {
                                                if (!isConversationLocked) fileInputRef.current?.click();
                                            }}
                                            disabled={isConversationLocked}
                                            className="mb-1 rounded-lg p-2 text-slate-400 transition-colors hover:bg-blue-50 hover:text-blue-500 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-blue-900/20"
                                            title={uiText.attachFiles}
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
                                            placeholder={isConversationLocked
                                                ? lockedInputPlaceholder
                                                : uiText.architecturePlaceholder(project.name)}
                                            disabled={isGenerating || isConversationLocked}
                                            rows={1}
                                            className="min-h-[40px] max-h-[150px] flex-1 resize-none overflow-hidden border-none bg-transparent p-2 text-slate-900 focus:outline-none focus:ring-0 disabled:cursor-not-allowed disabled:text-slate-400 dark:text-slate-100 dark:disabled:text-slate-500"
                                        />

                                        <button
                                            onClick={() => handleSend()}
                                            disabled={
                                                isConversationLocked ||
                                                isGenerating ||
                                                (!isLoading && !input.trim() && pendingAttachments.length === 0)
                                            }
                                            className="fc-button-primary mb-1 rounded-lg p-2 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                            {isLoading ? <Square className="w-5 h-5" /> : <Send className="w-5 h-5" />}
                                        </button>
                                    </div>
                                    {isLoading && (
                                        <p className="px-1 text-[11px] text-slate-500 dark:text-slate-300">
                                            {uiText.aiRespondingHint}
                                        </p>
                                    )}
                                </div>
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
                aria-label={uiText.resizeChatPanel}
                style={{ touchAction: "none" }}
            />

            {/* Studio Panel (Right) - v2 Layout */}
            <main className="relative z-10 flex h-full min-w-0 flex-1 flex-col overflow-hidden p-4 md:p-6">
                {/* Tabs */}
                <div className="fc-surface mb-4 flex flex-shrink-0 space-x-1 overflow-x-auto rounded-2xl p-2">
                    <TabButton
                        active={activeTab === 'architecture'}
                        onClick={() => setActiveTab('architecture')}
                        icon={<BrainCircuit className="w-4 h-4" />}
                        label={uiText.architectureTab}
                    />
                    <TabButton
                        active={activeTab === 'prd'}
                        onClick={() => setActiveTab('prd')}
                        icon={<FileText className="w-4 h-4" />}
                        label={uiText.prdTab}
                    />
                    <TabButton
                        active={activeTab === 'files'}
                        onClick={() => setActiveTab('files')}
                        icon={<FileCode className="w-4 h-4" />}
                        label={uiText.scaffoldTab}
                        disabled={!generation}
                    />
                    <TabButton
                        active={activeTab === 'stack'}
                        onClick={() => setActiveTab('stack')}
                        icon={<Layers className="w-4 h-4" />}
                        label={uiText.techStackTab}
                        disabled={!generation}
                    />
                </div>

                <input
                    type="file"
                    ref={validationReportInputRef}
                    className="hidden"
                    accept="application/json,.json"
                    onChange={handleValidationReportSelect}
                />

                {/* Content Area */}
                <div className="fc-surface-strong relative flex-1 min-h-0 overflow-hidden rounded-[var(--radius-2xl)]">

                    {/* Architecture Tab */}
                    {activeTab === 'architecture' && (
                        <div className="absolute inset-0 overflow-y-auto p-4 md:p-6">
                            <section className="h-full rounded-2xl border border-[color:var(--border)] bg-slate-50/70 p-4 dark:bg-black/25">
                                <div className="relative h-full min-h-[520px] overflow-hidden rounded-xl border border-dashed border-[color:var(--border)] bg-slate-50/70 dark:bg-black/25">
                                    <ArchitectureViewer code={architectureViewerCode} onNodeSelect={handleArchitectureNodeSelect} language={workspaceLanguage} />
                                </div>
                            </section>
                        </div>
                    )}

                    {/* PRD Tab */}
                    {activeTab === 'prd' && (
                        <div className="absolute inset-0 overflow-y-auto p-4 md:p-6">
                            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
                                <section className="rounded-2xl border border-[color:var(--border)] bg-white/80 p-4 dark:bg-slate-900/60">
                                    <div className="flex items-center justify-between gap-3">
                                        <div>
                                            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{uiText.prdTitle}</h3>
                                            <p className="mt-1 text-sm text-slate-500 dark:text-slate-300">{uiText.prdDesc}</p>
                                        </div>
                                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 dark:border-emerald-700/40 dark:bg-emerald-900/20 dark:text-emerald-300">
                                            {uiText.prdLastUpdated}
                                        </span>
                                    </div>

                                    <div className="mt-4 space-y-5">
                                        <div>
                                            <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{uiText.prdSummary}</h4>
                                            <div className="mt-2 space-y-2">
                                                {prdSummaryLines.map((item, index) => (
                                                    <div key={`prd-summary-${index}`} className="rounded-xl border border-emerald-100 bg-emerald-50/80 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-800/40 dark:bg-emerald-900/15 dark:text-emerald-100">
                                                        {item}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>

                                        <div>
                                            <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{uiText.prdClarified}</h4>
                                            <div className="mt-2 space-y-2">
                                                {prdClarifiedItems.length > 0 ? prdClarifiedItems.map((item, index) => (
                                                    <div key={`prd-clarified-${index}`} className="rounded-xl border border-[color:var(--border)] bg-slate-50/80 px-3 py-2 text-sm text-slate-700 dark:bg-slate-800/40 dark:text-slate-200">
                                                        {item}
                                                    </div>
                                                )) : (
                                                    <p className="text-sm text-slate-500 dark:text-slate-300">{uiText.prdNoClarified}</p>
                                                )}
                                            </div>
                                        </div>

                                        <div>
                                            <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{uiText.prdOpenQuestions}</h4>
                                            <div className="mt-2 space-y-2">
                                                {prdOpenQuestions.length > 0 ? prdOpenQuestions.map((item, index) => (
                                                    <div key={`prd-open-${index}`} className="rounded-xl border border-amber-100 bg-amber-50/80 px-3 py-2 text-sm text-amber-900 dark:border-amber-800/40 dark:bg-amber-900/15 dark:text-amber-100">
                                                        {item}
                                                    </div>
                                                )) : (
                                                    <p className="text-sm text-slate-500 dark:text-slate-300">{uiText.prdNoOpenQuestions}</p>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </section>

                                <section className="space-y-4">
                                    <div className="rounded-2xl border border-[color:var(--border)] bg-white/80 p-4 dark:bg-slate-900/60">
                                        <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{uiText.prdConversationSignals}</h4>
                                        <div className="mt-3 space-y-2">
                                            {prdConversationSignals.length > 0 ? prdConversationSignals.map((item, index) => (
                                                <div key={`prd-signal-${index}`} className="rounded-xl border border-[color:var(--border)] bg-slate-50/80 px-3 py-2 text-sm text-slate-700 dark:bg-slate-800/40 dark:text-slate-200">
                                                    {item}
                                                </div>
                                            )) : (
                                                <p className="text-sm text-slate-500 dark:text-slate-300">{uiText.prdNoConversationSignals}</p>
                                            )}
                                        </div>
                                    </div>

                                    <div className="rounded-2xl border border-[color:var(--border)] bg-white/80 p-4 dark:bg-slate-900/60">
                                        <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{uiText.prdArchitectureSnapshot}</h4>
                                        <div className="mt-3 space-y-2">
                                            {prdArchitectureSnapshot.map((item, index) => (
                                                <div key={`prd-arch-${index}`} className="rounded-xl border border-[color:var(--border)] bg-slate-50/80 px-3 py-2 text-sm text-slate-700 dark:bg-slate-800/40 dark:text-slate-200">
                                                    {item}
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="rounded-2xl border border-[color:var(--border)] bg-white/80 p-4 dark:bg-slate-900/60">
                                        <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{uiText.prdDecisionLog}</h4>
                                        <div className="mt-3 space-y-2">
                                            {decisionRecords.length > 0 ? decisionRecords.slice(0, 5).map((record, index) => (
                                                <div key={`prd-decision-${index}`} className="rounded-xl border border-[color:var(--border)] bg-slate-50/80 px-3 py-2 text-sm text-slate-700 dark:bg-slate-800/40 dark:text-slate-200">
                                                    <p className="font-semibold text-slate-900 dark:text-slate-100">{record.title || record.decision}</p>
                                                    <p className="mt-1">{record.decision}</p>
                                                </div>
                                            )) : (
                                                <p className="text-sm text-slate-500 dark:text-slate-300">{uiText.prdNoDecisionLog}</p>
                                            )}
                                        </div>
                                    </div>

                                    <div className="rounded-2xl border border-[color:var(--border)] bg-white/80 p-4 dark:bg-slate-900/60">
                                        <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{uiText.prdGuardrails}</h4>
                                        <div className="mt-3 space-y-2">
                                            {prdGuardrailItems.length > 0 ? prdGuardrailItems.map((item, index) => (
                                                    <div key={`prd-guardrail-${index}`} className="rounded-xl border border-[color:var(--border)] bg-slate-50/80 px-3 py-2 text-sm text-slate-700 dark:bg-slate-800/40 dark:text-slate-200">
                                                        {item}
                                                    </div>
                                                )) : (
                                                <p className="text-sm text-slate-500 dark:text-slate-300">{uiText.prdNoGuardrails}</p>
                                            )}
                                        </div>
                                    </div>
                                </section>
                            </div>
                        </div>
                    )}

                    {/* Scaffold Tab */}
                    {activeTab === 'files' && generation && (
                        <div className="absolute inset-0 p-4 overflow-hidden">
                            <FileTreeDisplay content={generation.projectTree} projectName={project?.name} language={workspaceLanguage} />
                        </div>
                    )}

                    {/* Stack Tab */}
                    {activeTab === 'stack' && generation && (
                        <div className="absolute inset-0 p-6 overflow-y-auto">
                            <div className={`grid gap-4 ${handoffValidation ? "xl:grid-cols-[minmax(0,1.05fr)_minmax(340px,0.95fr)]" : ""}`}>
                                <section className="rounded-2xl border border-[color:var(--border)] bg-white/80 p-4 dark:bg-slate-900/60">
                                    <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-slate-100">
                                        <Layers className="h-5 w-5 text-orange-500" />
                                        {uiText.technologyStack}
                                    </h3>
                                    <ToolStackTable content={generation.toolStack} language={workspaceLanguage} />
                                </section>

                                {handoffValidation && (
                                    <div>
                                        <HandoffValidationCard
                                            validation={handoffValidation}
                                            language={workspaceLanguage}
                                            feedback={handoffImportFeedback}
                                            onImportReport={handleImportValidationReport}
                                        />
                                    </div>
                                )}
                            </div>
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

function HandoffValidationCard({
    validation,
    language,
    feedback,
    onImportReport
}: {
    validation: HandoffValidation;
    language: WorkspaceLanguage;
    feedback: {
        type: "success" | "error";
        message: string;
    } | null;
    onImportReport: () => void;
}) {
    const isZh = language === "zh";
    const updatedAt = formatHandoffUpdatedAt(validation.updatedAt, language);
    const statusMeta =
        validation.status === "passed"
            ? {
                label: isZh ? "已通过" : "Passed",
                icon: <Check className="h-4 w-4" />,
                className: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-700/40 dark:bg-emerald-900/20 dark:text-emerald-300"
            }
            : validation.status === "failed"
                ? {
                    label: isZh ? "未通过" : "Failed",
                    icon: <X className="h-4 w-4" />,
                    className: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-700/40 dark:bg-rose-900/20 dark:text-rose-300"
                }
                : {
                    label: isZh ? "待执行" : "Pending",
                    icon: <Loader2 className="h-4 w-4 animate-spin" />,
                    className: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-300"
                };

    const metricState = (passed: boolean) => {
        if (passed) return isZh ? "通过" : "Pass";
        if (validation.status === "pending") return isZh ? "待执行" : "Pending";
        return isZh ? "失败" : "Fail";
    };

    const summaryItems = [
        {
            label: isZh ? "占位文件" : "Placeholders",
            value: validation.summary.placeholdersRemaining
                ? (isZh ? "仍存在" : "Remaining")
                : (isZh ? "已清空" : "Cleared")
        },
        {
            label: isZh ? "Lint" : "Lint",
            value: metricState(validation.summary.lintPassed)
        },
        {
            label: isZh ? "Typecheck" : "Typecheck",
            value: metricState(validation.summary.typecheckPassed)
        },
        {
            label: isZh ? "Build" : "Build",
            value: metricState(validation.summary.buildPassed)
        }
    ];

    return (
        <section className="rounded-2xl border border-[color:var(--border)] bg-white/80 p-4 dark:bg-slate-900/60">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                    <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                        {isZh ? "Handoff 校验" : "Handoff Validation"}
                    </h3>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-300">
                        {isZh
                            ? "AI IDE 完成所有实现任务后，执行最终交付校验并回写报告。"
                            : "Run the final delivery gate after the AI IDE finishes all implementation tasks."}
                    </p>
                    {updatedAt && (
                        <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
                            {isZh ? `报告时间 ${updatedAt}` : `Report updated ${updatedAt}`}
                        </p>
                    )}
                </div>
                <div className="flex flex-col items-start gap-2 lg:items-end">
                    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${statusMeta.className}`}>
                        {statusMeta.icon}
                        {statusMeta.label}
                    </span>
                    <button
                        type="button"
                        onClick={onImportReport}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                        {isZh ? "导入 VALIDATION_REPORT.json" : "Import VALIDATION_REPORT.json"}
                    </button>
                </div>
            </div>

            {feedback && (
                <div className={`mt-4 rounded-xl border px-3 py-2 text-sm ${
                    feedback.type === "success"
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-700/40 dark:bg-emerald-900/20 dark:text-emerald-300"
                        : "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-700/40 dark:bg-rose-900/20 dark:text-rose-300"
                }`}>
                    {feedback.message}
                </div>
            )}

            <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
                <div className="space-y-3">
                    <div className="rounded-xl border border-[color:var(--border)] bg-slate-50/80 p-3 dark:bg-slate-950/30">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            {isZh ? "执行命令" : "Command"}
                        </p>
                        <code className="mt-2 block text-sm text-slate-900 dark:text-slate-100">{validation.command}</code>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                        <div className="rounded-xl border border-[color:var(--border)] bg-slate-50/80 p-3 dark:bg-slate-950/30">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                {isZh ? "报告路径" : "Report Path"}
                            </p>
                            <code className="mt-2 block text-sm text-slate-900 dark:text-slate-100">{validation.reportPath}</code>
                        </div>
                        <div className="rounded-xl border border-[color:var(--border)] bg-slate-50/80 p-3 dark:bg-slate-950/30">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                {isZh ? "校验脚本" : "Validator Script"}
                            </p>
                            <code className="mt-2 block text-sm text-slate-900 dark:text-slate-100">{validation.scriptPath}</code>
                        </div>
                    </div>

                    {validation.issues.length > 0 && (
                        <div className="rounded-xl border border-[color:var(--border)] bg-slate-50/80 p-3 dark:bg-slate-950/30">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                {isZh ? "当前问题" : "Open Issues"}
                            </p>
                            <div className="mt-2 space-y-2">
                                {validation.issues.slice(0, 3).map((issue) => (
                                    <div key={`${issue.code}-${issue.message}`} className="rounded-lg border border-[color:var(--border)] bg-white/80 px-3 py-2 text-sm text-slate-700 dark:bg-slate-900/70 dark:text-slate-200">
                                        <p className="font-semibold text-slate-900 dark:text-slate-100">{issue.code}</p>
                                        <p className="mt-1">{issue.message}</p>
                                        {issue.details && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{issue.details}</p>}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                    {summaryItems.map((item) => (
                        <div key={item.label} className="rounded-xl border border-[color:var(--border)] bg-slate-50/80 p-3 dark:bg-slate-950/30">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{item.label}</p>
                            <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-slate-100">{item.value}</p>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}

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
        <Suspense fallback={<div className="flex h-screen items-center justify-center" />}>
            <WizardContent />
        </Suspense>
    );
}
