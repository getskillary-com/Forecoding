"use client";

import { useState, useEffect, useRef, Suspense, type ReactNode } from "react";
import { Send, Sparkles, Loader2, BrainCircuit, Check, Paperclip, X, FileText, Square, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import {
    ArchitecturePack,
    ArchitectureStage,
    DecisionRecord,
    Message,
    MessageAction,
    EvaluateInteractionMode,
    MessageOption,
    MessageQuestionStatus,
    EvaluationResponse,
    GenerationResponse,
    GenerationArtifacts,
    DiagramGovernance,
    DesignStage,
    GuardrailChecklist,
    OutputMode,
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
    PendingEvaluation,
    Attachment,
    FileNode,
    MinimumViableLoopChecklist
} from "@/types";
import { ChatBubble } from "@/components/ChatBubble";
import { useNavigationFeedback } from "@/components/NavigationFeedback";
import { RoutePendingState } from "@/components/RoutePendingState";
import dynamic from "next/dynamic";
const ArchitectureViewer = dynamic(() => import("@/components/ArchitectureViewer"), {
    ssr: false,
    loading: () => <div className="h-full w-full" />
});
const FileTreeDisplay = dynamic(() => import("@/components/FileTreeDisplay").then((m) => m.FileTreeDisplay), {
    ssr: false,
    loading: () => <div className="h-full w-full" />
});
import { VersionSidebar } from "@/components/VersionSidebar";
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
    prefetchWorkspaceRemote,
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
import {
    buildPlatformSummaryLine,
    hasConfirmedPlatformStrategy,
    resolvePrimaryPlatformCategory
} from "@/lib/platforms";
import { computeScaffoldEligibility } from "@/lib/scaffold-eligibility";
import { loadAdminStatus } from "@/lib/admin-status-client";
const STRUCTURE_CONTEXT_MAX_CHARS = 12000;
const STRUCTURE_SNIPPET_MAX_CHARS = 200;
const MESSAGE_WINDOW_SIZE = 24;
const MESSAGE_WINDOW_STEP = 24;
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
const GENERATE_ONE_CLICK_MODE = "strict_build_v1" as const;
const GENERATE_IDE_PROFILE = "generic" as const;
const GENERATE_OUTPUT_MODES: readonly OutputMode[] = ["virtual_spec"] as const;
const SOURCE_CONTEXT_ITEM_EXCERPT_CHARS = 700;
const SOURCE_CONTEXT_MAX_ITEMS = 6;
const SOURCE_SEARCH_TERM_MAX_COUNT = 24;
const GENERATE_SCAFFOLD_INTENT_PATTERNS = [
    "generate scaffold",
    "scaffold generation",
    "start scaffold generation",
    "generate scaffold now",
    "start scaffold",
    "start generation(?: now)?",
    "begin generation(?: now)?",
    "start code generation(?: now)?",
    "start project generation(?: now)?",
    "开始生成(?:代码)?脚手架",
    "生成(?:代码)?脚手架",
    "(?:确认无误[,，\\s]*)?开始生成(?:(?:工程(?:代码|骨架)?|代码(?:工程|脚手架)?|脚手架))?(?=$|[\\s，。,.!！？?])",
    "立即开始生成(?:(?:工程(?:代码|骨架)?|代码(?:工程|脚手架)?|脚手架))?(?=$|[\\s，。,.!！？?])",
    "开始生成工程(?:代码|骨架)",
    "生成工程(?:代码|骨架)",
    "立即生成"
];
const GENERATE_SCAFFOLD_AFFIRMATIVE_PATTERNS = [
    "generate scaffold(?: now)?",
    "start scaffold(?: generation)?",
    "start generation(?: now)?",
    "begin generation(?: now)?",
    "start code generation(?: now)?",
    "start project generation(?: now)?",
    "立即生成",
    "开始生成(?:代码)?脚手架",
    "生成(?:代码)?脚手架",
    "(?:确认无误[,，\\s]*)?开始生成(?:(?:工程(?:代码|骨架)?|代码(?:工程|脚手架)?|脚手架))?",
    "立即开始生成(?:(?:工程(?:代码|骨架)?|代码(?:工程|脚手架)?|脚手架))?",
    "(?:同意[,，\\s]*)?立即生成(?:(?:工程(?:代码|骨架)?|代码(?:工程|脚手架)?|脚手架))?",
    "开始生成工程(?:代码|骨架)",
    "生成工程(?:代码|骨架)"
];
const GENERATE_SCAFFOLD_PATTERN = new RegExp(GENERATE_SCAFFOLD_INTENT_PATTERNS.join("|"), "i");
const OPEN_PRD_PATTERN = /open prd|show prd|prd record|product requirements|打开prd|查看prd|需求记录|prd记录/i;
const DEFER_RESPONSE_PATTERN = /more detail|common options|not sure|add detail|补充|细节|选项|不确定|更多细节|常见选项/i;
const AFFIRMATIVE_RESPONSE_PATTERN = new RegExp([
    "^(?:",
    [
        "yes",
        "y",
        "agree",
        "agreed",
        "proceed",
        "continue",
        "go ahead",
        "do it",
        "recommended",
        "default",
        "confirm",
        "confirmed",
        ...GENERATE_SCAFFOLD_AFFIRMATIVE_PATTERNS,
        "按推荐方案继续",
        "按你推荐的默认方案继续",
        "按默认方案继续",
        "同意",
        "是的",
        "继续"
    ].join("|"),
    ")$"
].join(""), "i");
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

type StudioTab = "architecture" | "prd" | "spec";

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
        case "business_context.platforms":
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

function normalizeEvaluateInteractionMode(value: unknown): EvaluateInteractionMode {
    return value === "chat" ? "chat" : "architecture";
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

    const explicitKind = candidate.kind === "system" || candidate.kind === "chat"
        ? "chat"
        : undefined;
    const explicitQuestionKey =
        typeof candidate.questionKey === "string" && candidate.questionKey.trim()
            ? normalizeQuestionKey(candidate.questionKey)
            : undefined;
    const explicitQuestionAction = normalizeMessageAction(candidate.questionAction) ?? undefined;
    const explicitQuestionRequirementKey = normalizeReadinessRequirementKey(candidate.questionRequirementKey) ?? undefined;
    const explicitQuestionStatus = normalizeMessageQuestionStatus(candidate.questionStatus) ?? undefined;
    const hasExplicitTrackedMetadata =
        role === "assistant" &&
        Boolean(
            explicitQuestionKey ||
            explicitQuestionAction ||
            explicitQuestionRequirementKey ||
            explicitQuestionStatus ||
            Array.isArray(candidate.options)
        );
    const looksLikeTrackedQuestion =
        role === "assistant" && hasExplicitTrackedMetadata;
    const inferredQuestionKey =
        explicitQuestionKey
            ? explicitQuestionKey
            : looksLikeTrackedQuestion && content.trim()
                ? normalizeQuestionKey(normalizeSingleQuestion(content))
                : undefined;
    const inferredQuestionAction =
        explicitQuestionAction ??
        (looksLikeTrackedQuestion && content.trim() ? inferQuestionAction(content) ?? undefined : undefined);
    const inferredQuestionRequirementKey =
        explicitQuestionRequirementKey;
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
        explicitQuestionStatus ??
        (looksLikeTrackedQuestion && inferredQuestionKey ? "pending" : undefined);

    return {
        role,
        content,
        kind: explicitKind,
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

function shouldUseArchitectureInteractionMode() {
    return true;
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

function isGenerationResponse(value: unknown): value is GenerationResponse {
    return Boolean(value && typeof value === "object" && Array.isArray((value as GenerationResponse).projectTree));
}

function inferGenerationOutputMode(generation: GenerationResponse): OutputMode {
    return generation.outputMode === "virtual_spec" ? "virtual_spec" : "virtual_spec";
}

function normalizeGenerationArtifacts(
    value: unknown,
    fallbackGeneration?: GenerationResponse | null
): GenerationArtifacts {
    const artifacts: GenerationArtifacts = {};

    if (value && typeof value === "object") {
        const candidate = value as Partial<GenerationArtifacts>;
        if (isGenerationResponse(candidate.virtual_spec)) {
            artifacts.virtual_spec = candidate.virtual_spec;
        }
        if (!artifacts.virtual_spec && isGenerationResponse(candidate.runnable_scaffold)) {
            artifacts.virtual_spec = candidate.runnable_scaffold;
        }
    }

    if (!artifacts.virtual_spec && isGenerationResponse(fallbackGeneration)) {
        artifacts[inferGenerationOutputMode(fallbackGeneration)] = fallbackGeneration;
    }

    return artifacts;
}

function resolvePrimaryGeneration(
    artifacts: GenerationArtifacts,
    fallbackGeneration?: GenerationResponse | null
): GenerationResponse | null {
    if (artifacts.virtual_spec) return artifacts.virtual_spec;
    return isGenerationResponse(fallbackGeneration) ? fallbackGeneration : null;
}

function getPreferredGeneratedTab(artifacts: GenerationArtifacts): StudioTab {
    if (artifacts.virtual_spec) return "spec";
    return "architecture";
}

function normalizePendingEvaluation(value: unknown): PendingEvaluation | null {
    if (!value || typeof value !== "object") return null;

    const candidate = value as Partial<PendingEvaluation>;
    const requestId = typeof candidate.requestId === "string" ? candidate.requestId.trim() : "";
    const requestMessages = normalizeMessages(candidate.requestMessages);

    if (!requestId || requestMessages.length === 0) {
        return null;
    }

    return {
        requestId,
        requestMessages,
        startedAt: typeof candidate.startedAt === "number" ? candidate.startedAt : Date.now(),
        assistantContent: typeof candidate.assistantContent === "string" ? candidate.assistantContent : "",
        interactionMode: normalizeEvaluateInteractionMode(candidate.interactionMode)
    };
}

function createPendingEvaluationId() {
    return `eval-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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
        .replace(/<\s*\/\s*subgraph\s*>/gi, "\nend\n")
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

function buildAssistantStreamingContent(rawQuestion: string) {
    const normalized = rawQuestion
        .replace(/\r\n/g, "\n")
        .replace(/\u00a0/g, " ")
        .replace(/^\s+/, "")
        .replace(/\n{3,}/g, "\n\n");

    if (!normalized.trim()) return "";

    return normalized
        .split("\n")
        .map((line, index) => index === 0 ? line.trimStart() : line.replace(/\s+$/g, ""))
        .join("\n")
        .trimStart();
}

function buildAssistantFinalContent(rawQuestion: string) {
    return buildAssistantStreamingContent(rawQuestion);
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

function buildPlatformDiscoveryQuestion(language: "zh" | "en") {
    if (language === "zh") {
        const questionText = "这一版产品要优先落在哪个平台？";
        return {
            content: `当前判断：
- 在继续拆分边界和技术栈之前，必须先锁定第一优先平台。
- 我建议先确认“首发平台 + 必须覆盖的运行环境”，这样后面的架构和技术栈建议才不会失真。

需要确认：
${questionText}`,
            options: [
                { label: "Web 应用", value: "先做 Web 应用，需要覆盖桌面和移动浏览器。", action: "fill_requirement" as const, requirementKey: "business_context.platforms" as const },
                { label: "移动 App", value: "先做移动 App，需要覆盖 iOS 和 Android。", action: "fill_requirement" as const, requirementKey: "business_context.platforms" as const },
                { label: "桌面应用", value: "先做桌面应用，需要覆盖 Windows 和 macOS。", action: "fill_requirement" as const, requirementKey: "business_context.platforms" as const },
                { label: "后端服务 / API", value: "先做后端服务或 API，不以界面交付为主。", action: "fill_requirement" as const, requirementKey: "business_context.platforms" as const },
                { label: "给我平台选项", value: "请先给我 2 到 3 个常见平台路线，并说明取舍。" }
            ],
            questionKey: normalizeQuestionKey(questionText),
            questionAction: "fill_requirement" as const,
            questionRequirementKey: "business_context.platforms" as const
        };
    }

    const questionText = "Which platform should this version target first?";
    return {
        content: `Current view:
- Before we go deeper into boundaries and stack choices, we should lock the primary platform first.
- I recommend confirming the launch platform and required runtime targets now so the later architecture and stack advice stays grounded.

Please confirm:
${questionText}`,
        options: [
            { label: "Web app", value: "Start with a web app and cover desktop and mobile browsers.", action: "fill_requirement" as const, requirementKey: "business_context.platforms" as const },
            { label: "Mobile app", value: "Start with a mobile app and cover iOS and Android.", action: "fill_requirement" as const, requirementKey: "business_context.platforms" as const },
            { label: "Desktop app", value: "Start with a desktop app and cover Windows and macOS.", action: "fill_requirement" as const, requirementKey: "business_context.platforms" as const },
            { label: "Backend service / API", value: "Start with a backend service or API rather than a UI-first product.", action: "fill_requirement" as const, requirementKey: "business_context.platforms" as const },
            { label: "Show platform options", value: "Show me 2 or 3 common platform routes and explain the tradeoffs first." }
        ],
        questionKey: normalizeQuestionKey(questionText),
        questionAction: "fill_requirement" as const,
        questionRequirementKey: "business_context.platforms" as const
    };
}

function buildStackRecommendationQuestion(
    language: "zh" | "en",
    architecturePack: ArchitecturePack
) {
    const category = resolvePrimaryPlatformCategory(architecturePack.platformStrategy);
    if (category === "unknown") return null;

    const featureSignal = [
        architecturePack.businessContext.productGoal,
        ...architecturePack.businessContext.userJourneys,
        ...architecturePack.businessContext.constraints,
        ...architecturePack.businessContext.risks,
        ...architecturePack.experienceConstraints.keyScreens
    ].join(" ").toLowerCase();

    const choose = <T,>(preferred: T[], fallback: T[]) => preferred.length > 0 ? preferred : fallback;

    const optionSets = {
        web: /seo|landing|marketing|content|public|payment|subscription/.test(featureSignal)
            ? choose([
                { zh: "Next.js + PostgreSQL", en: "Next.js + PostgreSQL", zhValue: "先按 Next.js + PostgreSQL + Prisma 的 Web 全栈方案推进。", enValue: "Use the Next.js + PostgreSQL + Prisma web full-stack baseline.", zhFit: "适合 SEO、内容页、登录、支付和后台混合场景。", enFit: "Best for SEO, content, auth, payments, and mixed web surfaces.", zhTradeoff: "一体化交付快，但前后端边界更紧。", enTradeoff: "Fast unified delivery, but frontend and server concerns stay more coupled." },
                { zh: "React + Vite + Fastify", en: "React + Vite + Fastify", zhValue: "先按 React + Vite 前端配 Fastify API 的分层方案推进。", enValue: "Use the React + Vite frontend with Fastify API baseline.", zhFit: "适合重交互后台和清晰前后端边界。", enFit: "Best for rich internal tools and clearer frontend/backend separation.", zhTradeoff: "边界更清晰，但 SSR/SEO 需要额外处理。", enTradeoff: "Cleaner separation, but SSR/SEO needs more explicit handling." },
                { zh: "React + Vite + Firebase", en: "React + Vite + Firebase", zhValue: "先按 React + Vite + Firebase 的 MVP 方案推进。", enValue: "Use the React + Vite + Firebase MVP baseline.", zhFit: "适合快速验证和轻量 CRUD MVP。", enFit: "Best for fast validation and lightweight CRUD MVPs.", zhTradeoff: "起步快，但复杂领域模型后期可能迁移。", enTradeoff: "Fast to start, but complex domain logic may need migration later." }
            ], [])
            : /internal|admin|ops|dashboard|editor|realtime|canvas|workflow/.test(featureSignal)
                ? choose([
                    { zh: "React + Vite + Fastify", en: "React + Vite + Fastify", zhValue: "先按 React + Vite 前端配 Fastify API 的分层方案推进。", enValue: "Use the React + Vite frontend with Fastify API baseline.", zhFit: "适合重交互后台和清晰前后端边界。", enFit: "Best for rich internal tools and clearer frontend/backend separation.", zhTradeoff: "边界更清晰，但 SSR/SEO 需要额外处理。", enTradeoff: "Cleaner separation, but SSR/SEO needs more explicit handling." },
                    { zh: "Next.js + PostgreSQL", en: "Next.js + PostgreSQL", zhValue: "先按 Next.js + PostgreSQL + Prisma 的 Web 全栈方案推进。", enValue: "Use the Next.js + PostgreSQL + Prisma web full-stack baseline.", zhFit: "适合既有运营后台又有公开界面的产品。", enFit: "Best when the product mixes internal dashboards with public web pages.", zhTradeoff: "整合度高，但系统边界更紧。", enTradeoff: "Highly integrated, but the system boundary is tighter." },
                    { zh: "React + Vite + Firebase", en: "React + Vite + Firebase", zhValue: "先按 React + Vite + Firebase 的 MVP 方案推进。", enValue: "Use the React + Vite + Firebase MVP baseline.", zhFit: "适合先做轻量验证。", enFit: "Best for lighter validation-first delivery.", zhTradeoff: "简单快，但复杂后端能力会受限。", enTradeoff: "Simple and fast, but complex backend capability is limited." }
                ], [])
                : choose([
                    { zh: "React + Vite + Firebase", en: "React + Vite + Firebase", zhValue: "先按 React + Vite + Firebase 的 MVP 方案推进。", enValue: "Use the React + Vite + Firebase MVP baseline.", zhFit: "适合快速验证和轻量 CRUD MVP。", enFit: "Best for fast validation and lightweight CRUD MVPs.", zhTradeoff: "起步快，但复杂领域模型后期可能迁移。", enTradeoff: "Fast to start, but complex domain logic may need migration later." },
                    { zh: "Next.js + PostgreSQL", en: "Next.js + PostgreSQL", zhValue: "先按 Next.js + PostgreSQL + Prisma 的 Web 全栈方案推进。", enValue: "Use the Next.js + PostgreSQL + Prisma web full-stack baseline.", zhFit: "适合需要 SSR、登录、支付或公开页面的产品。", enFit: "Best for products that need SSR, auth, payments, or public pages.", zhTradeoff: "能力完整，但服务端复杂度更高。", enTradeoff: "More complete, but with higher server complexity." },
                    { zh: "React + Vite + Fastify", en: "React + Vite + Fastify", zhValue: "先按 React + Vite 前端配 Fastify API 的分层方案推进。", enValue: "Use the React + Vite frontend with Fastify API baseline.", zhFit: "适合前后端明确分层。", enFit: "Best for explicit frontend/backend layering.", zhTradeoff: "工程边界清晰，但链路更长。", enTradeoff: "Clearer engineering boundaries, but a longer delivery chain." }
                ], []),
        mobile: /camera|bluetooth|offline|device|native|sensor/.test(featureSignal)
            ? choose([
                { zh: "Native iOS / Android", en: "Native iOS / Android", zhValue: "先按原生 iOS / Android 双端方案推进。", enValue: "Use the native iOS / Android baseline.", zhFit: "适合重设备能力和高性能要求。", enFit: "Best for deep device integration and high-performance needs.", zhTradeoff: "平台能力最强，但双端成本最高。", enTradeoff: "Strongest platform fit, but the highest delivery cost." },
                { zh: "Expo / React Native", en: "Expo / React Native", zhValue: "先按 Expo + React Native 的跨平台移动方案推进。", enValue: "Use the Expo + React Native cross-platform mobile baseline.", zhFit: "适合兼顾速度与跨平台。", enFit: "Best for balancing speed and cross-platform delivery.", zhTradeoff: "共享代码多，但原生深度有限。", enTradeoff: "High code sharing, but less native depth." },
                { zh: "Flutter + Supabase", en: "Flutter + Supabase", zhValue: "先按 Flutter + Supabase 的移动方案推进。", enValue: "Use the Flutter + Supabase mobile baseline.", zhFit: "适合强调一致 UI 和动画。", enFit: "Best when UI consistency and animation matter more.", zhTradeoff: "渲染一致性强，但团队需要接受 Dart。", enTradeoff: "Strong rendering consistency, but the team must adopt Dart." }
            ], [])
            : choose([
                { zh: "Expo / React Native", en: "Expo / React Native", zhValue: "先按 Expo + React Native 的跨平台移动方案推进。", enValue: "Use the Expo + React Native cross-platform mobile baseline.", zhFit: "适合同时覆盖 iOS 和 Android，并保持交付速度。", enFit: "Best for covering iOS and Android with strong delivery speed.", zhTradeoff: "共享代码多，但原生深度有限。", enTradeoff: "High code sharing, but less native depth." },
                { zh: "Flutter + Supabase", en: "Flutter + Supabase", zhValue: "先按 Flutter + Supabase 的移动方案推进。", enValue: "Use the Flutter + Supabase mobile baseline.", zhFit: "适合强调一致 UI 和动画。", enFit: "Best when UI consistency and animation matter more.", zhTradeoff: "渲染一致性强，但团队需要接受 Dart。", enTradeoff: "Strong rendering consistency, but the team must adopt Dart." },
                { zh: "Native iOS / Android", en: "Native iOS / Android", zhValue: "先按原生 iOS / Android 双端方案推进。", enValue: "Use the native iOS / Android baseline.", zhFit: "适合重设备能力和高性能要求。", enFit: "Best for deep device integration and high-performance needs.", zhTradeoff: "平台能力最强，但双端成本最高。", enTradeoff: "Strongest platform fit, but the highest delivery cost." }
            ], []),
        desktop: choose([
            { zh: "Tauri + React", en: "Tauri + React", zhValue: "先按 Tauri + React 的桌面方案推进。", enValue: "Use the Tauri + React desktop baseline.", zhFit: "适合轻量桌面客户端和较低资源占用目标。", enFit: "Best for lightweight desktop apps with lower runtime overhead.", zhTradeoff: "更高效，但生态不如 Electron 成熟。", enTradeoff: "More efficient, but the ecosystem is smaller than Electron." },
            { zh: "Electron + React", en: "Electron + React", zhValue: "先按 Electron + React 的桌面方案推进。", enValue: "Use the Electron + React desktop baseline.", zhFit: "适合插件多和生态成熟度优先。", enFit: "Best when ecosystem maturity matters most.", zhTradeoff: "生态成熟，但资源占用通常更高。", enTradeoff: "Mature ecosystem, but usually heavier at runtime." },
            { zh: "Desktop + API", en: "Desktop + API", zhValue: "先按桌面客户端配独立 API 的分层方案推进。", enValue: "Use a desktop client with a separate API service baseline.", zhFit: "适合桌面端与业务服务严格分层。", enFit: "Best when desktop UI and business services should stay clearly separated.", zhTradeoff: "边界清晰，但整体工程链路更长。", enTradeoff: "Clearer boundaries, but a longer overall delivery chain." }
        ], []),
        backend: choose([
            { zh: "Fastify + PostgreSQL", en: "Fastify + PostgreSQL", zhValue: "先按 Fastify + PostgreSQL 的服务端方案推进。", enValue: "Use the Fastify + PostgreSQL backend baseline.", zhFit: "适合中小型 API 和 TypeScript 团队。", enFit: "Best for small to mid-size APIs and TypeScript-first teams.", zhTradeoff: "轻量直接，但规范需要自己补齐。", enTradeoff: "Lean and fast, but conventions need more manual work." },
            { zh: "NestJS + PostgreSQL", en: "NestJS + PostgreSQL", zhValue: "先按 NestJS + PostgreSQL 的服务端方案推进。", enValue: "Use the NestJS + PostgreSQL backend baseline.", zhFit: "适合模块边界清晰和长期演进系统。", enFit: "Best for systems that need stronger module conventions and long-term scaling.", zhTradeoff: "结构完整，但样板和抽象层更重。", enTradeoff: "More structured, but heavier in abstraction and boilerplate." },
            { zh: "FastAPI + PostgreSQL", en: "FastAPI + PostgreSQL", zhValue: "先按 FastAPI + PostgreSQL 的服务端方案推进。", enValue: "Use the FastAPI + PostgreSQL backend baseline.", zhFit: "适合 Python 数据能力和 AI 集成场景。", enFit: "Best for Python-heavy teams and AI-adjacent backend systems.", zhTradeoff: "Python 生态强，但前后端类型共享较弱。", enTradeoff: "Strong Python ecosystem, but weaker shared typing across frontend and backend." }
        ], []),
        extension: choose([
            { zh: "Plasmo + React", en: "Plasmo + React", zhValue: "先按 Plasmo + React 的浏览器扩展方案推进。", enValue: "Use the Plasmo + React browser extension baseline.", zhFit: "适合快速交付浏览器扩展并复用 React 团队经验。", enFit: "Best for fast extension delivery with React-heavy teams.", zhTradeoff: "上手快，但对底层 MV3 细节封装更多。", enTradeoff: "Fast to ship, but more abstraction sits over raw MV3 details." },
            { zh: "WXT + React/Vue", en: "WXT + React/Vue", zhValue: "先按 WXT 的浏览器扩展方案推进。", enValue: "Use the WXT browser extension baseline.", zhFit: "适合保留前端框架灵活性的扩展项目。", enFit: "Best when framework flexibility still matters.", zhTradeoff: "更灵活，但构建细节更多。", enTradeoff: "More flexible, but asks for more build-system familiarity." },
            { zh: "Raw Manifest V3", en: "Raw Manifest V3", zhValue: "先按原生 Manifest V3 扩展方案推进。", enValue: "Use the raw Manifest V3 extension baseline.", zhFit: "适合体量小且需要直接控制运行时。", enFit: "Best for smaller extensions that need direct runtime control.", zhTradeoff: "控制力最强，但工程效率最低。", enTradeoff: "Maximum control, but the least productive engineering experience." }
        ], []),
        multi: choose([
            { zh: "Next.js + Expo + NestJS", en: "Next.js + Expo + NestJS", zhValue: "先按 Next.js Web + Expo 移动端 + NestJS 后端的多端方案推进。", enValue: "Use the multi-platform baseline with Next.js web, Expo mobile, and NestJS backend.", zhFit: "适合同时规划 Web、移动端与后台 API。", enFit: "Best when web, mobile, and backend need to be planned together.", zhTradeoff: "边界清晰，但整体复杂度最高。", enTradeoff: "Clear boundaries, but the overall system is the most complex." },
            { zh: "Next.js + Expo + Firebase", en: "Next.js + Expo + Firebase", zhValue: "先按 Next.js Web + Expo 移动端 + Firebase 的多端 MVP 方案推进。", enValue: "Use the multi-platform MVP baseline with Next.js web, Expo mobile, and Firebase.", zhFit: "适合多端 MVP 和优先验证业务闭环。", enFit: "Best for small-team multi-platform MVP validation.", zhTradeoff: "起步快，但复杂后端能力后期可能拆分。", enTradeoff: "Fast to start, but complex backend logic may need to split out later." },
            { zh: "Mobile-first + Admin Web", en: "Mobile-first + Admin Web", zhValue: "先按移动端主应用加 Admin Web 的双面方案推进。", enValue: "Use a mobile-first app plus admin web baseline.", zhFit: "适合用户端强移动属性，同时仍需运营后台。", enFit: "Best for mobile-heavy products that still need an admin web surface.", zhTradeoff: "移动体验更强，但 Web 与移动共享度较低。", enTradeoff: "Stronger mobile focus, but less code sharing between web and mobile." }
        ], [])
    } as const;

    let options = optionSets.web;
    switch (category) {
        case "mobile":
            options = optionSets.mobile;
            break;
        case "desktop":
            options = optionSets.desktop;
            break;
        case "backend":
            options = optionSets.backend;
            break;
        case "extension":
            options = optionSets.extension;
            break;
        case "multi":
            options = optionSets.multi;
            break;
        case "web":
        default:
            options = optionSets.web;
            break;
    }
    if (!options || options.length === 0) return null;

    if (language === "zh") {
        const questionText = "这次先按哪条技术栈基线推进？";
        return {
            content: [
                "当前判断：",
                `- ${buildPlatformSummaryLine(architecturePack.platformStrategy) || "平台策略已确认。"} `,
                "- 下一步更合理的做法是先锁定技术栈基线，再继续细化模块边界和交付 guardrails。",
                "",
                "推荐技术栈方案：",
                ...options.flatMap((option, index) => [
                    `${index + 1}. ${option.zh}`,
                    `   - 适配：${option.zhFit}`,
                    `   - 取舍：${option.zhTradeoff}`
                ]),
                "",
                "需要确认：",
                questionText
            ].join("\n"),
            options: [
                ...options.map((option) => ({
                    label: option.zh,
                    value: option.zhValue,
                    action: "fill_requirement" as const,
                    requirementKey: "decisions.decision_records" as const
                })),
                { label: "给我更多方案", value: "请再给我 2 到 3 个备选技术栈，并说明取舍。" }
            ],
            questionKey: normalizeQuestionKey(questionText),
            questionAction: "fill_requirement" as const,
            questionRequirementKey: "decisions.decision_records" as const
        };
    }

    const questionText = "Which stack baseline should we optimize for first?";
    return {
        content: [
            "Current view:",
            `- ${buildPlatformSummaryLine(architecturePack.platformStrategy) || "Platform strategy is confirmed."}`,
            "- The next useful step is to lock the stack baseline before we keep refining module boundaries and delivery guardrails.",
            "",
            "Recommended stack options:",
            ...options.flatMap((option, index) => [
                `${index + 1}. ${option.en}`,
                `   - Fit: ${option.enFit}`,
                `   - Tradeoff: ${option.enTradeoff}`
            ]),
            "",
            "Please confirm:",
            questionText
        ].join("\n"),
        options: [
            ...options.map((option) => ({
                label: option.en,
                value: option.enValue,
                action: "fill_requirement" as const,
                requirementKey: "decisions.decision_records" as const
            })),
            { label: "Show more options", value: "Show me 2 or 3 more stack options and explain the tradeoffs." }
        ],
        questionKey: normalizeQuestionKey(questionText),
        questionAction: "fill_requirement" as const,
        questionRequirementKey: "decisions.decision_records" as const
    };
}

function shouldPrioritizePlatformQuestion(architecturePack: ArchitecturePack) {
    return !hasConfirmedPlatformStrategy(architecturePack.platformStrategy);
}

function getReadinessRequirementLabel(
    requirementKey: ReadinessRequirementKey,
    language: "zh" | "en"
) {
    const labels: Record<ReadinessRequirementKey, { zh: string; en: string }> = {
        "business_context.product_goal": { zh: "产品目标", en: "product goal" },
        "business_context.platforms": { zh: "平台策略", en: "platform strategy" },
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
    if (requirementKey === "business_context.platforms") {
        const platformQuestion = buildPlatformDiscoveryQuestion(language);
        return {
            content: platformQuestion.content,
            options: platformQuestion.options,
            questionKey: platformQuestion.questionKey,
            questionAction: platformQuestion.questionAction ?? null,
            questionRequirementKey: requirementKey
        };
    }

    if (requirementKey === "boundaries.data_ownership") {
        const content = language === "zh"
            ? `当前判断：
- 现在只缺一条明确的数据归属规则，后面的隐私边界和保留策略才有依据。
- 我推荐默认采用“用户拥有提交的想法与分析结果，平台仅为提供服务而处理，默认保留 30 天”的方案。

需要确认：
是否按推荐应用这条数据归属默认规则？`
            : `Current view:
- We still need one explicit data ownership rule so the privacy and retention boundary stays clear.
- I recommend the default policy that users own submitted ideas and analysis results, while the product only processes them to deliver the service with a default 30-day retention window.

Please confirm:
Should I apply this default data ownership rule now?`;

        const questionText = language === "zh"
            ? "是否按推荐应用这条数据归属默认规则？"
            : "Should I apply this default data ownership rule now?";

        return {
            content,
            options: language === "zh"
                ? [
                    { label: "按推荐应用", value: "请按推荐应用这条数据归属默认规则。", action: "fill_requirement" as const, requirementKey },
                    { label: "我来指定规则", value: "我来指定自定义的数据归属与保留期。" },
                    { label: "列出当前阻塞项", value: "请列出当前阻塞项。", action: "show_blockers" as const, requirementKey }
                ]
                : [
                    { label: "Apply the default", value: "Apply the default data ownership rule.", action: "fill_requirement" as const, requirementKey },
                    { label: "I will define it", value: "I will define a custom ownership and retention policy." },
                    { label: "List blockers", value: "List the current blockers.", action: "show_blockers" as const, requirementKey }
                ],
            questionKey: normalizeQuestionKey(questionText),
            questionAction: "fill_requirement" as const,
            questionRequirementKey: requirementKey
        };
    }

    if (
        requirementKey === "business_context.target_users"
    ) {
        const questionText = language === "zh"
            ? "这一版最核心的目标用户是谁？"
            : "Who is the core target user for v1?";
        return {
            content: language === "zh"
                ? `我们先把目标用户说具体一点。
我建议第一版先锁定一类高频使用者，避免范围一开始就过散。

${questionText}`
                : `Let's make the target user more specific.
I recommend locking one high-frequency user group first so the scope does not drift too early.

${questionText}`,
            options: language === "zh"
                ? [
                    { label: "按推荐补齐", value: "请按推荐先补齐目标用户。", action: "fill_requirement" as const, requirementKey },
                    { label: "我来自己定义", value: "我来手动描述目标用户。" },
                    { label: "给我示例", value: "先给我 2 个具体的目标用户示例。" }
                ]
                : [
                    { label: "Use your default", value: "Use your recommended default target users.", action: "fill_requirement" as const, requirementKey },
                    { label: "I will define it", value: "I will describe the target users myself." },
                    { label: "Show examples", value: "Show me 2 concrete target-user examples first." }
                ],
            questionKey: normalizeQuestionKey(questionText),
            questionAction: "fill_requirement" as const,
            questionRequirementKey: requirementKey
        };
    }

    if (requirementKey === "business_context.user_journeys") {
        const questionText = language === "zh"
            ? "请先给我两条最关键的用户流程。"
            : "Please give me the two most important user journeys first.";
        return {
            content: language === "zh"
                ? `接下来把用户旅程说清楚。
我建议至少覆盖“如何开始一次任务”和“结果产出后如何继续处理”这两条主流程。

${questionText}`
                : `Next, let's make the user journeys explicit.
I recommend covering at least how a user starts a task and what they do after the result is produced.

${questionText}`,
            options: language === "zh"
                ? [
                    { label: "按推荐补齐", value: "请按推荐补齐关键用户旅程。", action: "fill_requirement" as const, requirementKey },
                    { label: "我来自己描述", value: "我来手动描述两条关键用户旅程。" },
                    { label: "给我示例", value: "先给我两条参考用户旅程。" }
                ]
                : [
                    { label: "Use your default", value: "Fill the key user journeys using your recommended defaults.", action: "fill_requirement" as const, requirementKey },
                    { label: "I will describe them", value: "I will describe the two key user journeys myself." },
                    { label: "Show examples", value: "Show me two reference user journeys first." }
                ],
            questionKey: normalizeQuestionKey(questionText),
            questionAction: "fill_requirement" as const,
            questionRequirementKey: requirementKey
        };
    }

    if (requirementKey === "business_context.constraints_or_risks") {
        const questionText = language === "zh"
            ? "这版产品最需要提前防住的两个约束或风险是什么？"
            : "What are the two most important constraints or risks to account for now?";
        return {
            content: language === "zh"
                ? `我们再把约束和风险补上。
我建议优先说清交付边界、成本/性能压力，或者质量可信度这类会直接影响方案的因素。

${questionText}`
                : `Let's add the constraints and risks next.
I recommend prioritizing delivery boundaries, cost or performance pressure, or quality-confidence risks that directly shape the design.

${questionText}`,
            options: language === "zh"
                ? [
                    { label: "按推荐补齐", value: "请按推荐补齐约束与风险。", action: "fill_requirement" as const, requirementKey },
                    { label: "我来自己定义", value: "我来手动描述约束与风险。" },
                    { label: "给我示例", value: "先给我两个常见约束与风险示例。" }
                ]
                : [
                    { label: "Use your default", value: "Fill the constraints and risks using your recommended defaults.", action: "fill_requirement" as const, requirementKey },
                    { label: "I will define them", value: "I will describe the constraints and risks myself." },
                    { label: "Show examples", value: "Show me two common constraint and risk examples first." }
                ],
            questionKey: normalizeQuestionKey(questionText),
            questionAction: "fill_requirement" as const,
            questionRequirementKey: requirementKey
        };
    }

    if (requirementKey === "boundaries.bounded_contexts") {
        const questionText = language === "zh"
            ? "你希望先把哪一块定义成独立限界上下文？"
            : "Which part should we define as its own bounded context first?";
        return {
            content: language === "zh"
                ? `现在先把系统边界切开，避免后面所有职责混在一起。
我建议至少先定一个独立上下文，比如工作区、生成引擎、素材管理或账号/计费中的一块。

${questionText}`
                : `Let's separate the system boundary now so responsibilities do not collapse into one blob later.
I recommend locking at least one bounded context such as workspace, generation engine, asset management, or account/billing.

${questionText}`,
            options: language === "zh"
                ? [
                    { label: "按推荐补齐", value: "请按推荐补齐限界上下文。", action: "fill_requirement" as const, requirementKey },
                    { label: "我来自己拆分", value: "我来手动定义限界上下文。" },
                    { label: "给我示例", value: "先给我 2 到 3 个常见的限界上下文示例。" }
                ]
                : [
                    { label: "Use your default", value: "Fill the bounded contexts using your recommended defaults.", action: "fill_requirement" as const, requirementKey },
                    { label: "I will define it", value: "I will define the bounded contexts myself." },
                    { label: "Show examples", value: "Show me 2 or 3 common bounded-context examples first." }
                ],
            questionKey: normalizeQuestionKey(questionText),
            questionAction: "fill_requirement" as const,
            questionRequirementKey: requirementKey
        };
    }

    if (requirementKey === "boundaries.module_responsibilities") {
        const questionText = language === "zh"
            ? "第一版必须有的两个核心模块分别负责什么？"
            : "What should the two must-have core modules for v1 each be responsible for?";
        return {
            content: language === "zh"
                ? `接下来把模块职责钉住。
我建议至少先把“输入 / 工作区”和“生成 / 处理”这两类职责拆开，不要后面边做边猜。

${questionText}`
                : `Next, let's pin down the module responsibilities.
I recommend separating input or workspace concerns from generation or processing concerns early instead of discovering that boundary during implementation.

${questionText}`,
            options: language === "zh"
                ? [
                    { label: "按推荐补齐", value: "请按推荐补齐模块职责。", action: "fill_requirement" as const, requirementKey },
                    { label: "我来自己定义", value: "我来手动描述模块职责。" },
                    { label: "给我示例", value: "先给我两个参考模块职责。" }
                ]
                : [
                    { label: "Use your default", value: "Fill the module responsibilities using your recommended defaults.", action: "fill_requirement" as const, requirementKey },
                    { label: "I will define them", value: "I will describe the module responsibilities myself." },
                    { label: "Show examples", value: "Show me two reference module responsibilities first." }
                ],
            questionKey: normalizeQuestionKey(questionText),
            questionAction: "fill_requirement" as const,
            questionRequirementKey: requirementKey
        };
    }

    if (requirementKey === "decisions.decision_records") {
        const questionText = language === "zh"
            ? "这一步需要锁定关键架构决策。是否先按推荐把“工作区 / 编辑层”和“生成编排层”拆开？"
            : "We need to lock a key architecture decision at this stage. Should we separate the workspace or editor layer from the generation-orchestration layer?";
        return {
            content: language === "zh"
                ? `接下来先锁一条高影响架构决策。
我建议先确认“工作区 / 编辑交互”和“生成编排 / 模型调用”是否解耦，这会直接影响后续边界和扩展性。

${questionText}`
                : `Next, let's lock one high-impact architecture decision.
I recommend deciding whether the workspace or editor interaction layer should stay separate from the generation-orchestration and model-calling layer because that choice will shape the downstream boundaries.

${questionText}`,
            options: language === "zh"
                ? [
                    { label: "按推荐记录", value: "请按推荐补齐这条架构决策。", action: "fill_requirement" as const, requirementKey },
                    { label: "我来自己定义", value: "我来手动描述这条架构决策。" },
                    { label: "给我 2 个方向", value: "先给我两条常见的第二架构决策方向。" }
                ]
                : [
                    { label: "Use your default", value: "Add the recommended second architecture decision.", action: "fill_requirement" as const, requirementKey },
                    { label: "I will define it", value: "I will describe the architecture decision myself." },
                    { label: "Show options", value: "Show me two common directions for the second architecture decision first." }
                ],
            questionKey: normalizeQuestionKey(questionText),
            questionAction: "fill_requirement" as const,
            questionRequirementKey: requirementKey
        };
    }

    if (requirementKey === "decisions.integration_contracts") {
        const questionText = language === "zh"
            ? "要不要先按默认方式记一条关键输入输出契约？"
            : "Should I record a default key input-output contract now?";
        return {
            content: language === "zh"
                ? `再补一条关键集成契约，这样后面的模块边界才不会发散。
我建议先定义“提交请求 -> 返回草稿 / 结果”的输入输出边界。

${questionText}`
                : `Let's add one key integration contract so the module boundary stays concrete.
I recommend defining the input-output contract for submitting a request and receiving a draft or result.

${questionText}`,
            options: language === "zh"
                ? [
                    { label: "按推荐补齐", value: "请按推荐补齐集成契约。", action: "fill_requirement" as const, requirementKey },
                    { label: "我来自己定义", value: "我来手动描述关键集成契约。" },
                    { label: "给我示例", value: "先给我一个参考契约示例。" }
                ]
                : [
                    { label: "Use your default", value: "Fill the integration contract using your recommended default.", action: "fill_requirement" as const, requirementKey },
                    { label: "I will define it", value: "I will describe the key integration contract myself." },
                    { label: "Show example", value: "Show me a reference integration contract first." }
                ],
            questionKey: normalizeQuestionKey(questionText),
            questionAction: "fill_requirement" as const,
            questionRequirementKey: requirementKey
        };
    }

    if (requirementKey === "decisions.non_functional_requirements") {
        const content = language === "zh"
            ? `再补齐非功能性要求，这样第一版的质量边界才清楚。
我建议优先把“响应速度”和“结果稳定性 / 可信度”这类会直接影响体验的要求写进去。

是否按推荐补齐这项非功能性要求？`
            : `Let's finish the non-functional requirements so the v1 quality bar is explicit.
I recommend prioritizing response speed and output stability or confidence because they directly shape the user experience.

Should I add the recommended non-functional requirement now?`;

        const questionText = language === "zh"
            ? "是否按推荐补齐这项非功能性要求？"
            : "Should I add the recommended non-functional requirement now?";

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

    if (requirementKey === "guardrails.implementation_order") {
        const questionText = language === "zh"
            ? "要不要先按默认实施顺序把第一版拆出来？"
            : "Should I break v1 down using the default implementation order now?";
        return {
            content: language === "zh"
                ? `接下来把实施顺序钉住，避免大家同时开工却没有主线。
我建议先做核心主流程，再补结果呈现和打磨项。

${questionText}`
                : `Next, let's lock the implementation order so the team has one clear path instead of parallel guesswork.
I recommend building the core flow first and then layering in result presentation and polish.

${questionText}`,
            options: language === "zh"
                ? [
                    { label: "按推荐补齐", value: "请按推荐补齐实现顺序。", action: "fill_requirement" as const, requirementKey },
                    { label: "我来自己定义", value: "我来手动定义实施顺序。" },
                    { label: "给我示例", value: "先给我一个参考实施顺序。" }
                ]
                : [
                    { label: "Use your default", value: "Fill the implementation order using your recommended default.", action: "fill_requirement" as const, requirementKey },
                    { label: "I will define it", value: "I will describe the implementation order myself." },
                    { label: "Show example", value: "Show me a reference implementation order first." }
                ],
            questionKey: normalizeQuestionKey(questionText),
            questionAction: "fill_requirement" as const,
            questionRequirementKey: requirementKey
        };
    }

    if (requirementKey === "guardrails.acceptance_criteria") {
        const questionText = language === "zh"
            ? "要不要先按默认方式补齐验收标准？"
            : "Should I add the default acceptance criteria now?";
        return {
            content: language === "zh"
                ? `我们还需要一组可验收标准，避免后面只能靠“感觉差不多”来收尾。
我建议先围绕“能否完成一次完整主流程”和“结果是否可复查”来写。

${questionText}`
                : `We still need acceptance criteria so the handoff is not based on vague gut feel.
I recommend anchoring them around whether one full core flow works and whether the result can be reviewed again.

${questionText}`,
            options: language === "zh"
                ? [
                    { label: "按推荐补齐", value: "请按推荐补齐验收标准。", action: "fill_requirement" as const, requirementKey },
                    { label: "我来自己定义", value: "我来手动定义验收标准。" },
                    { label: "给我示例", value: "先给我 4 条参考验收标准。" }
                ]
                : [
                    { label: "Use your default", value: "Fill the acceptance criteria using your recommended defaults.", action: "fill_requirement" as const, requirementKey },
                    { label: "I will define them", value: "I will describe the acceptance criteria myself." },
                    { label: "Show examples", value: "Show me 4 reference acceptance criteria first." }
                ],
            questionKey: normalizeQuestionKey(questionText),
            questionAction: "fill_requirement" as const,
            questionRequirementKey: requirementKey
        };
    }

    if (requirementKey === "guardrails.test_strategy") {
        const questionText = language === "zh"
            ? "要不要先按默认方式补齐测试策略？"
            : "Should I add the default test strategy now?";
        return {
            content: language === "zh"
                ? `最后把测试策略补上，后面实现时就不容易漏掉关键验证。
我建议至少覆盖一次主链路端到端验证，再补关键逻辑的单元测试。

${questionText}`
                : `Let's finish the test strategy so implementation does not miss the most important validation work.
I recommend covering one end-to-end happy path and then adding unit tests for the key logic.

${questionText}`,
            options: language === "zh"
                ? [
                    { label: "按推荐补齐", value: "请按推荐补齐测试策略。", action: "fill_requirement" as const, requirementKey },
                    { label: "我来自己定义", value: "我来手动定义测试策略。" },
                    { label: "给我示例", value: "先给我两条参考测试策略。" }
                ]
                : [
                    { label: "Use your default", value: "Fill the test strategy using your recommended defaults.", action: "fill_requirement" as const, requirementKey },
                    { label: "I will define it", value: "I will describe the test strategy myself." },
                    { label: "Show examples", value: "Show me two reference test-strategy items first." }
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
        ? `现在最该补的是“${label}”。
我建议先把这一项补齐，然后我直接带你进入下一条真正的缺口。`
        : `The most useful thing to fix next is ${label}.
I recommend filling it now, and then I will move us straight to the next real gap.`;
    const questionText = language === "zh" ? `是否先补齐“${label}”？` : `Should we fill ${label} first?`;

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

type PrdDecisionLogItem = {
    title: string;
    detail: string;
};

type CanonicalPrdViewModel = {
    summaryLines: string[];
    clarifiedItems: string[];
    openQuestions: string[];
    architectureSnapshot: string[];
    decisionLog: PrdDecisionLogItem[];
    guardrailItems: string[];
};

function appendUniquePrdLine(target: string[], line: string | null | undefined, maxChars: number = 220) {
    const normalized = clipText((line || "").trim(), maxChars);
    if (!normalized) return;
    if (target.some((item) => item.toLowerCase() === normalized.toLowerCase())) return;
    target.push(normalized);
}

function joinPrdItems(language: "zh" | "en", items: string[], maxItems: number = 3) {
    const normalized = items
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, maxItems);
    if (normalized.length === 0) return "";
    return normalized.join(language === "zh" ? "、" : ", ");
}

function buildPrdProgressLine(
    language: "zh" | "en",
    readiness: ReadinessChecklist,
    minimumViableLoop: MinimumViableLoopChecklist
) {
    const readinessText = `${Math.round(readiness.score)}%`;
    const mvlText = minimumViableLoop.ready
        ? (language === "zh" ? "已就绪" : "ready")
        : `${Math.round(minimumViableLoop.score)}%`;
    const nextMilestone = clipText(
        minimumViableLoop.nextMilestone || readiness.nextMilestone || "",
        96
    );
    return language === "zh"
        ? `当前完成度 ${readinessText} | MVL ${mvlText}${nextMilestone ? ` | 下一步：${nextMilestone}` : ""}`
        : `Readiness ${readinessText} | MVL ${mvlText}${nextMilestone ? ` | Next: ${nextMilestone}` : ""}`;
}

function buildCanonicalPrdViewModel(
    language: "zh" | "en",
    architecturePack: ArchitecturePack,
    decisionRecords: DecisionRecord[],
    guardrailChecklist: GuardrailChecklist,
    readiness: ReadinessChecklist,
    minimumViableLoop: MinimumViableLoopChecklist
): CanonicalPrdViewModel {
    const summaryLines: string[] = [];
    const clarifiedItems: string[] = [];
    const openQuestions: string[] = [];
    const architectureSnapshot: string[] = [];
    const decisionLog: PrdDecisionLogItem[] = [];
    const guardrailItems: string[] = [];
    const platformSummary = buildPlatformSummaryLine(architecturePack.platformStrategy);
    const progressLine = buildPrdProgressLine(language, readiness, minimumViableLoop);
    const targetUsers = joinPrdItems(language, architecturePack.businessContext.targetUsers);
    const userJourneys = joinPrdItems(language, architecturePack.businessContext.userJourneys);
    const constraints = joinPrdItems(language, architecturePack.businessContext.constraints);
    const risks = joinPrdItems(language, architecturePack.businessContext.risks);
    const boundedContexts = joinPrdItems(language, architecturePack.boundedContexts.map((item) => item.name));
    const modules = joinPrdItems(language, architecturePack.moduleResponsibilities.map((item) => item.module));
    const dataOwnership = joinPrdItems(language, architecturePack.dataOwnership.map((item) => `${item.data} -> ${item.owner}`));
    const integrationContracts = joinPrdItems(language, architecturePack.integrationContracts.map((item) => item.name));
    const nonFunctionalRequirements = joinPrdItems(language, architecturePack.nonFunctionalRequirements.map((item) => item.requirement));
    const keyScreens = joinPrdItems(language, architecturePack.experienceConstraints.keyScreens);
    const sharedComponents = joinPrdItems(language, architecturePack.experienceConstraints.uiComponents);
    const responsiveStrategy = joinPrdItems(language, architecturePack.experienceConstraints.responsiveStrategy);

    appendUniquePrdLine(summaryLines, architecturePack.businessContext.productGoal.trim(), 180);
    appendUniquePrdLine(summaryLines, platformSummary, 180);
    appendUniquePrdLine(
        summaryLines,
        targetUsers
            ? language === "zh"
                ? `目标用户：${targetUsers}`
                : `Target users: ${targetUsers}`
            : null
    );
    appendUniquePrdLine(
        summaryLines,
        userJourneys
            ? language === "zh"
                ? `关键流程：${userJourneys}`
                : `Key journeys: ${userJourneys}`
            : null
    );
    appendUniquePrdLine(summaryLines, progressLine, 180);

    if (summaryLines.length === 0) {
        appendUniquePrdLine(
            summaryLines,
            language === "zh"
                ? `当前完成度 ${Math.round(readiness.score)}%，请继续补充产品目标与关键流程。`
                : `Current readiness is ${Math.round(readiness.score)}%. Continue clarifying the product goal and key flows.`
        );
    }

    appendUniquePrdLine(
        clarifiedItems,
        architecturePack.businessContext.productGoal.trim()
            ? language === "zh"
                ? `产品目标：${architecturePack.businessContext.productGoal.trim()}`
                : `Product goal: ${architecturePack.businessContext.productGoal.trim()}`
            : null
    );
    appendUniquePrdLine(
        clarifiedItems,
        targetUsers
            ? language === "zh"
                ? `目标用户：${targetUsers}`
                : `Target users: ${targetUsers}`
            : null
    );
    appendUniquePrdLine(
        clarifiedItems,
        userJourneys
            ? language === "zh"
                ? `关键流程：${userJourneys}`
                : `Key journeys: ${userJourneys}`
            : null
    );
    appendUniquePrdLine(
        clarifiedItems,
        constraints
            ? language === "zh"
                ? `约束条件：${constraints}`
                : `Constraints: ${constraints}`
            : null
    );
    appendUniquePrdLine(
        clarifiedItems,
        risks
            ? language === "zh"
                ? `主要风险：${risks}`
                : `Risks: ${risks}`
            : null
    );
    appendUniquePrdLine(
        clarifiedItems,
        boundedContexts
            ? language === "zh"
                ? `限界上下文：${boundedContexts}`
                : `Bounded contexts: ${boundedContexts}`
            : null
    );
    appendUniquePrdLine(
        clarifiedItems,
        modules
            ? language === "zh"
                ? `核心模块：${modules}`
                : `Core modules: ${modules}`
            : null
    );
    appendUniquePrdLine(
        clarifiedItems,
        dataOwnership
            ? language === "zh"
                ? `数据归属：${dataOwnership}`
                : `Data ownership: ${dataOwnership}`
            : null
    );
    appendUniquePrdLine(
        clarifiedItems,
        integrationContracts
            ? language === "zh"
                ? `集成契约：${integrationContracts}`
                : `Integration contracts: ${integrationContracts}`
            : null
    );
    appendUniquePrdLine(
        clarifiedItems,
        nonFunctionalRequirements
            ? language === "zh"
                ? `非功能性需求：${nonFunctionalRequirements}`
                : `Non-functional requirements: ${nonFunctionalRequirements}`
            : null
    );
    appendUniquePrdLine(
        clarifiedItems,
        keyScreens
            ? language === "zh"
                ? `关键界面：${keyScreens}`
                : `Key screens: ${keyScreens}`
            : null
    );
    appendUniquePrdLine(
        clarifiedItems,
        sharedComponents
            ? language === "zh"
                ? `共享组件：${sharedComponents}`
                : `Shared components: ${sharedComponents}`
            : null
    );
    appendUniquePrdLine(
        clarifiedItems,
        responsiveStrategy
            ? language === "zh"
                ? `响应式策略：${responsiveStrategy}`
                : `Responsive strategy: ${responsiveStrategy}`
            : null
    );

    const incompleteRequirements = readiness.criteria.flatMap((criterion) =>
        criterion.requirements.filter((requirement) => requirement.status === "missing" || requirement.status === "partial")
    );
    for (const requirement of incompleteRequirements.slice(0, 8)) {
        const label = getReadinessRequirementLabel(requirement.key, language);
        const missingDetail = translateReadinessText(
            language,
            requirement.missing[0] || (
                language === "zh"
                    ? `请继续补齐${label}。`
                    : `Please clarify ${label}.`
            )
        );
        appendUniquePrdLine(
            openQuestions,
            language === "zh"
                ? `${label}：${missingDetail}`
                : `${label}: ${missingDetail}`,
            180
        );
    }

    appendUniquePrdLine(architectureSnapshot, platformSummary, 180);
    appendUniquePrdLine(
        architectureSnapshot,
        boundedContexts
            ? language === "zh"
                ? `限界上下文：${boundedContexts}`
                : `Bounded contexts: ${boundedContexts}`
            : null
    );
    appendUniquePrdLine(
        architectureSnapshot,
        modules
            ? language === "zh"
                ? `核心模块：${modules}`
                : `Core modules: ${modules}`
            : null
    );
    appendUniquePrdLine(
        architectureSnapshot,
        integrationContracts
            ? language === "zh"
                ? `集成契约：${integrationContracts}`
                : `Integration contracts: ${integrationContracts}`
            : null
    );
    appendUniquePrdLine(
        architectureSnapshot,
        keyScreens
            ? language === "zh"
                ? `关键界面：${keyScreens}`
                : `Key screens: ${keyScreens}`
            : null
    );
    appendUniquePrdLine(architectureSnapshot, progressLine, 180);

    for (const record of decisionRecords.slice(0, 5)) {
        const title = clipText((record.title || record.decision || "").trim(), 120);
        const detail = clipText((record.rationale || record.decision || "").trim(), 180);
        if (!title && !detail) continue;
        decisionLog.push({
            title: title || detail,
            detail: detail || title
        });
    }

    for (const item of guardrailChecklist.implementationOrder.slice(0, 3)) {
        appendUniquePrdLine(
            guardrailItems,
            language === "zh" ? `实现顺序：${item}` : `Implementation order: ${item}`
        );
    }
    for (const item of guardrailChecklist.acceptanceCriteria.slice(0, 3)) {
        appendUniquePrdLine(
            guardrailItems,
            language === "zh" ? `验收标准：${item}` : `Acceptance criteria: ${item}`
        );
    }
    for (const item of guardrailChecklist.testStrategy.slice(0, 2)) {
        appendUniquePrdLine(
            guardrailItems,
            language === "zh" ? `测试策略：${item}` : `Test strategy: ${item}`
        );
    }

    return {
        summaryLines: summaryLines.slice(0, 5),
        clarifiedItems: clarifiedItems.slice(0, 10),
        openQuestions: openQuestions.slice(0, 8),
        architectureSnapshot: architectureSnapshot.slice(0, 6),
        decisionLog,
        guardrailItems: guardrailItems.slice(0, 8)
    };
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

function buildNextArchitectureFollowUpQuestion(
    language: "zh" | "en",
    architectureStage: ArchitectureStage,
    readiness: ReadinessChecklist,
    architecturePack: ArchitecturePack,
    messages: Message[]
) {
    if (shouldPrioritizePlatformQuestion(architecturePack)) {
        return buildPlatformDiscoveryQuestion(language);
    }

    const primaryRequirement = getPrimaryIncompleteReadinessRequirement(readiness);
    if (primaryRequirement) {
        return buildFocusedRequirementQuestion(
            language,
            primaryRequirement.key,
            architecturePack,
            messages
        );
    }

    return buildBlockedGenerateQuestion(
        language,
        architectureStage,
        readiness,
        architecturePack,
        messages
    );
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

function extractCompletedAssistantText(
    raw: string
) {
    const normalized = raw.replace(/\r\n/g, "\n").trim();
    if (!normalized) return "";

    const questionMatch = normalized.match(/<question>([\s\S]*?)<\/question>/i);
    if (!questionMatch?.[1]) return "";

    return buildAssistantFinalContent(questionMatch[1]);
}

function extractFallbackAssistantText(
    raw: string
) {
    const normalized = raw.replace(/\r\n/g, "\n").trim();
    if (!normalized) return "";

    const questionMatch = normalized.match(/<question>([\s\S]*?)(?:<\/question>|$)/i);
    if (questionMatch && questionMatch[1]) {
        const questionText = buildAssistantFinalContent(questionMatch[1]);
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

function parseOptionActionToken(value: string): MessageAction | null {
    const normalized = stripWrappingQuotes(value)
        .trim()
        .replace(/^action\s*[:=]\s*/i, "");
    return normalizeMessageAction(normalized);
}

function parseOptionsBlock(raw: string): MessageOption[] {
    const parsed = raw
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => line.replace(/^[-*]\s*/, ""))
        .map((line) => stripWrappingQuotes(line))
        .map((line) => {
            const segments = line.split("::").map((segment) => stripWrappingQuotes(segment));
            const [rawLabel, ...rest] = segments;
            const label = stripWrappingQuotes(rawLabel || "");
            const trailingAction = rest.length >= 2
                ? parseOptionActionToken(rest[rest.length - 1] || "")
                : null;
            const valueSegments = trailingAction ? rest.slice(0, -1) : rest;
            const valueRaw = stripWrappingQuotes(valueSegments.join("::"));
            const value = valueRaw || label;

            if (!label && !value) return null;
            return {
                label: label || value,
                value,
                action: trailingAction ?? undefined
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

function areMessageOptionsEqual(
    left?: MessageOption[] | null,
    right?: MessageOption[] | null
) {
    const normalizedLeft = left && left.length > 0 ? left : undefined;
    const normalizedRight = right && right.length > 0 ? right : undefined;

    if (!normalizedLeft && !normalizedRight) return true;
    if (!normalizedLeft || !normalizedRight) return false;
    if (normalizedLeft.length !== normalizedRight.length) return false;

    return normalizedLeft.every((option, index) => {
        const candidate = normalizedRight[index];
        return Boolean(candidate) &&
            option.label === candidate.label &&
            option.value === candidate.value &&
            option.action === candidate.action &&
            option.questionKey === candidate.questionKey &&
            option.requirementKey === candidate.requirementKey &&
            option.stale === candidate.stale;
    });
}

function extractStreamingOptionsBlock(raw: string): string | null {
    const match = raw.match(
        /<options>([\s\S]*?)(<\/options>|(?=\r?\n\s*<(?!\/?options\b)[a-z_][\w-]*>)|$)/i
    );
    if (!match) return null;

    let content = match[1] ?? "";
    const terminator = match[2] ?? "";
    const hasClosedOptions = /^<\/options>$/i.test(terminator.trim());

    // Hold back the last partial option line until the model finishes that line.
    if (!hasClosedOptions && !/[\r\n]\s*$/.test(content)) {
        const lastLineBreak = Math.max(content.lastIndexOf("\n"), content.lastIndexOf("\r"));
        content = lastLineBreak >= 0 ? content.slice(0, lastLineBreak) : "";
    }

    return content;
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

    const history = messages
        .filter((message) => message.kind !== "system")
        .slice(-historySize);
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
    interactionMode: EvaluateInteractionMode,
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
        interactionMode,
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

function compactGenerationForStorage(generation: GenerationResponse | null): GenerationResponse | null {
    return generation
        ? {
            ...generation,
            projectTree: compactProjectTreeForPricing(generation.projectTree)
        }
        : null;
}

function compactGenerationArtifactsForStorage(artifacts: GenerationArtifacts): GenerationArtifacts {
    return {
        virtual_spec: compactGenerationForStorage(artifacts.virtual_spec ?? null)
    };
}

function buildPricingProjectSnapshot(
    project: Project | null,
    currentVersion: ProjectVersion | null,
    messages: Message[],
    evaluation: EvaluationResponse | null,
    generation: GenerationResponse | null,
    generationArtifacts: GenerationArtifacts,
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
        kind: message.kind,
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

    const compactGenerationArtifacts = compactGenerationArtifactsForStorage(generationArtifacts);
    const compactGeneration = resolvePrimaryGeneration(
        compactGenerationArtifacts,
        compactGenerationForStorage(generation)
    );

    const snapshotVersion: ProjectVersion = {
        ...currentVersion,
        data: {
            ...currentVersion.data,
            messages: compactMessages,
            evaluation,
            generation: compactGeneration,
            generationArtifacts: compactGenerationArtifacts,
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

function resolveProjectVersionForWizard(sourceProject: Project, versionId: string | null) {
    if (sourceProject.versions.length === 0) return null;
    if (versionId) {
        return sourceProject.versions.find((candidate) => candidate.id === versionId)
            ?? sourceProject.versions[sourceProject.versions.length - 1];
    }
    return sourceProject.versions[sourceProject.versions.length - 1];
}

function WizardContent() {
    const router = useRouter();
    const { beginNavigation } = useNavigationFeedback();
    const searchParams = useSearchParams();
    const projectId = searchParams.get("projectId");
    const versionId = searchParams.get("versionId");
    const cachedSnapshot = getCachedProjectSnapshot(projectId, versionId);
    const initialNormalizedState = normalizeVersionDesignState(cachedSnapshot?.data ?? null);
    const initialGenerationArtifacts = normalizeGenerationArtifacts(
        cachedSnapshot?.data?.generationArtifacts ?? null,
        cachedSnapshot?.data?.generation ?? null
    );
    const rawCachedStage = (cachedSnapshot?.data as { designStage?: unknown } | undefined)?.designStage;
    const initialEvaluation = initialNormalizedState.evaluation;
    const initialUiDesignSpec = initialNormalizedState.uiDesignSpec;
    const initialUiDesignState = initialNormalizedState.uiDesignState;
    const initialPendingEvaluation = normalizePendingEvaluation(cachedSnapshot?.data?.pendingEvaluation);
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
    const hasUserEditedRef = useRef(false);

    const [messages, setMessages] = useState<Message[]>(initialNormalizedState.messages);
    const [pendingEvaluation, setPendingEvaluation] = useState<PendingEvaluation | null>(initialPendingEvaluation);
    const [input, setInput] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [messageWindow, setMessageWindow] = useState(MESSAGE_WINDOW_SIZE);
    const messagesRef = useRef<Message[]>(initialNormalizedState.messages);
    const pendingEvaluationRef = useRef<PendingEvaluation | null>(initialPendingEvaluation);

    // Core Domain State
    const [evaluation, setEvaluation] = useState<EvaluationResponse | null>(initialEvaluation);
    const [generationArtifacts, setGenerationArtifacts] = useState<GenerationArtifacts>(initialGenerationArtifacts);
    const [generation, setGeneration] = useState<GenerationResponse | null>(
        resolvePrimaryGeneration(initialGenerationArtifacts, cachedSnapshot?.data?.generation ?? null)
    );
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
    const [isChatCollapsed, setIsChatCollapsed] = useState(false);
    const isResizingRef = useRef(false);
    const generateInFlightRef = useRef(false);
    const evaluateAbortRef = useRef<AbortController | null>(null);
    const evalRequestIdRef = useRef(0);
    const resumedPendingEvaluationIdsRef = useRef<Set<string>>(new Set());
    const isUnmountingRef = useRef(false);

    // Chat Attachments
    const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [currentDiagram, setCurrentDiagram] = useState(
        cachedSnapshot?.data.currentDiagram || "graph TD\nStart[Waiting for input...]"
    );
    const [diagramGovernance, setDiagramGovernance] = useState<DiagramGovernance>(
        normalizeDiagramGovernance(cachedSnapshot?.data.diagramGovernance)
    );

    const [activeTab, setActiveTab] = useState<StudioTab>(
        getPreferredGeneratedTab(initialGenerationArtifacts)
    );
    const [shouldMountArchitectureViewer, setShouldMountArchitectureViewer] = useState(false);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const hasScrolledMessagesRef = useRef(false);
    const lastAutoScrolledAssistantContentRef = useRef("");
    const workspaceLanguage = getProjectWorkspaceLanguage(project);
    const uiText = getWorkspaceUiText(workspaceLanguage);
    const baseMessageIndex = Math.max(0, messages.length - messageWindow);
    const visibleMessages = messages.slice(baseMessageIndex);
    const hiddenMessageCount = baseMessageIndex;
    const lastMessageIndex = messages.length - 1;
    const isAssistantStreaming =
        isLoading &&
        lastMessageIndex >= 0 &&
        messages[lastMessageIndex]?.role === "assistant";
    const lastAssistantHasVisibleContent =
        lastMessageIndex >= 0 &&
        messages[lastMessageIndex]?.role === "assistant" &&
        messages[lastMessageIndex]?.content.trim().length > 0;
    const lastAssistantHasReadyOptions =
        lastMessageIndex >= 0 &&
        messages[lastMessageIndex]?.role === "assistant" &&
        Boolean(messages[lastMessageIndex]?.options && messages[lastMessageIndex]?.options.length > 0);
    const isAssistantStreamingVisible =
        isAssistantStreaming &&
        !lastAssistantHasReadyOptions;
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
    const isConversationLocked = Boolean(
        generationArtifacts.virtual_spec ||
        generation
    );
    const lockedChatDescription = workspaceLanguage === "zh"
        ? "当前版本的脚手架已生成，聊天输入现已关闭。"
        : "This version's scaffold has been generated. Chat input is now disabled.";
    const lockedInputPlaceholder = workspaceLanguage === "zh"
        ? "当前版本已完成脚手架生成，无法继续输入。"
        : "This version is locked after scaffold generation.";
    const collapseChatLabel = workspaceLanguage === "zh" ? "隐藏聊天" : "Hide chat";
    const expandChatLabel = workspaceLanguage === "zh" ? "显示聊天" : "Show chat";
    const collapsedChatHint = workspaceLanguage === "zh" ? "聊天已隐藏" : "Chat hidden";

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

    const persistLocalVersionSnapshot = (overrides: Partial<ProjectVersion["data"]> = {}) => {
        if (!project || !currentVersion) return;

        const localProjects = readProjectsFromLocalStorage();
        const baseProject = localProjects.find((candidate) => candidate.id === project.id) ?? project;
        const baseVersion = baseProject.versions.find((candidate) => candidate.id === currentVersion.id) ?? currentVersion;
        const hasPendingEvaluationOverride = Object.prototype.hasOwnProperty.call(overrides, "pendingEvaluation");
        const nextVersion: ProjectVersion = {
            ...baseVersion,
            status: currentVersion.status,
            data: {
                ...baseVersion.data,
                messages: overrides.messages ?? messagesRef.current,
                evaluation: overrides.evaluation ?? evaluation,
                generation: overrides.generation ?? generation,
                generationArtifacts: overrides.generationArtifacts ?? generationArtifacts,
                currentDiagram: overrides.currentDiagram ?? currentDiagram,
                tasks: overrides.tasks ?? tasks,
                paymentStatus: overrides.paymentStatus ?? currentVersion.data.paymentStatus,
                diagramGovernance: overrides.diagramGovernance ?? diagramGovernance,
                designStage: overrides.designStage ?? designStage,
                uiDesignState: overrides.uiDesignState ?? uiDesignState,
                uiDesignSpec: overrides.uiDesignSpec ?? uiDesignSpec ?? undefined,
                functionalLockedAt: overrides.functionalLockedAt ?? functionalLockedAt,
                uiReadyAt: overrides.uiReadyAt ?? uiReadyAt,
                sourceArtifacts: overrides.sourceArtifacts ?? sourceArtifacts,
                architecturePack: overrides.architecturePack ?? architecturePack,
                decisionRecords: overrides.decisionRecords ?? decisionRecords,
                guardrailChecklist: overrides.guardrailChecklist ?? guardrailChecklist,
                architectureStage: overrides.architectureStage ?? architectureStage,
                readinessOverrides: overrides.readinessOverrides ?? readinessOverrides,
                pendingEvaluation: hasPendingEvaluationOverride
                    ? overrides.pendingEvaluation ?? undefined
                    : pendingEvaluationRef.current ?? undefined
            }
        };
        const versionExists = baseProject.versions.some((candidate) => candidate.id === nextVersion.id);
        const nextProject: Project = {
            ...baseProject,
            updatedAt: Date.now(),
            versions: versionExists
                ? baseProject.versions.map((candidate) => candidate.id === nextVersion.id ? nextVersion : candidate)
                : [...baseProject.versions, nextVersion]
        };
        const nextProjects = localProjects.some((candidate) => candidate.id === nextProject.id)
            ? localProjects.map((candidate) => candidate.id === nextProject.id ? nextProject : candidate)
            : [nextProject, ...localProjects];
        writeProjectsToLocalStorage(nextProjects);
    };


    // --- Effects ---

    // 0. Resolve admin mode
    useEffect(() => {
        let cancelled = false;

        const resolveAdminStatus = async () => {
            setIsAdminStatusLoaded(false);
            const nextIsAdmin = await loadAdminStatus();
            if (!cancelled) {
                setIsAdmin(nextIsAdmin);
                if (!cancelled) setIsAdminStatusLoaded(true);
            }
        };

        void resolveAdminStatus();
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        if (activeTab !== "architecture" || shouldMountArchitectureViewer) return;

        const timer = window.setTimeout(() => {
            setShouldMountArchitectureViewer(true);
        }, 120);

        return () => {
            window.clearTimeout(timer);
        };
    }, [activeTab, shouldMountArchitectureViewer]);

    useEffect(() => {
        hasUserEditedRef.current = hasUserEdited;
    }, [hasUserEdited]);

    useEffect(() => {
        messagesRef.current = messages;
    }, [messages]);

    useEffect(() => {
        pendingEvaluationRef.current = pendingEvaluation;
    }, [pendingEvaluation]);

    useEffect(() => {
        return () => {
            isUnmountingRef.current = true;
            if (evaluateAbortRef.current) {
                evaluateAbortRef.current.abort();
                evaluateAbortRef.current = null;
            }
        };
    }, []);

    // 1. Load Project & Version Data
    useEffect(() => {
        if (typeof window === "undefined" || !projectId) return;

        let cancelled = false;
        let backgroundRefreshTimer: number | null = null;

        const hydrateFromProject = (foundProject: Project) => {
            if (cancelled) return;

            setProject(foundProject);

            const selectedVersion = resolveProjectVersionForWizard(foundProject, versionId);
            if (!selectedVersion) return;

            setCurrentVersion(selectedVersion);
            setLoadedVersionId(selectedVersion.id);

            const data = selectedVersion.data;
            const normalizedDesignState = normalizeVersionDesignState(data);
            const normalizedGenerationArtifacts = normalizeGenerationArtifacts(
                data.generationArtifacts ?? null,
                data.generation ?? null
            );
            setMessages(normalizedDesignState.messages);
            setPendingEvaluation(normalizePendingEvaluation(data.pendingEvaluation));
            setMessageWindow(MESSAGE_WINDOW_SIZE);
            setEvaluation(normalizedDesignState.evaluation);
            setGenerationArtifacts(normalizedGenerationArtifacts);
            setGeneration(resolvePrimaryGeneration(normalizedGenerationArtifacts, data.generation));
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
            setActiveTab(getPreferredGeneratedTab(normalizedGenerationArtifacts));

            if (versionId && versionId !== selectedVersion.id) {
                router.replace(`/wizard?projectId=${projectId}&versionId=${selectedVersion.id}`);
            }
        };

        const refreshProjectFromRemote = async (localProjects: Project[], background = false) => {
            try {
                const remoteProjects = await prefetchWorkspaceRemote();
                const nextProjects = remoteProjects ?? readProjectsFromLocalStorage();
                const localProject = localProjects.find((candidate) => candidate.id === projectId) ?? null;
                const localVersion = localProject ? resolveProjectVersionForWizard(localProject, versionId) : null;
                const hasPendingLocalEvaluation = Boolean(normalizePendingEvaluation(localVersion?.data.pendingEvaluation));

                if (nextProjects.length > 0 || localProjects.length === 0) {
                    const remoteProject = nextProjects.find((p) => p.id === projectId);
                    const shouldHydrateRemote =
                        remoteProject &&
                        (!background || !hasUserEditedRef.current) &&
                        (
                            !localProject ||
                            (
                                !hasPendingLocalEvaluation &&
                                remoteProject.updatedAt > localProject.updatedAt
                            )
                        );

                    if (shouldHydrateRemote) {
                        hydrateFromProject(remoteProject);
                    }
                } else {
                    void syncWorkspaceRemote(localProjects);
                }
            } catch (error) {
                console.error("Failed to load remote workspace", error);
            } finally {
                if (!background && !cancelled) {
                    setIsHydrating(false);
                }
            }
        };

        const hydrate = async () => {
            setIsHydrating(true);
            setLoadedVersionId(null);
            hasUserEditedRef.current = false;
            setHasUserEdited(false);

            const localProjects = readProjectsFromLocalStorage();
            const localProject = localProjects.find((p) => p.id === projectId);
            if (localProject) {
                hydrateFromProject(localProject);
                if (!cancelled) {
                    setIsHydrating(false);
                }
                backgroundRefreshTimer = window.setTimeout(() => {
                    void refreshProjectFromRemote(localProjects, true);
                }, 120);
                return;
            }
            await yieldToBrowser();
            await refreshProjectFromRemote(localProjects);
        };

        void hydrate();

        return () => {
            cancelled = true;
            if (backgroundRefreshTimer !== null) {
                window.clearTimeout(backgroundRefreshTimer);
            }
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
                            generationArtifacts,
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
        generationArtifacts,
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

    useEffect(() => {
        if (typeof window === "undefined") return;
        const saved = localStorage.getItem("fl_chat_collapsed");
        if (saved === "1") {
            setIsChatCollapsed(true);
        }
    }, []);

    // 1c. Persist sidebar width
    useEffect(() => {
        if (typeof window === 'undefined') return;
        localStorage.setItem("fl_sidebar_width", String(sidebarWidth));
    }, [sidebarWidth]);

    useEffect(() => {
        if (typeof window === "undefined") return;
        localStorage.setItem("fl_chat_collapsed", isChatCollapsed ? "1" : "0");
    }, [isChatCollapsed]);

    useEffect(() => {
        if (!isChatCollapsed) return;
        isResizingRef.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
    }, [isChatCollapsed]);

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
                generationArtifacts,
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
                pendingEvaluation,
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
        generationArtifacts,
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
        pendingEvaluation,
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
        const lastMessage = lastMessageIndex >= 0 ? messages[lastMessageIndex] : null;
        const lastAssistantContent = lastMessage?.role === "assistant" ? lastMessage.content : "";
        const didVisibleAssistantContentChange =
            lastMessage?.role === "assistant" &&
            lastAssistantContent !== lastAutoScrolledAssistantContentRef.current;
        const shouldAutoScroll =
            !hasScrolledMessagesRef.current ||
            lastMessage?.role === "user" ||
            (isLoading && !lastAssistantHasVisibleContent) ||
            didVisibleAssistantContentChange;

        if (!shouldAutoScroll) return;

        const behavior: ScrollBehavior =
            !hasScrolledMessagesRef.current ||
            (isLoading && (!lastAssistantHasVisibleContent || didVisibleAssistantContentChange))
                ? "auto"
                : "smooth";
        messagesEndRef.current?.scrollIntoView({ behavior });
        hasScrolledMessagesRef.current = true;
        lastAutoScrolledAssistantContentRef.current = lastAssistantContent;
    }, [messages, isLoading, lastAssistantHasVisibleContent, lastMessageIndex]);

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
        setPendingEvaluation(null);
        persistLocalVersionSnapshot({
            pendingEvaluation: null
        });
        if (message) updateAssistantPlaceholder(message);
    };

    const continueEvaluation = async (input: {
        requestMessages: Message[];
        latestUserContext: string;
        interactionMode: EvaluateInteractionMode;
        resumePending?: PendingEvaluation | null;
        assistantContent?: string;
    }) => {
        const requestMessages = input.requestMessages;
        const latestUserContext = input.latestUserContext;
        const interactionMode = input.resumePending?.interactionMode ?? input.interactionMode;
        const assistantIndex = requestMessages.length;
        const activePendingEvaluation: PendingEvaluation = input.resumePending ?? {
            requestId: createPendingEvaluationId(),
            requestMessages,
            startedAt: Date.now(),
            assistantContent: input.assistantContent ?? "",
            interactionMode
        };
        const assistantPlaceholder: Message = {
            role: "assistant",
            content: input.assistantContent ?? activePendingEvaluation.assistantContent ?? ""
        };
        const requestId = evalRequestIdRef.current + 1;
        let controller: AbortController | null = null;

        evalRequestIdRef.current = requestId;
        setPendingEvaluation(activePendingEvaluation);
        setMessages([...requestMessages, assistantPlaceholder]);
        setIsLoading(true);
        persistLocalVersionSnapshot({
            messages: [...requestMessages, assistantPlaceholder],
            pendingEvaluation: activePendingEvaluation
        });

        try {
            await yieldToBrowser();
            const structureContext = buildProjectStructureContext(generation?.projectTree);
            const latestSourceArtifacts = extractSourceArtifacts(requestMessages);
            const sourceContext = buildSourceContext(latestSourceArtifacts, requestMessages);
            const designMemory = buildDesignMemory(
                currentDiagram,
                evaluation,
                diagramGovernance,
                architecturePack,
                decisionRecords,
                guardrailChecklist,
                readinessOverrides,
                requestMessages,
                EVALUATE_DESIGN_MEMORY_CHARS
            );
            controller = new AbortController();
            evaluateAbortRef.current = controller;

            const requestBody = buildEvaluateRequestBody(
                requestMessages,
                structureContext,
                sourceContext,
                Boolean(generation),
                interactionMode,
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
                        signal: controller?.signal
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
                    requestMessages,
                    structureContext,
                    sourceContext,
                    Boolean(generation),
                    interactionMode,
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
                buildResolvedConfirmationLog(requestMessages).map((item) => normalizeQuestionKey(item.questionKey))
            );
            let currentQuestionKey: string | null = null;
            let currentQuestionAction: MessageAction | null = null;
            let currentQuestionRequirementKey: ReadinessRequirementKey | null = null;
            let latestQuestionText = "";
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

                const diagramMatch = buffer.match(/<diagram>([\s\S]*?)<\/diagram>/);
                if (diagramMatch && diagramMatch[1]) {
                    const rawContent = diagramMatch[1].trim();
                    let code = rawContent;

                    const codeBlockMatch = rawContent.match(/```mermaid([\s\S]*?)```/);
                    if (codeBlockMatch && codeBlockMatch[1]) {
                        code = codeBlockMatch[1].trim();
                    } else {
                        code = code.replace(/```mermaid\n?|```\n?/g, "").replace(/```$/g, "").trim();
                    }
                    code = code.replace(/<\s*\/\s*subgraph\s*>/gi, "\nend\n").trim();

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

                const questionActionMatch = buffer.match(/<question_action>([\s\S]*?)<\/question_action>/i);
                if (questionActionMatch?.[1]) {
                    currentQuestionAction = normalizeMessageAction(questionActionMatch[1].trim()) ?? currentQuestionAction;
                }

                const questionRequirementKeyMatch = buffer.match(/<question_requirement_key>([\s\S]*?)<\/question_requirement_key>/i);
                if (questionRequirementKeyMatch?.[1]) {
                    currentQuestionRequirementKey = normalizeReadinessRequirementKey(questionRequirementKeyMatch[1].trim()) ?? currentQuestionRequirementKey;
                }

                const questionMatch = buffer.match(/<question>([\s\S]*?)(?:<\/question>|$)/i);
                if (questionMatch && questionMatch[1]) {
                    const rawQuestion = questionMatch[1];
                    const q = normalizeSingleQuestion(rawQuestion);
                    if (q) {
                        latestQuestionText = q;
                        currentQuestionKey = normalizeQuestionKey(q);
                        const inferredQuestionAction = inferQuestionAction(rawQuestion);
                        const nextQuestionAction = currentQuestionAction ?? inferredQuestionAction;
                        const shouldTrackQuestion =
                            interactionMode === "architecture" ||
                            nextQuestionAction !== null ||
                            currentQuestionRequirementKey !== null;
                        currentEval.next_step.question = q;
                        const displayContent = buildAssistantStreamingContent(rawQuestion);
                        setMessages(prev => {
                            if (evalRequestIdRef.current !== requestId) return prev;
                            const updated = [...prev];
                            const current = updated[assistantIndex];
                            if (!current || current.role !== "assistant") return prev;
                            const nextContent = displayContent || q;
                            const nextOptions = current.options;
                            const normalizedNextOptions = nextOptions && nextOptions.length > 0 ? nextOptions : undefined;
                            const nextQuestionKey = shouldTrackQuestion ? currentQuestionKey ?? undefined : undefined;
                            const nextQuestionStatus = shouldTrackQuestion ? "pending" as const : undefined;
                            const nextTrackedQuestionAction = shouldTrackQuestion ? nextQuestionAction ?? undefined : undefined;
                            const nextQuestionRequirementKey = shouldTrackQuestion
                                ? currentQuestionRequirementKey ?? undefined
                                : undefined;
                            if (
                                nextContent === current.content &&
                                areMessageOptionsEqual(current.options, normalizedNextOptions) &&
                                nextQuestionKey === current.questionKey &&
                                nextQuestionStatus === current.questionStatus &&
                                nextTrackedQuestionAction === current.questionAction &&
                                nextQuestionRequirementKey === current.questionRequirementKey
                            ) {
                                return prev;
                            }
                            updated[assistantIndex] = {
                                ...current,
                                content: nextContent,
                                options: normalizedNextOptions,
                                questionKey: nextQuestionKey,
                                questionStatus: nextQuestionStatus,
                                questionAction: nextTrackedQuestionAction,
                                questionRequirementKey: nextQuestionRequirementKey
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

                const streamingOptionsBlock = extractStreamingOptionsBlock(buffer);
                if (streamingOptionsBlock !== null) {
                    const parsedOptions = parseOptionsBlock(streamingOptionsBlock);
                    const options = interactionMode === "architecture"
                        ? ensureCommonQuestionOptions(
                            currentEval.next_step.question || latestQuestionText,
                            parsedOptions,
                            latestUserContext,
                            currentQuestionAction,
                            currentQuestionKey,
                            currentQuestionRequirementKey,
                            workspaceLanguage
                        )
                        : parsedOptions.map((option) => ({
                            ...option,
                            action: resolveOptionAction(option, currentQuestionAction) ?? undefined,
                            questionKey: currentQuestionKey ?? option.questionKey ?? undefined,
                            requirementKey: currentQuestionRequirementKey ?? option.requirementKey ?? undefined
                        }));
                    const normalizedOptions = options.length > 0 ? options : undefined;
                    setMessages(prev => {
                        if (evalRequestIdRef.current !== requestId) return prev;
                        const updated = [...prev];
                        const current = updated[assistantIndex];
                        if (!current || current.role !== "assistant") return prev;
                        const shouldTrackQuestion =
                            interactionMode === "architecture" ||
                            currentQuestionAction !== null ||
                            currentQuestionRequirementKey !== null ||
                            options.length > 0;
                        const nextQuestionKey = shouldTrackQuestion
                            ? currentQuestionKey ?? current.questionKey ?? undefined
                            : undefined;
                        const nextQuestionStatus = shouldTrackQuestion
                            ? current.questionKey || currentQuestionKey
                                ? "pending"
                                : current.questionStatus
                            : undefined;
                        const nextQuestionAction = shouldTrackQuestion
                            ? currentQuestionAction ?? current.questionAction
                            : undefined;
                        const nextQuestionRequirementKey = shouldTrackQuestion
                            ? currentQuestionRequirementKey ?? current.questionRequirementKey
                            : undefined;
                        if (
                            areMessageOptionsEqual(current.options, normalizedOptions) &&
                            nextQuestionKey === current.questionKey &&
                            nextQuestionStatus === current.questionStatus &&
                            nextQuestionAction === current.questionAction &&
                            nextQuestionRequirementKey === current.questionRequirementKey
                        ) {
                            return prev;
                        }
                        updated[assistantIndex] = {
                            ...current,
                            options: normalizedOptions,
                            questionKey: nextQuestionKey,
                            questionStatus: nextQuestionStatus,
                            questionAction: nextQuestionAction,
                            questionRequirementKey: nextQuestionRequirementKey
                        };
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
                const resolvedPack = currentEval.architecturePackDraft ?? architecturePack;
                const resolvedDecisions = currentEval.decisionDrafts ?? decisionRecords;
                const resolvedGuardrails = currentEval.guardrailDrafts ?? guardrailChecklist;
                const resolvedStage = inferArchitectureStage(
                    resolvedPack,
                    resolvedDecisions,
                    resolvedGuardrails,
                    readinessOverrides
                );
                const resolvedEligibility = computeScaffoldEligibility({
                    architecturePack: resolvedPack,
                    decisionRecords: resolvedDecisions,
                    guardrailChecklist: resolvedGuardrails,
                    readinessOverrides
                });
                const coercedPlatformQuestion = interactionMode === "architecture" && shouldPrioritizePlatformQuestion(resolvedPack)
                    ? buildPlatformDiscoveryQuestion(workspaceLanguage)
                    : null;
                const coercedGenerateQuestion = interactionMode === "architecture" && currentQuestionAction === "generate_scaffold" && !resolvedEligibility.canGenerate
                    ? buildBlockedGenerateQuestion(
                        workspaceLanguage,
                        resolvedStage,
                        resolvedEligibility.readiness,
                        resolvedPack,
                        requestMessages
                    )
                    : null;
                const completedQuestionText = extractCompletedAssistantText(buffer);
                const fallbackText = extractFallbackAssistantText(buffer) || "Model response format was invalid. Please retry.";
                const hasCompletedVisibleQuestion = Boolean(completedQuestionText && completedQuestionText.trim().length > 0);
                setMessages(prev => {
                    if (evalRequestIdRef.current !== requestId) return prev;
                    const updated = [...prev];
                    const current = updated[assistantIndex];
                    if (!current || current.role !== "assistant") return prev;
                    const fallbackOptions = interactionMode === "architecture"
                        ? ensureCommonQuestionOptions(
                            currentEval.next_step.question || fallbackText,
                            current.options ?? [],
                            latestUserContext,
                            currentQuestionAction,
                            currentQuestionKey,
                            currentQuestionRequirementKey,
                            workspaceLanguage
                        )
                        : current.options ?? [];
                    const coercedQuestion = coercedGenerateQuestion ??
                        (!hasCompletedVisibleQuestion ? coercedPlatformQuestion : null);
                    const shouldRetainTrackedQuestion =
                        interactionMode === "architecture" ||
                        Boolean(
                            (current.options?.length ?? 0) > 0 ||
                            current.questionAction ||
                            current.questionRequirementKey
                        );
                    const nextContent = coercedQuestion
                        ? coercedQuestion.content
                        : completedQuestionText
                            ? completedQuestionText
                            : current.content.trim().length > 0
                            ? current.content
                            : fallbackText;
                    const nextOptions = coercedQuestion
                        ? coercedQuestion.options
                        : current.options && current.options.length > 0
                            ? current.options
                            : fallbackOptions;
                    const normalizedNextOptions = nextOptions && nextOptions.length > 0 ? nextOptions : undefined;
                    const nextQuestionKey = coercedQuestion
                        ? coercedQuestion.questionKey
                        : shouldRetainTrackedQuestion
                            ? current.questionKey
                            : undefined;
                    const nextQuestionAction = coercedQuestion
                        ? coercedQuestion.questionAction
                        : shouldRetainTrackedQuestion
                            ? current.questionAction
                            : undefined;
                    const nextQuestionRequirementKey = coercedQuestion
                        ? coercedQuestion.questionRequirementKey
                        : shouldRetainTrackedQuestion
                            ? current.questionRequirementKey
                            : undefined;
                    const nextQuestionStatus = coercedQuestion
                        ? "pending" as const
                        : shouldRetainTrackedQuestion
                            ? current.questionStatus
                            : undefined;
                    if (
                        nextContent === current.content &&
                        normalizedNextOptions === current.options &&
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
                        options: normalizedNextOptions,
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
                if (!isUnmountingRef.current) {
                    setPendingEvaluation(null);
                    persistLocalVersionSnapshot({
                        messages: messagesRef.current,
                        pendingEvaluation: null
                    });
                }
            }
            if (evaluateAbortRef.current === controller) {
                evaluateAbortRef.current = null;
            }
        }
    };

    const buildAssistantQuestionMessage = (input: {
        content: string;
        options?: MessageOption[];
        questionKey?: string | null;
        questionAction?: MessageAction | null;
        questionRequirementKey?: ReadinessRequirementKey | null;
    }): Message => ({
        role: "assistant",
        kind: "chat",
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
    ): {
        architecturePack: ArchitecturePack;
        decisionRecords?: DecisionRecord[];
        guardrailChecklist: GuardrailChecklist;
        readinessOverrides: ReadinessOverride[];
        summary: string;
        applied: boolean;
    } => {
        const latestUserAnswer = [...baseMessages]
            .reverse()
            .find((message) => message.role === "user" && message.content.trim().length > 0)
            ?.content
            .trim() ?? "";
        const latestAnswerLower = latestUserAnswer.toLowerCase();
        const isSteeringReply = (text: string) => {
            const normalized = text.trim();
            if (!normalized) return true;
            if (AFFIRMATIVE_RESPONSE_PATTERN.test(normalized)) return true;
            if (DEFER_RESPONSE_PATTERN.test(normalized)) return true;
            return /阻塞项|blockers|补齐这个缺口|fill this gap|按推荐继续补齐这个缺口|按默认方案继续完善|show me 2 or 3|请给我 2 到 3 个常见方案|我来补充这个缺口|i will fill/i.test(normalized);
        };
        const meaningfulUserInputs = baseMessages
            .filter((message) => message.role === "user")
            .map((message) => message.content.trim())
            .filter((text) => text.length > 0 && !isSteeringReply(text));
        const mergeStringValues = (existing: string[], defaults: string[]) =>
            [...new Set([...existing.map((item) => item.trim()).filter(Boolean), ...defaults.map((item) => item.trim()).filter(Boolean)])];
        const mergeObjectsByKey = <T,>(existing: T[], defaults: T[], getKey: (item: T) => string) => {
            const seen = new Set(existing.map((item) => getKey(item).trim().toLowerCase()).filter(Boolean));
            const merged = [...existing];
            for (const item of defaults) {
                const key = getKey(item).trim().toLowerCase();
                if (!key || seen.has(key)) continue;
                seen.add(key);
                merged.push(item);
            }
            return merged;
        };
        const productGoalCandidate = meaningfulUserInputs.find((text) =>
            !/^先做\s*(web 应用|移动 app|桌面应用|后端服务\s*\/\s*api)/i.test(text) &&
            !/^start with (a )?(web app|mobile app|desktop app|backend service)/i.test(text)
        ) ?? "";
        const inferredProductGoal = architecturePack.businessContext.productGoal.trim() ||
            productGoalCandidate ||
            (language === "zh"
                ? "做一个帮助团队捕获、整理并排序大众需求的 Web 应用。"
                : "Build a web app that helps teams capture, organize, and prioritize broad user demand.");
        const ideaSignal = `${inferredProductGoal} ${meaningfulUserInputs.join(" ")}`.toLowerCase();
        const defaultTargetUsers = language === "zh"
            ? (/大众|consumer|public|mass/.test(ideaSignal)
                ? ["产品经理与创业者", "市场研究团队"]
                : ["产品团队", "创业团队"])
            : (/大众|consumer|public|mass/.test(ideaSignal)
                ? ["Product managers and founders", "Market research teams"]
                : ["Product teams", "Startup teams"]);
        const defaultUserJourneys = language === "zh"
            ? [
                "输入一个想验证的产品主题，并定义想观察的大众需求方向。",
                "收集并整理用户反馈、评论或需求线索，归纳高频痛点与机会点。",
                "查看需求摘要、优先级排序结果，并沉淀为后续产品决策输入。"
            ]
            : [
                "Enter a product topic to validate and define the demand direction to observe.",
                "Collect and organize user feedback or demand signals into recurring pain points and opportunities.",
                "Review the demand summary and priority ranking, then turn it into downstream product decisions."
            ];
        const defaultConstraints = language === "zh"
            ? [
                "首发版本需要同时覆盖桌面和移动浏览器。",
                "需求信号的采集与展示需要满足隐私与来源合规要求。"
            ]
            : [
                "The first release must support both desktop and mobile browsers.",
                "Demand signal collection and presentation must respect privacy and source-compliance requirements."
            ];
        const defaultRisks = language === "zh"
            ? [
                "冷启动阶段可能缺少足够高质量的需求样本，影响结果可信度。",
                "AI 对模糊反馈的聚类与总结可能偏离真实市场需求。"
            ]
            : [
                "The cold-start stage may lack enough high-quality demand samples, which can reduce confidence in the results.",
                "AI clustering and summarization may drift away from the real market need when feedback is vague."
            ];
        const defaultBoundedContexts = language === "zh"
            ? [
                {
                    name: "需求采集",
                    responsibility: "接收主题、目标用户和原始需求信号。",
                    owns: ["主题输入", "原始需求线索"],
                    dependencies: ["需求分析"]
                },
                {
                    name: "需求分析",
                    responsibility: "清洗、聚类、总结并排序需求机会。",
                    owns: ["需求摘要", "优先级结果"],
                    dependencies: ["需求采集"]
                }
            ]
            : [
                {
                    name: "Demand capture",
                    responsibility: "Accept the topic, target audience, and raw demand signals.",
                    owns: ["Topic input", "Raw demand signals"],
                    dependencies: ["Demand analysis"]
                },
                {
                    name: "Demand analysis",
                    responsibility: "Clean, cluster, summarize, and rank demand opportunities.",
                    owns: ["Demand summary", "Priority results"],
                    dependencies: ["Demand capture"]
                }
            ];
        const defaultModuleResponsibilities = language === "zh"
            ? [
                {
                    module: "主题输入与采集模块",
                    responsibility: "创建需求捕获任务并记录原始输入。",
                    inputs: ["主题", "目标用户", "用户反馈"],
                    outputs: ["原始需求信号"]
                },
                {
                    module: "需求分析与摘要模块",
                    responsibility: "对原始需求信号做聚类、总结和优先级排序。",
                    inputs: ["原始需求信号"],
                    outputs: ["需求摘要", "优先级列表"]
                }
            ]
            : [
                {
                    module: "Topic input and capture module",
                    responsibility: "Create demand-capture tasks and store the raw inputs.",
                    inputs: ["Topic", "Target user", "User feedback"],
                    outputs: ["Raw demand signals"]
                },
                {
                    module: "Demand analysis and summary module",
                    responsibility: "Cluster, summarize, and prioritize the raw demand signals.",
                    inputs: ["Raw demand signals"],
                    outputs: ["Demand summary", "Priority list"]
                }
            ];
        const defaultIntegrationContracts = language === "zh"
            ? [
                {
                    name: "需求分析提交 API",
                    kind: "api" as const,
                    producer: "需求采集",
                    consumer: "需求分析",
                    payload: "主题、目标用户与原始需求信号",
                    notes: "提交后触发清洗、聚类和摘要生成。"
                }
            ]
            : [
                {
                    name: "Demand analysis submission API",
                    kind: "api" as const,
                    producer: "Demand capture",
                    consumer: "Demand analysis",
                    payload: "Topic, target audience, and raw demand signals",
                    notes: "Submitting this payload triggers cleaning, clustering, and summary generation."
                }
            ];
        const defaultImplementationOrder = language === "zh"
            ? [
                "先实现主题输入与需求采集流程。",
                "再实现需求分析、聚类与摘要输出。",
                "最后补齐结果展示、导出与质量校验。"
            ]
            : [
                "Implement the topic-input and demand-capture flow first.",
                "Then build the demand analysis, clustering, and summary output flow.",
                "Finish with result presentation, export, and quality checks."
            ];
        const defaultAcceptanceCriteria = language === "zh"
            ? [
                "用户可以提交一个待验证的主题并完成一次需求捕获。",
                "系统会输出可读的需求摘要与优先级排序结果。",
                "桌面和移动浏览器都能完成主要流程。",
                "核心结果可以被再次查看或导出。"
            ]
            : [
                "A user can submit a topic and complete one full demand-capture run.",
                "The system returns a readable demand summary with a ranked priority list.",
                "The core flow works on both desktop and mobile browsers.",
                "The core result can be reviewed again or exported."
            ];
        const defaultTestStrategy = language === "zh"
            ? [
                "为需求输入到摘要输出的主流程编写端到端测试。",
                "为需求聚类与优先级排序逻辑编写单元测试。"
            ]
            : [
                "Add an end-to-end test for the topic-input to summary-output happy path.",
                "Add unit tests for clustering and priority-ranking logic."
            ];
        const defaultUiComponents = language === "zh"
            ? ["主题输入表单", "需求信号列表", "摘要与优先级卡片"]
            : ["Topic input form", "Demand signal list", "Summary and priority cards"];
        const defaultResponsiveStrategy = language === "zh"
            ? ["桌面端采用输入区与结果区双栏布局，移动端切换为单栏堆叠。"]
            : ["Use a two-column input/result layout on desktop and a single-column stacked layout on mobile."];
        const inferPlatformStrategy = () => {
            const candidates = [latestUserAnswer, ...meaningfulUserInputs.slice().reverse()].filter(Boolean);
            for (const candidate of candidates) {
                const normalized = candidate.toLowerCase();
                if (/web\s*app|web 应用|桌面和移动浏览器|desktop and mobile browsers|浏览器|browser/.test(normalized)) {
                    return {
                        primaryPlatform: language === "zh" ? "Web 应用" : "Web app",
                        targetPlatforms: language === "zh" ? ["桌面浏览器", "移动浏览器"] : ["Desktop browser", "Mobile browser"],
                        runtimeEnvironments: language === "zh" ? ["Web 浏览器"] : ["Web browser"],
                        distributionChannels: language === "zh" ? ["浏览器访问", "托管 Web 应用"] : ["Browser access", "Hosted web app"]
                    };
                }
                if (/mobile\s*app|移动 app|移动端|ios|android|app store|google play/.test(normalized)) {
                    return {
                        primaryPlatform: language === "zh" ? "移动 App" : "Mobile app",
                        targetPlatforms: language === "zh" ? ["iOS", "Android"] : ["iOS", "Android"],
                        runtimeEnvironments: language === "zh" ? ["iOS App", "Android App"] : ["iOS app", "Android app"],
                        distributionChannels: language === "zh" ? ["App Store", "Google Play"] : ["App Store", "Google Play"]
                    };
                }
                if (/desktop\s*app|桌面应用|windows|macos/.test(normalized)) {
                    return {
                        primaryPlatform: language === "zh" ? "桌面应用" : "Desktop app",
                        targetPlatforms: language === "zh" ? ["Windows", "macOS"] : ["Windows", "macOS"],
                        runtimeEnvironments: language === "zh" ? ["Windows 桌面应用", "macOS 桌面应用"] : ["Windows desktop app", "macOS desktop app"],
                        distributionChannels: language === "zh" ? ["桌面安装包"] : ["Desktop installer"]
                    };
                }
                if (/backend\s*service|后端服务|service api|api rather than a ui-first product/.test(normalized)) {
                    return {
                        primaryPlatform: language === "zh" ? "后端服务 / API" : "Backend service / API",
                        targetPlatforms: language === "zh" ? ["服务端 API"] : ["Service API"],
                        runtimeEnvironments: language === "zh" ? ["Node.js 服务运行时"] : ["Node.js service runtime"],
                        distributionChannels: language === "zh" ? ["API 调用", "后台任务"] : ["API clients", "Background jobs"]
                    };
                }
            }

            return {
                primaryPlatform: language === "zh" ? "Web 应用" : "Web app",
                targetPlatforms: language === "zh" ? ["桌面浏览器", "移动浏览器"] : ["Desktop browser", "Mobile browser"],
                runtimeEnvironments: language === "zh" ? ["Web 浏览器"] : ["Web browser"],
                distributionChannels: language === "zh" ? ["浏览器访问", "托管 Web 应用"] : ["Browser access", "Hosted web app"]
            };
        };

        if (requirementKey === "business_context.platforms") {
            const nextPlatformStrategy = inferPlatformStrategy();

            return {
                architecturePack: {
                    ...architecturePack,
                    platformStrategy: nextPlatformStrategy
                },
                guardrailChecklist,
                readinessOverrides,
                summary: language === "zh"
                    ? `已按推荐确认平台策略：${nextPlatformStrategy.primaryPlatform}。`
                    : `Confirmed the recommended platform strategy: ${nextPlatformStrategy.primaryPlatform}.`,
                applied: true
            };
        }

        if (requirementKey === "business_context.product_goal" && inferredProductGoal.trim()) {
            return {
                architecturePack: {
                    ...architecturePack,
                    businessContext: {
                        ...architecturePack.businessContext,
                        productGoal: inferredProductGoal.trim()
                    }
                },
                guardrailChecklist,
                readinessOverrides,
                summary: language === "zh"
                    ? `已按推荐补齐产品目标：${inferredProductGoal.trim()}`
                    : `Filled the product goal using the recommended default: ${inferredProductGoal.trim()}`,
                applied: true
            };
        }

        if (requirementKey === "business_context.target_users") {
            const nextTargetUsers = mergeStringValues(architecturePack.businessContext.targetUsers, defaultTargetUsers);
            if (nextTargetUsers.length > architecturePack.businessContext.targetUsers.length) {
                return {
                    architecturePack: {
                        ...architecturePack,
                        businessContext: {
                            ...architecturePack.businessContext,
                            targetUsers: nextTargetUsers
                        }
                    },
                    guardrailChecklist,
                    readinessOverrides,
                    summary: language === "zh"
                        ? "已按推荐补齐目标用户。"
                        : "Filled the target users using the recommended defaults.",
                    applied: true
                };
            }
        }

        if (requirementKey === "business_context.user_journeys") {
            const nextJourneys = mergeStringValues(architecturePack.businessContext.userJourneys, defaultUserJourneys);
            if (nextJourneys.length > architecturePack.businessContext.userJourneys.length) {
                return {
                    architecturePack: {
                        ...architecturePack,
                        businessContext: {
                            ...architecturePack.businessContext,
                            userJourneys: nextJourneys
                        }
                    },
                    guardrailChecklist,
                    readinessOverrides,
                    summary: language === "zh"
                        ? "已按推荐补齐关键用户旅程。"
                        : "Filled the key user journeys using the recommended defaults.",
                    applied: true
                };
            }
        }

        if (requirementKey === "business_context.constraints_or_risks") {
            const nextConstraints = mergeStringValues(architecturePack.businessContext.constraints, defaultConstraints);
            const nextRisks = mergeStringValues(architecturePack.businessContext.risks, defaultRisks);
            if (
                nextConstraints.length > architecturePack.businessContext.constraints.length ||
                nextRisks.length > architecturePack.businessContext.risks.length
            ) {
                return {
                    architecturePack: {
                        ...architecturePack,
                        businessContext: {
                            ...architecturePack.businessContext,
                            constraints: nextConstraints,
                            risks: nextRisks
                        }
                    },
                    guardrailChecklist,
                    readinessOverrides,
                    summary: language === "zh"
                        ? "已按推荐补齐约束与风险。"
                        : "Filled the constraints and risks using the recommended defaults.",
                    applied: true
                };
            }
        }

        if (requirementKey === "boundaries.bounded_contexts") {
            const nextBoundedContexts = mergeObjectsByKey(
                architecturePack.boundedContexts,
                defaultBoundedContexts,
                (item) => item.name
            );
            if (nextBoundedContexts.length > architecturePack.boundedContexts.length) {
                return {
                    architecturePack: {
                        ...architecturePack,
                        boundedContexts: nextBoundedContexts
                    },
                    guardrailChecklist,
                    readinessOverrides,
                    summary: language === "zh"
                        ? "已按推荐补齐限界上下文。"
                        : "Filled the bounded contexts using the recommended defaults.",
                    applied: true
                };
            }
        }

        if (requirementKey === "boundaries.module_responsibilities") {
            const nextModuleResponsibilities = mergeObjectsByKey(
                architecturePack.moduleResponsibilities,
                defaultModuleResponsibilities,
                (item) => item.module
            );
            if (nextModuleResponsibilities.length > architecturePack.moduleResponsibilities.length) {
                return {
                    architecturePack: {
                        ...architecturePack,
                        moduleResponsibilities: nextModuleResponsibilities
                    },
                    guardrailChecklist,
                    readinessOverrides,
                    summary: language === "zh"
                        ? "已按推荐补齐模块职责。"
                        : "Filled the module responsibilities using the recommended defaults.",
                    applied: true
                };
            }
        }

        if (requirementKey === "boundaries.data_ownership") {
            const defaultDataOwnership = language === "zh"
                ? {
                    data: "用户提交的想法与分析结果",
                    owner: "用户",
                    consumers: ["架构分析服务", "项目工作区"],
                    notes: "平台仅为提供服务而处理数据，默认保留 30 天，支持后续按策略调整。"
                }
                : {
                    data: "User-submitted ideas and analysis results",
                    owner: "User",
                    consumers: ["Architecture analysis service", "Project workspace"],
                    notes: "The product processes this data only to deliver the service, with a default 30-day retention window that can be revised later."
                };
            const hasEquivalentRule = architecturePack.dataOwnership.some((item) =>
                item.data.trim().toLowerCase() === defaultDataOwnership.data.toLowerCase()
            );

            if (!hasEquivalentRule) {
                return {
                    architecturePack: {
                        ...architecturePack,
                        dataOwnership: [...architecturePack.dataOwnership, defaultDataOwnership]
                    },
                    guardrailChecklist,
                    readinessOverrides,
                    summary: language === "zh"
                        ? "已按推荐补齐默认数据归属规则。"
                        : "Added the recommended default data ownership rule.",
                    applied: true
                };
            }
        }

        if (requirementKey === "decisions.integration_contracts") {
            const nextIntegrationContracts = mergeObjectsByKey(
                architecturePack.integrationContracts,
                defaultIntegrationContracts,
                (item) => item.name
            );
            if (nextIntegrationContracts.length > architecturePack.integrationContracts.length) {
                return {
                    architecturePack: {
                        ...architecturePack,
                        integrationContracts: nextIntegrationContracts
                    },
                    guardrailChecklist,
                    readinessOverrides,
                    summary: language === "zh"
                        ? "已按推荐补齐集成契约。"
                        : "Filled the integration contracts using the recommended defaults.",
                    applied: true
                };
            }
        }

        if (requirementKey === "decisions.decision_records") {
            const stackQuestion = buildStackRecommendationQuestion(language, architecturePack);
            const candidateOptions = stackQuestion?.options?.filter((option) => !DEFER_RESPONSE_PATTERN.test(option.value || option.label)) ?? [];
            const selectedOption = candidateOptions.find((option) => {
                const label = option.label.toLowerCase();
                const value = option.value.toLowerCase();
                return latestAnswerLower.includes(label) || latestAnswerLower.includes(value);
            }) ?? candidateOptions[0];
            const normalizedExistingDecisions = decisionRecords.map((record) =>
                `${record.title} ${record.decision} ${record.rationale}`.toLowerCase()
            );
            const nextDecisionRecords = [...decisionRecords];
            const summaryParts: string[] = [];

            if (selectedOption) {
                const alreadyRecorded = normalizedExistingDecisions.some((record) =>
                    record.includes(selectedOption.value.trim().toLowerCase()) ||
                    record.includes(selectedOption.label.trim().toLowerCase())
                );

                if (!alreadyRecorded) {
                    const alternativesRejected = candidateOptions
                        .filter((option) => option.label !== selectedOption.label)
                        .slice(0, 3)
                        .map((option) => option.label);

                    nextDecisionRecords.push({
                        title: language === "zh" ? "采用首发技术栈基线" : "Adopt the initial stack baseline",
                        decision: selectedOption.value,
                        rationale: language === "zh"
                            ? "基于当前已确认的平台策略与产品范围，先锁定这条默认技术栈基线，以减少后续实现分歧并继续完善架构包。"
                            : "Based on the confirmed platform strategy and current product scope, lock this default stack baseline now to reduce downstream implementation drift.",
                        alternativesRejected,
                        consequences: language === "zh"
                            ? [
                                "后续模块职责、集成契约和交付 guardrails 将以这条技术栈为基线展开。",
                                "如果范围变化明显，再重新评估替代技术栈。"
                            ]
                            : [
                                "The next module boundaries, integration contracts, and delivery guardrails will assume this stack baseline.",
                                "If the scope changes materially, revisit the stack choice later."
                            ]
                    });
                    summaryParts.push(language === "zh"
                        ? `技术栈基线已记录为 ${selectedOption.label}`
                        : `Recorded the stack baseline: ${selectedOption.label}`);
                }
            }

            const hasBoundaryDecision = [...normalizedExistingDecisions, ...nextDecisionRecords.slice(decisionRecords.length).map((record) =>
                `${record.title} ${record.decision} ${record.rationale}`.toLowerCase()
            )].some((record) =>
                /工作区|编辑|编排|workspace|editor|orchestration|model call|模型调用/.test(record)
            );

            if (!hasBoundaryDecision) {
                nextDecisionRecords.push({
                    title: language === "zh" ? "分离工作区与生成编排" : "Separate workspace and generation orchestration",
                    decision: language === "zh"
                        ? "将工作区 / 编辑交互层与生成编排 / 模型调用层解耦，前者负责输入、编辑与结果管理，后者负责提示组装、模型调用和输出归档。"
                        : "Decouple the workspace or editing interaction layer from the generation-orchestration and model-calling layer. The first owns input, editing, and result management, while the second owns prompt assembly, model execution, and output persistence.",
                    rationale: language === "zh"
                        ? "这样可以在不影响编辑体验的前提下独立演进生成链路，并让失败重试、模型替换和质量治理落在更清晰的边界上。"
                        : "This keeps the editing experience stable while the generation pipeline evolves independently, and it gives retries, provider swaps, and quality controls a clearer boundary.",
                    alternativesRejected: language === "zh"
                        ? ["将编辑交互与生成调用揉进同一模块"]
                        : ["Keep editing interaction and generation calls inside the same module"],
                    consequences: language === "zh"
                        ? [
                            "前端工作区可以更稳定地管理草稿、状态与用户操作。",
                            "生成链路后续可以独立增加队列、缓存或多模型策略。"
                        ]
                        : [
                            "The workspace can manage drafts, state, and user actions with less coupling.",
                            "The generation pipeline can later add queues, caching, or multi-model policies independently."
                        ]
                });
                summaryParts.push(language === "zh"
                    ? "已补上工作区与生成编排的边界决策"
                    : "Added the boundary decision between workspace and generation orchestration");
            }

            const normalizedDecisionRecords = normalizeDecisionRecords(nextDecisionRecords);
            if (normalizedDecisionRecords.length > decisionRecords.length) {
                return {
                    architecturePack,
                    guardrailChecklist,
                    readinessOverrides,
                    decisionRecords: normalizedDecisionRecords,
                    summary: language === "zh"
                        ? `已按推荐补齐架构决策：${summaryParts.join("；")}。`
                        : `Filled the architecture decisions using the recommended defaults: ${summaryParts.join("; ")}.`,
                    applied: true
                };
            }
        }

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
                    requirement: language === "zh" ? "结果可信度" : "Result confidence",
                    rationale: language === "zh"
                        ? "确保需求摘要、聚类与优先级结果在相同输入下保持稳定且可解释。"
                        : "Ensure summaries, clustering, and prioritization stay stable and explainable for the same input."
                },
                {
                    category: language === "zh" ? "体验" : "usability",
                    requirement: language === "zh" ? "响应速度" : "Responsiveness",
                    rationale: language === "zh"
                        ? "让用户在提交主题后尽快看到可读的需求摘要与优先级结果。"
                        : "Let users see a readable summary and priority result quickly after submitting a topic."
                }
            ];
            const nextRequirements = candidates.filter((candidate) =>
                !existing.has(`${candidate.category} ${candidate.requirement} ${candidate.rationale}`.toLowerCase()) &&
                !existingText.some((item) => item.includes(candidate.requirement.toLowerCase()))
            ).slice(0, Math.max(1, 2 - architecturePack.nonFunctionalRequirements.length));
            if (nextRequirements.length > 0) {
                return {
                    architecturePack: {
                        ...architecturePack,
                        nonFunctionalRequirements: [...architecturePack.nonFunctionalRequirements, ...nextRequirements]
                    },
                    guardrailChecklist,
                    readinessOverrides,
                    summary: language === "zh"
                        ? `已按推荐补充非功能性需求：${nextRequirements.map((item) => item.requirement).join("、")}。`
                        : `Added the recommended non-functional requirements: ${nextRequirements.map((item) => item.requirement).join(", ")}.`,
                    applied: true
                };
            }
        }

        if (requirementKey === "guardrails.implementation_order") {
            const nextImplementationOrder = mergeStringValues(guardrailChecklist.implementationOrder, defaultImplementationOrder);
            if (nextImplementationOrder.length > guardrailChecklist.implementationOrder.length) {
                return {
                    architecturePack,
                    guardrailChecklist: {
                        ...guardrailChecklist,
                        implementationOrder: nextImplementationOrder
                    },
                    readinessOverrides,
                    summary: language === "zh"
                        ? "已按推荐补齐实现顺序。"
                        : "Filled the implementation order using the recommended defaults.",
                    applied: true
                };
            }
        }

        if (requirementKey === "guardrails.acceptance_criteria") {
            const nextAcceptanceCriteria = mergeStringValues(guardrailChecklist.acceptanceCriteria, defaultAcceptanceCriteria);
            if (nextAcceptanceCriteria.length > guardrailChecklist.acceptanceCriteria.length) {
                return {
                    architecturePack,
                    guardrailChecklist: {
                        ...guardrailChecklist,
                        acceptanceCriteria: nextAcceptanceCriteria
                    },
                    readinessOverrides,
                    summary: language === "zh"
                        ? "已按推荐补齐验收标准。"
                        : "Filled the acceptance criteria using the recommended defaults.",
                    applied: true
                };
            }
        }

        if (requirementKey === "guardrails.test_strategy") {
            const nextTestStrategy = mergeStringValues(guardrailChecklist.testStrategy, defaultTestStrategy);
            if (nextTestStrategy.length > guardrailChecklist.testStrategy.length) {
                return {
                    architecturePack,
                    guardrailChecklist: {
                        ...guardrailChecklist,
                        testStrategy: nextTestStrategy
                    },
                    readinessOverrides,
                    summary: language === "zh"
                        ? "已按推荐补齐测试策略。"
                        : "Filled the test strategy using the recommended defaults.",
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

        if (requirementKey === "ui.shared_components") {
            const nextUiComponents = mergeStringValues(architecturePack.experienceConstraints.uiComponents, defaultUiComponents);
            if (nextUiComponents.length > architecturePack.experienceConstraints.uiComponents.length) {
                return {
                    architecturePack: {
                        ...architecturePack,
                        experienceConstraints: {
                            ...architecturePack.experienceConstraints,
                            uiComponents: nextUiComponents
                        }
                    },
                    guardrailChecklist,
                    readinessOverrides,
                    summary: language === "zh"
                        ? "已按推荐补齐共享 UI 组件。"
                        : "Filled the shared UI components using the recommended defaults.",
                    applied: true
                };
            }
        }

        if (requirementKey === "ui.responsive_strategy") {
            const nextResponsiveStrategy = mergeStringValues(
                architecturePack.experienceConstraints.responsiveStrategy,
                defaultResponsiveStrategy
            );
            if (nextResponsiveStrategy.length > architecturePack.experienceConstraints.responsiveStrategy.length) {
                return {
                    architecturePack: {
                        ...architecturePack,
                        experienceConstraints: {
                            ...architecturePack.experienceConstraints,
                            responsiveStrategy: nextResponsiveStrategy
                        }
                    },
                    guardrailChecklist,
                    readinessOverrides,
                    summary: language === "zh"
                        ? "已按推荐补齐响应式策略。"
                        : "Filled the responsive strategy using the recommended defaults.",
                    applied: true
                };
            }
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
            const focused = buildFocusedRequirementQuestion(
                language,
                requirementKey,
                architecturePack,
                baseMessages
            );
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
            const focused = buildFocusedRequirementQuestion(
                language,
                requirementKey,
                architecturePack,
                baseMessages
            );
            appendDeterministicAssistantResponse(baseMessages, buildAssistantQuestionMessage(focused));
            return true;
        }

        setHasUserEdited(true);
        setArchitecturePack(resolution.architecturePack);
        if (resolution.decisionRecords) {
            setDecisionRecords(resolution.decisionRecords);
        }
        setGuardrailChecklist(resolution.guardrailChecklist);
        setReadinessOverrides(resolution.readinessOverrides);
        const resolvedDecisions = resolution.decisionRecords ?? decisionRecords;

        const nextEligibility = computeScaffoldEligibility({
            architecturePack: resolution.architecturePack,
            decisionRecords: resolvedDecisions,
            guardrailChecklist: resolution.guardrailChecklist,
            readinessOverrides: resolution.readinessOverrides
        });
        const nextStage = inferArchitectureStage(
            resolution.architecturePack,
            resolvedDecisions,
            resolution.guardrailChecklist,
            resolution.readinessOverrides
        );
        setArchitectureReadiness(nextEligibility.readiness);
        setArchitectureStage(nextStage);
        setEvaluation((prev) => prev
            ? {
                ...prev,
                architecturePackDraft: resolution.architecturePack,
                decisionDrafts: resolvedDecisions,
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
            : buildNextArchitectureFollowUpQuestion(
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
        const selectedRequirementAction =
            !selectedOptionAction &&
            selectedOption &&
            contextualRequirementKey &&
            AFFIRMATIVE_RESPONSE_PATTERN.test(selectedOption.value) &&
            !DEFER_RESPONSE_PATTERN.test(`${selectedOption.label} ${selectedOption.value}`)
                ? "fill_requirement" as const
                : null;
        const contextualTriggeredAction =
            !selectedOptionAction && contextualAction && isAffirmativeForAction(textToSend, contextualAction)
                ? contextualAction
                : null;
        const typedRequirementAction =
            !selectedOption &&
            !selectedOptionAction &&
            contextualRequirementKey &&
            AFFIRMATIVE_RESPONSE_PATTERN.test(textToSend) &&
            !DEFER_RESPONSE_PATTERN.test(textToSend)
                ? "fill_requirement" as const
                : null;
        const triggeredAction =
            selectedOptionAction ??
            contextualTriggeredAction ??
            selectedRequirementAction ??
            typedRequirementAction ??
            typedAction;
        const interactionMode: EvaluateInteractionMode = shouldUseArchitectureInteractionMode()
            ? "architecture"
            : "chat";
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

        await continueEvaluation({
            requestMessages: newMessages,
            latestUserContext,
            interactionMode
        });
    };

    const continueEvaluationRef = useRef(continueEvaluation);

    useEffect(() => {
        continueEvaluationRef.current = continueEvaluation;
    });

    useEffect(() => {
        if (isHydrating || isLoading || !pendingEvaluation) return;
        if (!project || !currentVersion) return;
        if (resumedPendingEvaluationIdsRef.current.has(pendingEvaluation.requestId)) return;

        resumedPendingEvaluationIdsRef.current.add(pendingEvaluation.requestId);
        const latestUserContext = [...pendingEvaluation.requestMessages]
            .reverse()
            .find((message) => message.role === "user")
            ?.content ?? "";
        const existingAssistantContent =
            messages[messages.length - 1]?.role === "assistant"
                ? messages[messages.length - 1]?.content ?? ""
                : pendingEvaluation.assistantContent ?? "";

        void continueEvaluationRef.current({
            requestMessages: pendingEvaluation.requestMessages,
            latestUserContext,
            interactionMode: pendingEvaluation.interactionMode ?? "architecture",
            resumePending: pendingEvaluation,
            assistantContent: existingAssistantContent
        });
    }, [pendingEvaluation, isHydrating, isLoading, project, currentVersion, messages]);

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
        if (isChatCollapsed) return;
        e.preventDefault();
        isResizingRef.current = true;
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
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
            const requestGeneration = async (outputMode: OutputMode, currentProjectTree?: FileNode[]) => {
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
                        outputMode,
                        oneClickMode: GENERATE_ONE_CLICK_MODE,
                        ideProfile: GENERATE_IDE_PROFILE,
                        templateKindHint,
                        currentProjectTree,
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
                if (payload.preflightReport && !payload.preflightReport.pass) {
                    const codes = payload.preflightReport.issues.map((issue) => issue.code).join(", ");
                    throw new Error(uiText.scaffoldPreflightFailed(codes || "unknown"));
                }
                return payload as GenerationResponse;
            };

            const nextArtifacts: GenerationArtifacts = {};
            let partialFailure: Error | null = null;

            for (const outputMode of GENERATE_OUTPUT_MODES) {
                try {
                    const artifact = await requestGeneration(
                        outputMode,
                        generationArtifacts[outputMode]?.projectTree ?? generation?.projectTree
                    );
                    nextArtifacts[outputMode] = artifact;
                } catch (error) {
                    if (!partialFailure) {
                        partialFailure = error instanceof Error ? error : new Error(uiText.scaffoldGenerationFailed);
                    }
                }
            }

            const primaryGeneration = resolvePrimaryGeneration(nextArtifacts);
            if (!primaryGeneration) {
                throw partialFailure || new Error(uiText.scaffoldGenerationFailed);
            }

            setGenerationArtifacts(nextArtifacts);
            setGeneration(primaryGeneration);
            setCurrentVersion((prev) => prev ? { ...prev, status: "published" } : prev);
            setInput("");
            setPendingAttachments([]);

            // Auto switch tab
            setActiveTab(getPreferredGeneratedTab(nextArtifacts));

            // Mock Task Generation
            setTasks([
                { id: '1', title: uiText.setupProjectStructure, status: 'pending', description: uiText.setupProjectStructureDesc, source: 'scaffold' },
                { id: '2', title: uiText.implementCoreFeatures, status: 'pending', description: uiText.implementCoreFeaturesDesc, source: 'scaffold' },
            ]);

            if (partialFailure) {
                console.warn("[generate] partial artifact generation failure", partialFailure.message);
            }

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
                            generationArtifacts,
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
                beginNavigation("/login");
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

    const isPrdTabActive = activeTab === "prd";
    const canonicalPrdView = isPrdTabActive
        ? buildCanonicalPrdViewModel(
            workspaceLanguage,
            architecturePack,
            decisionRecords,
            guardrailChecklist,
            architectureReadiness,
            minimumViableLoop
        )
        : null;
    const prdSummaryLines = canonicalPrdView?.summaryLines ?? [];
    const prdConversationSignals = isPrdTabActive
        ? buildPrdConversationSignals(workspaceLanguage, messages)
        : [];
    const prdArchitectureSnapshot = canonicalPrdView?.architectureSnapshot ?? [];
    const prdClarifiedItems = canonicalPrdView?.clarifiedItems ?? [];
    const prdOpenQuestions = canonicalPrdView?.openQuestions ?? [];
    const prdDecisionLog = canonicalPrdView?.decisionLog ?? [];
    const prdGuardrailItems = canonicalPrdView?.guardrailItems ?? [];
    const isShowingStaleProject = Boolean(projectId && project && project.id !== projectId);
    const isShowingStaleVersion = Boolean(
        versionId &&
        projectId &&
        project?.id === projectId &&
        currentVersion &&
        currentVersion.id !== versionId
    );
    const shouldMaskStaleWorkspace = isShowingStaleProject || isShowingStaleVersion;

    if (!project || !currentVersion || shouldMaskStaleWorkspace) return <WizardSkeleton />;

    return (
        <>
            <div className="relative flex h-screen w-full overflow-hidden font-sans text-slate-900 dark:text-slate-100">
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(13,93,255,0.16),transparent_70%)]" />
                {/* Project Sidebar + Chat (Left) */}
                {isChatCollapsed ? (
                    <aside className="relative z-10 flex h-full w-[76px] flex-shrink-0 flex-col items-center gap-4 border-r border-[color:var(--border)] bg-white/82 px-3 py-4 shadow-[var(--shadow-sm)] backdrop-blur-sm dark:bg-slate-900/72">
                        <button
                            type="button"
                            onClick={() => setIsChatCollapsed(false)}
                            className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-[color:var(--border)] bg-white/90 text-slate-600 shadow-sm transition-colors hover:bg-blue-50 hover:text-blue-600 dark:bg-slate-800/90 dark:text-slate-200 dark:hover:bg-blue-900/30 dark:hover:text-blue-200"
                            title={expandChatLabel}
                            aria-label={expandChatLabel}
                        >
                            <PanelLeftOpen className="h-5 w-5" />
                        </button>
                        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-cyan-500 text-sm font-bold text-white shadow-lg">
                            {((project?.name || "P").trim().charAt(0) || "P").toUpperCase()}
                        </div>
                        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400 [writing-mode:vertical-rl] dark:text-slate-500">
                            {collapsedChatHint}
                        </div>
                    </aside>
                ) : (
                <VersionSidebar
                    project={project}
                    width={sidebarWidth}
                    language={workspaceLanguage}
                    headerActions={(
                        <button
                            type="button"
                            onClick={() => setIsChatCollapsed(true)}
                            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-[color:var(--border)] bg-white/90 px-3 text-[13px] font-medium text-slate-600 shadow-sm transition-colors hover:bg-blue-50 hover:text-blue-600 dark:bg-slate-800/90 dark:text-slate-200 dark:hover:bg-blue-900/30 dark:hover:text-blue-200"
                            title={collapseChatLabel}
                            aria-label={collapseChatLabel}
                        >
                            <PanelLeftClose className="h-4 w-4" />
                            <span>{collapseChatLabel}</span>
                        </button>
                    )}
                >
                <div className="relative z-10 flex h-full min-h-0 flex-col">
                    <div className="flex-1 min-h-0">
                        <div
                            className="relative z-10 flex h-full flex-col border-l border-[color:var(--border)] bg-white/82 shadow-[var(--shadow-sm)] backdrop-blur-sm dark:bg-slate-900/72"
                            onPaste={handlePaste}
                        >
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
                                            isStreaming={isAssistantStreamingVisible && messageIndex === lastMessageIndex}
                                        />
                                    );
                                })}

                                {isLoading && !lastAssistantHasVisibleContent && (
                                    <div className="flex justify-start animate-pulse">
                                        <div className="rounded-xl rounded-tl-none bg-slate-100 px-4 py-2 text-[13px] text-slate-500 dark:bg-slate-800 dark:text-slate-300">
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
                                    {isConversationLocked ? (
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
                )}

            {!isChatCollapsed && (
                <div
                    onPointerDown={handleResizeStart}
                    className="z-20 w-1.5 flex-shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-blue-200/60 dark:hover:bg-blue-800/50"
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={uiText.resizeChatPanel}
                    style={{ touchAction: "none" }}
                />
            )}

            {/* Studio Panel (Right) - v2 Layout */}
            <main className="relative z-10 flex h-full min-w-0 flex-1 flex-col overflow-hidden p-4 md:p-6">
                {/* Tabs */}
                <div className="fc-surface mb-4 grid flex-shrink-0 grid-cols-3 gap-2 rounded-2xl p-2">
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
                        active={activeTab === 'spec'}
                        onClick={() => setActiveTab('spec')}
                        icon={<FileText className="w-4 h-4" />}
                        label="Spec Pack"
                        disabled={!generationArtifacts.virtual_spec}
                    />
                </div>

                {/* Content Area */}
                <div className="fc-surface-strong relative flex-1 min-h-0 overflow-hidden rounded-[var(--radius-2xl)]">

                    {/* Architecture Tab */}
                    {activeTab === 'architecture' && (
                        <div className="absolute inset-0 overflow-y-auto">
                            <div className="h-full min-h-[520px]">
                                {shouldMountArchitectureViewer ? (
                                    <ArchitectureViewer code={architectureViewerCode} onNodeSelect={handleArchitectureNodeSelect} language={workspaceLanguage} />
                                ) : (
                                    <ArchitecturePanelPlaceholder />
                                )}
                            </div>
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
                                            {prdDecisionLog.length > 0 ? prdDecisionLog.map((record, index) => (
                                                <div key={`prd-decision-${index}`} className="rounded-xl border border-[color:var(--border)] bg-slate-50/80 px-3 py-2 text-sm text-slate-700 dark:bg-slate-800/40 dark:text-slate-200">
                                                    <p className="font-semibold text-slate-900 dark:text-slate-100">{record.title}</p>
                                                    <p className="mt-1">{record.detail}</p>
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

                    {/* Spec Pack Tab */}
                    {activeTab === 'spec' && generationArtifacts.virtual_spec && (
                        <div className="absolute inset-0 p-4 overflow-hidden">
                            <FileTreeDisplay
                                content={generationArtifacts.virtual_spec.projectTree}
                                projectName={project?.name}
                                language={workspaceLanguage}
                                title={workspaceLanguage === "zh" ? "Spec Pack 文件预览" : "Spec Pack Preview"}
                                downloadLabel={workspaceLanguage === "zh" ? "下载 Spec Pack ZIP" : "Download Spec Pack ZIP"}
                                zipFileNameSuffix="spec-pack"
                                emptyStateLabel={workspaceLanguage === "zh" ? "当前还没有生成 Spec Pack 文件。" : "No Spec Pack files generated yet."}
                            />
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
            className={`flex w-full min-w-0 items-center justify-center gap-2 rounded-xl px-3 py-2 text-[11px] font-semibold transition-all sm:text-xs ${active
                ? 'border border-blue-200 bg-blue-50 text-blue-700 shadow-sm dark:border-blue-700/40 dark:bg-blue-900/20 dark:text-blue-200'
                : 'text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800/65'} ${disabled ? 'cursor-not-allowed opacity-45' : ''}`}
        >
            {icon}
            <span className="truncate">{label}</span>
        </button>
    );
}

function ArchitecturePanelPlaceholder() {
    return (
        <div className="flex h-full min-h-[520px] items-center justify-center p-6">
            <div className="w-full max-w-3xl space-y-4">
                <div className="mx-auto h-4 w-44 animate-pulse rounded bg-slate-200/80 dark:bg-slate-800/80" />
                <div className="h-24 animate-pulse rounded-2xl bg-slate-200/70 dark:bg-slate-800/70" />
                <div className="grid gap-4 md:grid-cols-2">
                    <div className="h-48 animate-pulse rounded-2xl bg-slate-100/90 dark:bg-slate-800/60" />
                    <div className="h-48 animate-pulse rounded-2xl bg-slate-100/90 dark:bg-slate-800/60" />
                </div>
                <div className="h-32 animate-pulse rounded-2xl bg-slate-100/90 dark:bg-slate-800/60" />
            </div>
        </div>
    );
}

function WizardSkeleton() {
    return <RoutePendingState label="Loading workspace..." />;
}

export default function WizardPage() {
    return (
        <Suspense fallback={<WizardSkeleton />}>
            <WizardContent />
        </Suspense>
    );
}
