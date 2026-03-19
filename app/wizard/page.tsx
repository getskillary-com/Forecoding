"use client";

import { useState, useEffect, useRef, Suspense, type ReactNode } from "react";
import { Send, Sparkles, Loader2, BrainCircuit, Check, Paperclip, X, FileText, Square, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import {
    ArchitecturePack,
    ArchitectureStage,
    DecisionRecord,
    EvaluateQuestionEvent,
    EvaluateReadinessUpdateEvent,
    EvaluateRemediationEvent,
    EvaluateTraceEvent,
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
    ReadinessRequirement,
    ReadinessRequirementKey,
    ReadinessRequirementStatus,
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
    PrdDelta,
    Attachment,
    FileNode
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
    syncWorkspaceProjectsRemote,
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
    inferPlatformStrategyFromText,
    mergePlatformStrategies,
    resolvePrimaryPlatformCategory
} from "@/lib/platforms";
import {
    buildArchitectureDiagramModel,
    deriveArchitectureDiagramMermaid,
    hasStructuredArchitectureDiagramSource
} from "@/lib/architecture-diagram";
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
const DIAGRAM_POLICY = "derived_from_structured_state_v1" as const;
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
const OPEN_PRD_PATTERN = /open prd|show prd|prd record|product requirements|open requirements|show requirements|requirements tab|requirements view|打开prd|查看prd|打开需求进度|查看需求进度|需求记录|需求进度|需求面板|prd记录/i;
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

function createMessageId() {
    return `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildLegacyMessageId(candidate: Partial<Message>, index: number) {
    const questionSeed = typeof candidate.questionKey === "string" && candidate.questionKey.trim()
        ? normalizeQuestionKey(candidate.questionKey).slice(0, 24)
        : typeof candidate.content === "string" && candidate.content.trim()
            ? normalizeQuestionKey(candidate.content).slice(0, 24)
            : `m${index}`;
    const roleSeed = candidate.role === "assistant" ? "a" : "u";
    return `legacy-${roleSeed}-${index}-${questionSeed || "item"}`;
}

function normalizeMessageValue(value: unknown, index: number): Message | null {
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
    const id = typeof candidate.id === "string" && candidate.id.trim()
        ? candidate.id.trim()
        : buildLegacyMessageId(candidate, index);
    const createdAt = typeof candidate.createdAt === "number"
        ? candidate.createdAt
        : (index + 1) * 1000;

    return {
        id,
        createdAt,
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
        .map((item, index) => normalizeMessageValue(item, index))
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
    const assistantQuestions = new Map<string, {
        question: string;
        requirementKey: ReadinessRequirementKey | null;
    }>();
    const resolvedByQuestionKey = new Map<string, {
        questionKey: string;
        question: string;
        answer: string;
        action: MessageAction | null;
        requirementKey: ReadinessRequirementKey | null;
    }>();

    messages.forEach((message) => {
        if (message.role !== "assistant" || !message.questionKey) return;
        const normalizedQuestion = normalizeSingleQuestion(message.content || "");
        assistantQuestions.set(message.questionKey, {
            question: normalizedQuestion || message.questionKey,
            requirementKey: message.questionRequirementKey ?? null
        });
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
            const assistantMeta = assistantQuestions.get(message.answeredQuestionKey);

            resolvedByQuestionKey.set(message.answeredQuestionKey, {
                questionKey: message.answeredQuestionKey,
                question: assistantMeta?.question || message.answeredQuestionKey,
                answer,
                action: message.triggeredAction ?? null,
                requirementKey: assistantMeta?.requirementKey ?? null
            });
        });

    return [...resolvedByQuestionKey.values()].slice(-maxItems);
}

type ConversationSyncedState = {
    architecturePack: ArchitecturePack;
    decisionRecords: DecisionRecord[];
    guardrailChecklist: GuardrailChecklist;
};

function normalizeConversationText(value: string | null | undefined) {
    return (value || "")
        .replace(/\r\n/g, "\n")
        .replace(/\u00a0/g, " ")
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

function mergeStringValues(existing: string[], additions: string[], maxItems: number = 24) {
    return normalizeStringList([...existing, ...additions].map((item) => normalizeConversationText(item)), maxItems);
}

function mergeObjectsByStableKey<T>(
    existing: T[],
    additions: T[],
    getKey: (item: T) => string
) {
    const seen = new Set(
        existing
            .map((item) => normalizeConversationText(getKey(item)).toLowerCase())
            .filter(Boolean)
    );
    const merged = [...existing];
    additions.forEach((item) => {
        const key = normalizeConversationText(getKey(item)).toLowerCase();
        if (!key || seen.has(key)) return;
        seen.add(key);
        merged.push(item);
    });
    return merged;
}

function chooseMoreSpecificText(existing: string, candidate: string) {
    const normalizedExisting = normalizeConversationText(existing);
    const normalizedCandidate = normalizeConversationText(candidate);
    if (!normalizedCandidate) return normalizedExisting;
    if (!normalizedExisting) return normalizedCandidate;
    return normalizedCandidate.length > normalizedExisting.length + 12
        ? normalizedCandidate
        : normalizedExisting;
}

function isSubstantiveConversationAnswer(answer: string) {
    const normalized = normalizeConversationText(answer).toLowerCase();
    if (!normalized || normalized.length < 4) return false;
    if (/^(yes|yeah|yep|ok|okay|sure|continue|go ahead|same|agree|agreed|同意|继续|好的|好|可以|是的)$/.test(normalized)) {
        return false;
    }
    return !(
        /给我补充模板|高质量补充模板|give me a template|production-grade template|show me .*example|给我示例|show me common options|常见选项|列出当前阻塞项|list blockers|我来补充这个缺口|我来手动补充|我来自己描述|我来自己定义|i will fill|i will define|i will describe|我按模板回答|continue asking/i.test(normalized)
    );
}

function inferRequirementKeyFromConversation(
    question: string,
    answer: string,
    explicitRequirementKey: ReadinessRequirementKey | null
): ReadinessRequirementKey | null {
    if (explicitRequirementKey) return explicitRequirementKey;
    const source = `${question}\n${answer}`.toLowerCase();

    if (/product goal|产品目标|要做什么|build /i.test(source)) return "business_context.product_goal";
    if (/platform|响应式 web|web 端|微信小程序|移动端 app|首发平台|平台发布|运行环境/i.test(source)) return "business_context.platforms";
    if (/target user|核心用户|目标用户|谁是用户|audience/i.test(source)) return "business_context.target_users";
    if (/user journey|workflow|旅程|流程|主流程|使用流程/i.test(source)) return "business_context.user_journeys";
    if (/constraint|risk|预算|风格|约束|风险|特殊人群|交通偏好|必去景点/i.test(source)) return "business_context.constraints_or_risks";
    if (/bounded context|限界上下文/i.test(source)) return "boundaries.bounded_contexts";
    if (/module responsibility|模块职责|核心模块|module/i.test(source)) return "boundaries.module_responsibilities";
    if (/data ownership|ownership|retention|账户归属|数据归属|保留期|匿名|登录体系/i.test(source)) return "boundaries.data_ownership";
    if (/architecture decision|decision record|架构决策|技术栈|stack|framework|hosting|backend|deploy|托管|部署|框架/i.test(source)) return "decisions.decision_records";
    if (/integration contract|输入输出契约|api contract|集成契约/i.test(source)) return "decisions.integration_contracts";
    if (/non-functional|timeout|retry|超时|重试|性能|稳定性|可用性|隐私|latency|availability/i.test(source)) return "decisions.non_functional_requirements";
    if (/implementation order|phase|开发计划|推进开发|顺序推进|三个阶段/i.test(source)) return "guardrails.implementation_order";
    if (/acceptance criteria|验收标准|definition of done/i.test(source)) return "guardrails.acceptance_criteria";
    if (/test strategy|测试策略|testing/i.test(source)) return "guardrails.test_strategy";
    if (/key screen|关键界面|页面|screen/i.test(source)) return "ui.key_screens";
    if (/shared component|共享 ui 组件|shared ui/i.test(source)) return "ui.shared_components";
    if (/responsive|响应式/i.test(source)) return "ui.responsive_strategy";

    return null;
}

function extractListLikeItems(answer: string, maxItems: number = 8) {
    const normalized = normalizeConversationText(answer);
    if (!normalized) return [];

    const lineItems = normalized
        .split("\n")
        .map((line) => line.trim())
        .map((line) => line.replace(/^[-*•]\s*/, "").replace(/^\d+[\.\)]\s*/, "").trim())
        .filter((line) => line.length >= 8);
    if (lineItems.length >= 2) return normalizeStringList(lineItems, maxItems);

    const clauseItems = normalized
        .split(/[；;]\s*/g)
        .map((item) => item.trim())
        .filter((item) => item.length >= 8);
    if (clauseItems.length >= 2) return normalizeStringList(clauseItems, maxItems);

    return [];
}

function extractStructuredStageItems(
    answer: string,
    maxItems: number = 8,
    minChars: number = 8
) {
    const normalized = normalizeConversationText(answer);
    if (!normalized) return [];

    const listItems = extractListLikeItems(normalized, maxItems);
    if (listItems.length >= 2) return listItems;

    const paragraphItems = normalized
        .split(/\n{2,}/)
        .map((item) => item.trim())
        .filter((item) => item.length >= minChars);
    if (paragraphItems.length >= 2) return normalizeStringList(paragraphItems, maxItems);

    const sentenceItems = normalized
        .split(/[。！？!?]\s*/g)
        .map((item) => item.trim())
        .filter((item) => item.length >= minChars);
    if (sentenceItems.length >= 2) return normalizeStringList(sentenceItems, maxItems);

    const clauseItems = normalized
        .split(/[；;，,、]\s*/g)
        .map((item) => item.trim())
        .filter((item) => item.length >= minChars);
    if (clauseItems.length >= 2) return normalizeStringList(clauseItems, maxItems);

    return [];
}

const CONVERSATION_CONSTRAINT_PATTERN = /constraint|限制|约束|必须|需要|需|require|required|must|limit|limited|quota|rate limit|限流|防刷|deadline|timeline|时间|周期|天内|周内|预算|成本|performance|latency|stability|上线/i;
const CONVERSATION_RISK_PATTERN = /risk|风险|担心|最怕|怕|worried|concern|爆表|刷爆|幻觉|失真|错误|失败|中断|丢失|泄露|滥用|资损|不稳定|崩溃/i;

function extractConstraintRiskItems(answer: string) {
    const normalized = normalizeConversationText(answer);
    if (!normalized) {
        return {
            constraintItems: [] as string[],
            riskItems: [] as string[]
        };
    }

    const punctuationItems = normalized
        .split(/[；;，,\n]/)
        .map((item) => item.trim())
        .filter((item) => item.length >= 4);

    const candidates = normalizeStringList([
        ...extractListLikeItems(normalized, 10),
        ...punctuationItems,
        normalized
    ], 12);

    const riskItems = normalizeStringList(
        candidates.filter((entry) => CONVERSATION_RISK_PATTERN.test(entry)),
        10
    );
    const constraintItems = normalizeStringList(
        candidates.filter(
            (entry) =>
                !riskItems.includes(entry) &&
                CONVERSATION_CONSTRAINT_PATTERN.test(entry)
        ),
        10
    );

    return {
        constraintItems: constraintItems.length > 0 || !CONVERSATION_CONSTRAINT_PATTERN.test(normalized)
            ? constraintItems
            : [normalized],
        riskItems: riskItems.length > 0 || !CONVERSATION_RISK_PATTERN.test(normalized)
            ? riskItems
            : [normalized]
    };
}

function extractJourneyItems(answer: string) {
    const normalized = normalizeConversationText(answer);
    if (!normalized) return [];

    const repeatedTemplateHeaderCount = (normalized.match(/谁发起这条流程|Who initiates this flow/gi) || []).length;
    if (repeatedTemplateHeaderCount >= 2) {
        const blocks = normalized
            .split(/(?=(?:谁发起这条流程|Who initiates this flow))/i)
            .map((block) => normalizeConversationText(block))
            .filter((block) => block.length >= 24);
        if (blocks.length >= 2) return normalizeStringList(blocks, 6);
    }

    const labeledBlocks = normalized
        .split(/\n{2,}(?=(?:流程|旅程|Journey|Flow)\s*\d*[:：-]?)/i)
        .map((block) => normalizeConversationText(block))
        .filter((block) => block.length >= 24);
    if (labeledBlocks.length >= 2) return normalizeStringList(labeledBlocks, 6);

    const paragraphBlocks = normalized
        .split(/\n{2,}/)
        .map((block) => normalizeConversationText(block))
        .filter((block) => block.length >= 24);
    if (paragraphBlocks.length >= 2) return normalizeStringList(paragraphBlocks, 6);

    const listItems = extractListLikeItems(normalized, 6);
    if (listItems.length >= 2) return listItems;

    return [normalized];
}

function deriveContextNameFromText(answer: string, fallback: string) {
    const normalized = normalizeConversationText(answer);
    const firstClause = normalized
        .split(/[:：。.!?？；;]/)[0]
        .trim()
        .replace(/^[-*•]\s*/, "");
    if (!firstClause) return fallback;
    return clipText(firstClause, 40);
}

function maybeCreateDecisionRecordFromConversation(
    question: string,
    answer: string
): DecisionRecord | null {
    const source = `${question}\n${answer}`.toLowerCase();
    if (!/分享|share|匿名|login|auth|token|地图|map|places|llm|大模型|database|数据库|localstorage|导出|export|pdf|长图|无状态|stateless|超时|timeout|重试|retry|流式|stream|api|gateway|拖拽|drag|局部重生成|wizard|多步向导/i.test(source)) {
        return null;
    }

    const normalizedQuestion = normalizeConversationText(question).replace(/[?？]$/, "");
    const normalizedAnswer = normalizeConversationText(answer);
    if (!normalizedQuestion || !normalizedAnswer) return null;

    return {
        title: clipText(normalizedQuestion, 80),
        decision: clipText(normalizedAnswer, 260),
        rationale: clipText(`Confirmed during requirements discovery: ${normalizedQuestion}`, 220),
        alternativesRejected: [],
        consequences: ["This decision directly affects product scope, architecture boundaries, or delivery tradeoffs."]
    };
}

function maybeCreateNfrFromConversation(
    question: string,
    answer: string
) {
    const source = `${question}\n${answer}`.toLowerCase();
    if (!/timeout|retry|超时|重试|解析异常|格式错误|稳定性|resilien|latency|response time|可用性|availability/i.test(source)) {
        return null;
    }

    const normalizedAnswer = normalizeConversationText(answer);
    if (!normalizedAnswer) return null;

    return {
        category: /latency|response time|响应速度|延迟/i.test(source)
            ? "performance"
            : "resilience",
        requirement: clipText(normalizedAnswer, 220),
        rationale: clipText(`Confirmed during requirements discovery: ${normalizeConversationText(question)}`, 220)
    };
}

function syncStructuredStateFromConversation(input: {
    architecturePack: ArchitecturePack;
    decisionRecords: DecisionRecord[];
    guardrailChecklist: GuardrailChecklist;
    analysis: EvaluationResponse["analysis"] | null | undefined;
    messages: Message[];
}): ConversationSyncedState {
    const analysis = normalizeAnalysis(input.analysis);
    const seededPack = seedArchitecturePackFromAnalysis(analysis, analysis.ui);

    let architecturePack = normalizeArchitecturePack(input.architecturePack, analysis.ui);
    let decisionRecords = normalizeDecisionRecords(input.decisionRecords);
    let guardrailChecklist = normalizeGuardrailChecklist(input.guardrailChecklist);

    architecturePack = normalizeArchitecturePack({
        ...architecturePack,
        businessContext: {
            productGoal: chooseMoreSpecificText(architecturePack.businessContext.productGoal, seededPack.businessContext.productGoal),
            targetUsers: mergeStringValues(architecturePack.businessContext.targetUsers, seededPack.businessContext.targetUsers, 8),
            userJourneys: mergeStringValues(architecturePack.businessContext.userJourneys, seededPack.businessContext.userJourneys, 8),
            constraints: mergeStringValues(architecturePack.businessContext.constraints, seededPack.businessContext.constraints, 10),
            risks: mergeStringValues(architecturePack.businessContext.risks, seededPack.businessContext.risks, 10)
        },
        platformStrategy: mergePlatformStrategies(architecturePack.platformStrategy, seededPack.platformStrategy),
        nonFunctionalRequirements: mergeObjectsByStableKey(
            architecturePack.nonFunctionalRequirements,
            seededPack.nonFunctionalRequirements,
            (item) => `${item.category}::${item.requirement}`
        ),
        experienceConstraints: {
            keyScreens: mergeStringValues(architecturePack.experienceConstraints.keyScreens, seededPack.experienceConstraints.keyScreens, 8),
            uiComponents: mergeStringValues(architecturePack.experienceConstraints.uiComponents, seededPack.experienceConstraints.uiComponents, 10),
            interactionStates: mergeStringValues(architecturePack.experienceConstraints.interactionStates, seededPack.experienceConstraints.interactionStates, 10),
            responsiveStrategy: mergeStringValues(architecturePack.experienceConstraints.responsiveStrategy, seededPack.experienceConstraints.responsiveStrategy, 8)
        }
    }, analysis.ui);

    const resolvedConfirmations = buildResolvedConfirmationLog(input.messages);

    resolvedConfirmations.forEach((item) => {
        const answer = normalizeConversationText(item.answer);
        if (!isSubstantiveConversationAnswer(answer)) return;

        const requirementKey = inferRequirementKeyFromConversation(item.question, answer, item.requirementKey);
        const listItems = extractListLikeItems(answer);

        switch (requirementKey) {
            case "business_context.product_goal":
                architecturePack = {
                    ...architecturePack,
                    businessContext: {
                        ...architecturePack.businessContext,
                        productGoal: chooseMoreSpecificText(architecturePack.businessContext.productGoal, answer)
                    }
                };
                break;
            case "business_context.platforms":
                {
                    const inferredFromAnswer = inferPlatformStrategyFromText(answer);
                    const inferredPlatformStrategy = hasConfirmedPlatformStrategy(inferredFromAnswer)
                        ? inferredFromAnswer
                        : inferPlatformStrategyFromText(item.question);
                architecturePack = {
                    ...architecturePack,
                    platformStrategy: mergePlatformStrategies(
                        architecturePack.platformStrategy,
                        inferredPlatformStrategy
                    )
                };
                }
                break;
            case "business_context.target_users":
                architecturePack = {
                    ...architecturePack,
                    businessContext: {
                        ...architecturePack.businessContext,
                        targetUsers: mergeStringValues(
                            architecturePack.businessContext.targetUsers,
                            listItems.length > 0 ? listItems : [answer],
                            8
                        )
                    }
                };
                break;
            case "business_context.user_journeys":
                architecturePack = {
                    ...architecturePack,
                    businessContext: {
                        ...architecturePack.businessContext,
                        userJourneys: mergeStringValues(
                            architecturePack.businessContext.userJourneys,
                            extractJourneyItems(answer),
                            8
                        )
                    }
                };
                break;
            case "business_context.constraints_or_risks": {
                const additions = listItems.length > 0 ? listItems : [answer];
                const extractedItems = extractConstraintRiskItems(answer);
                const riskItems = extractedItems.riskItems.length > 0
                    ? extractedItems.riskItems
                    : additions.filter((entry) => CONVERSATION_RISK_PATTERN.test(entry));
                const constraintItems = extractedItems.constraintItems.length > 0
                    ? extractedItems.constraintItems
                    : additions.filter((entry) => !riskItems.includes(entry));
                architecturePack = {
                    ...architecturePack,
                    businessContext: {
                        ...architecturePack.businessContext,
                        constraints: mergeStringValues(architecturePack.businessContext.constraints, constraintItems, 10),
                        risks: mergeStringValues(architecturePack.businessContext.risks, riskItems, 10)
                    }
                };
                break;
            }
            case "boundaries.bounded_contexts":
                architecturePack = {
                    ...architecturePack,
                    boundedContexts: mergeObjectsByStableKey(
                        architecturePack.boundedContexts,
                        [{
                            name: deriveContextNameFromText(answer, "Core planning context"),
                            responsibility: answer,
                            owns: [],
                            dependencies: []
                        }],
                        (context) => context.name
                    )
                };
                break;
            case "boundaries.module_responsibilities":
                {
                    const responsibilityItems = extractStructuredStageItems(answer, 6, 10);
                architecturePack = {
                    ...architecturePack,
                    moduleResponsibilities: mergeObjectsByStableKey(
                        architecturePack.moduleResponsibilities,
                        (responsibilityItems.length > 0 ? responsibilityItems : [answer]).map((entry) => ({
                            module: deriveContextNameFromText(entry, "Core module"),
                            responsibility: entry,
                            inputs: [],
                            outputs: []
                        })),
                        (module) => module.module
                    )
                };
                }
                break;
            case "boundaries.data_ownership":
                architecturePack = {
                    ...architecturePack,
                    dataOwnership: mergeObjectsByStableKey(
                        architecturePack.dataOwnership,
                        [{
                            data: "Trip planning data",
                            owner: /user|用户|创建者/i.test(answer) ? "User" : "Application",
                            consumers: [],
                            notes: answer
                        }],
                        (ownership) => `${ownership.data}::${ownership.owner}`
                    )
                };
                break;
            case "decisions.decision_records": {
                const decisionItems = extractStructuredStageItems(answer, 4, 12);
                const candidateRecords = (decisionItems.length > 0 ? decisionItems : [answer])
                    .map((entry) => maybeCreateDecisionRecordFromConversation(item.question, entry))
                    .filter((record): record is DecisionRecord => Boolean(record));
                if (candidateRecords.length > 0) {
                    decisionRecords = mergeObjectsByStableKey(
                        decisionRecords,
                        candidateRecords,
                        (record) => `${record.title}::${record.decision}`
                    );
                }
                break;
            }
            case "decisions.integration_contracts":
                architecturePack = {
                    ...architecturePack,
                    integrationContracts: mergeObjectsByStableKey(
                        architecturePack.integrationContracts,
                        [{
                            name: deriveContextNameFromText(item.question, "Primary integration contract"),
                            kind: "api" as const,
                            producer: "frontend",
                            consumer: "ai_gateway",
                            payload: answer,
                            notes: item.question
                        }],
                        (contract) => contract.name
                    )
                };
                break;
            case "decisions.non_functional_requirements": {
                const derivedNfr = maybeCreateNfrFromConversation(item.question, answer) ?? {
                    category: "quality",
                    requirement: clipText(answer, 220),
                    rationale: clipText(`Confirmed during requirements discovery: ${normalizeConversationText(item.question)}`, 220)
                };
                architecturePack = {
                    ...architecturePack,
                    nonFunctionalRequirements: mergeObjectsByStableKey(
                        architecturePack.nonFunctionalRequirements,
                        [derivedNfr],
                        (nfr) => `${nfr.category}::${nfr.requirement}`
                    )
                };
                break;
            }
            case "guardrails.implementation_order":
                {
                    const implementationItems = extractStructuredStageItems(answer, 8, 10);
                guardrailChecklist = {
                    ...guardrailChecklist,
                    implementationOrder: mergeStringValues(
                        guardrailChecklist.implementationOrder,
                        implementationItems.length > 0 ? implementationItems : (listItems.length > 0 ? listItems : [answer]),
                        12
                    )
                };
                }
                break;
            case "guardrails.acceptance_criteria":
                {
                    const acceptanceItems = extractStructuredStageItems(answer, 10, 12);
                guardrailChecklist = {
                    ...guardrailChecklist,
                    acceptanceCriteria: mergeStringValues(
                        guardrailChecklist.acceptanceCriteria,
                        acceptanceItems.length > 0 ? acceptanceItems : (listItems.length > 0 ? listItems : [answer]),
                        16
                    )
                };
                }
                break;
            case "guardrails.test_strategy":
                {
                    const testItems = extractStructuredStageItems(answer, 8, 10);
                guardrailChecklist = {
                    ...guardrailChecklist,
                    testStrategy: mergeStringValues(
                        guardrailChecklist.testStrategy,
                        testItems.length > 0 ? testItems : (listItems.length > 0 ? listItems : [answer]),
                        12
                    )
                };
                }
                break;
            case "ui.key_screens":
                architecturePack = {
                    ...architecturePack,
                    experienceConstraints: {
                        ...architecturePack.experienceConstraints,
                        keyScreens: mergeStringValues(
                            architecturePack.experienceConstraints.keyScreens,
                            listItems.length > 0 ? listItems : [answer],
                            8
                        )
                    }
                };
                break;
            case "ui.shared_components":
                architecturePack = {
                    ...architecturePack,
                    experienceConstraints: {
                        ...architecturePack.experienceConstraints,
                        uiComponents: mergeStringValues(
                            architecturePack.experienceConstraints.uiComponents,
                            listItems.length > 0 ? listItems : [answer],
                            10
                        )
                    }
                };
                break;
            case "ui.responsive_strategy":
                architecturePack = {
                    ...architecturePack,
                    experienceConstraints: {
                        ...architecturePack.experienceConstraints,
                        responsiveStrategy: mergeStringValues(
                            architecturePack.experienceConstraints.responsiveStrategy,
                            listItems.length > 0 ? listItems : [answer],
                            8
                        )
                    }
                };
                break;
            default:
                break;
        }

        const derivedDecisionRecord = maybeCreateDecisionRecordFromConversation(item.question, answer);
        if (derivedDecisionRecord) {
            decisionRecords = mergeObjectsByStableKey(
                decisionRecords,
                [derivedDecisionRecord],
                (record) => `${record.title}::${record.decision}`
            );
        }

        const derivedNfr = maybeCreateNfrFromConversation(item.question, answer);
        if (derivedNfr) {
            architecturePack = {
                ...architecturePack,
                nonFunctionalRequirements: mergeObjectsByStableKey(
                    architecturePack.nonFunctionalRequirements,
                    [derivedNfr],
                    (nfr) => `${nfr.category}::${nfr.requirement}`
                )
            };
        }
    });

    return {
        architecturePack: normalizeArchitecturePack(architecturePack, analysis.ui),
        decisionRecords: normalizeDecisionRecords(decisionRecords),
        guardrailChecklist: normalizeGuardrailChecklist(guardrailChecklist)
    };
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
    readinessOverrides: ReadinessOverride[] = [],
    messages: Message[] = []
): EvaluationResponse | null {
    if (!value || typeof value !== "object") return null;
    const analysis = normalizeAnalysis(value.analysis);
    const syncedState = syncStructuredStateFromConversation({
        architecturePack: normalizeArchitecturePack(value.architecturePackDraft, analysis.ui),
        decisionRecords: normalizeDecisionRecords(value.decisionDrafts),
        guardrailChecklist: normalizeGuardrailChecklist(value.guardrailDrafts),
        analysis,
        messages
    });
    const architecturePackDraft = syncedState.architecturePack;
    const decisionDrafts = syncedState.decisionRecords;
    const guardrailDrafts = syncedState.guardrailChecklist;
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

type WorkingArchitectureState = {
    architecturePack: ArchitecturePack;
    decisionRecords: DecisionRecord[];
    guardrailChecklist: GuardrailChecklist;
    readiness: ReadinessChecklist;
    stage: ArchitectureStage;
};

function resolveWorkingArchitectureState(
    evaluation: EvaluationResponse | null,
    architecturePack: ArchitecturePack,
    decisionRecords: DecisionRecord[],
    guardrailChecklist: GuardrailChecklist,
    readinessOverrides: ReadinessOverride[] = [],
    messages: Message[] = []
): WorkingArchitectureState {
    const normalizedAnalysis = normalizeAnalysis(evaluation?.analysis);
    const syncedState = syncStructuredStateFromConversation({
        architecturePack: normalizeArchitecturePack(
            evaluation?.architecturePackDraft ?? architecturePack,
            normalizedAnalysis.ui
        ),
        decisionRecords: normalizeDecisionRecords(evaluation?.decisionDrafts ?? decisionRecords),
        guardrailChecklist: normalizeGuardrailChecklist(evaluation?.guardrailDrafts ?? guardrailChecklist),
        analysis: normalizedAnalysis,
        messages
    });
    const resolvedPack = syncedState.architecturePack;
    const resolvedDecisions = syncedState.decisionRecords;
    const resolvedGuardrails = syncedState.guardrailChecklist;
    const resolvedReadiness = applyArchitectureStageScoreFloor(
        normalizeReadiness(
            evaluation?.readiness,
            resolvedPack,
            resolvedDecisions,
            resolvedGuardrails,
            readinessOverrides
        )
    );
    const resolvedStage = normalizeArchitectureStage(
        evaluation?.stage,
        resolvedPack,
        resolvedDecisions,
        resolvedGuardrails,
        readinessOverrides
    );

    return {
        architecturePack: resolvedPack,
        decisionRecords: resolvedDecisions,
        guardrailChecklist: resolvedGuardrails,
        readiness: resolvedReadiness,
        stage: resolvedStage
    };
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

type ParsedSseFrame = {
    event: string;
    data: string;
};

function extractSseFrames(buffer: string) {
    const normalized = buffer.replace(/\r\n/g, "\n");
    const frames: ParsedSseFrame[] = [];
    let cursor = 0;

    while (cursor < normalized.length) {
        const boundary = normalized.indexOf("\n\n", cursor);
        if (boundary === -1) break;

        const block = normalized.slice(cursor, boundary);
        cursor = boundary + 2;

        if (!block.trim()) continue;

        const lines = block.split("\n");
        let event = "message";
        const dataLines: string[] = [];

        for (const rawLine of lines) {
            const line = rawLine.trimEnd();
            if (!line || line.startsWith(":")) continue;
            if (line.startsWith("event:")) {
                event = line.slice("event:".length).trim() || "message";
                continue;
            }
            if (line.startsWith("data:")) {
                dataLines.push(line.slice("data:".length).trimStart());
            }
        }

        if (dataLines.length === 0) continue;
        frames.push({
            event,
            data: dataLines.join("\n")
        });
    }

    return {
        frames,
        rest: normalized.slice(cursor)
    };
}

function parseSsePayload<T>(data: string): T | null {
    try {
        return JSON.parse(data) as T;
    } catch {
        return null;
    }
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

function createPrdDeltaId() {
    return `prd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizePrdDeltaAction(value: unknown): PrdDelta["action"] | null {
    return value === "confirmed" ||
        value === "focus_requirement" ||
        value === "fill_requirement" ||
        value === "show_blockers"
        ? value
        : null;
}

function normalizePrdDeltas(
    value: unknown,
    messages: Message[] = []
): PrdDelta[] {
    if (Array.isArray(value)) {
        const normalized = value
            .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
            .reduce<PrdDelta[]>((acc, item, index) => {
                const action = normalizePrdDeltaAction(item.action);
                const id = typeof item.id === "string" && item.id.trim()
                    ? item.id.trim()
                    : `prd-${index}`;
                if (!action) return acc;

                acc.push({
                    id,
                    createdAt: typeof item.createdAt === "number" ? item.createdAt : Date.now() - (index * 1000),
                    action,
                    requirementKey: normalizeReadinessRequirementKey(item.requirementKey) ?? null,
                    questionKey: typeof item.questionKey === "string" && item.questionKey.trim()
                        ? normalizeQuestionKey(item.questionKey)
                        : null,
                    sourceMessageId: typeof item.sourceMessageId === "string" && item.sourceMessageId.trim()
                        ? item.sourceMessageId.trim()
                        : null
                });

                return acc;
            }, []);

        if (normalized.length > 0) {
            return normalized.slice(-24);
        }
    }

    return buildResolvedConfirmationLog(messages, 12)
        .map((item, index) => ({
            id: `legacy-prd-${index}-${item.questionKey}`,
            createdAt: Date.now() - ((12 - index) * 1000),
            action: item.action === "focus_requirement" ||
                item.action === "fill_requirement" ||
                item.action === "show_blockers"
                ? item.action
                : "confirmed",
            requirementKey: item.requirementKey ?? undefined,
            questionKey: item.questionKey,
            sourceMessageId: undefined
        } satisfies PrdDelta))
        .slice(-12);
}

function normalizeVersionDesignState(
    data: ProjectVersion["data"] | null | undefined,
    language: WorkspaceLanguage = "en"
) {
    const messages = normalizeMessages(data?.messages);
    const readinessOverrides = normalizeReadinessOverrides(data?.readinessOverrides);
    const evaluation = normalizeEvaluation(data?.evaluation ?? null, readinessOverrides, messages);
    const uiDesignSpec = normalizeUiDesignSpec(data?.uiDesignSpec, evaluation?.analysis?.ui);
    const uiDesignState = normalizeUiDesignState(data?.uiDesignState, evaluation, uiDesignSpec);
    const baseArchitecturePack = normalizeArchitecturePack(
        data?.architecturePack ?? evaluation?.architecturePackDraft ?? seedArchitecturePackFromAnalysis(evaluation?.analysis, evaluation?.analysis?.ui)
    );
    const baseDecisionRecords = normalizeDecisionRecords(
        data?.decisionRecords ?? evaluation?.decisionDrafts
    );
    const baseGuardrailChecklist = normalizeGuardrailChecklist(
        data?.guardrailChecklist ?? evaluation?.guardrailDrafts
    );
    const syncedState = syncStructuredStateFromConversation({
        architecturePack: baseArchitecturePack,
        decisionRecords: baseDecisionRecords,
        guardrailChecklist: baseGuardrailChecklist,
        analysis: evaluation?.analysis,
        messages
    });
    const architecturePack = syncedState.architecturePack;
    const decisionRecords = syncedState.decisionRecords;
    const guardrailChecklist = syncedState.guardrailChecklist;
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
    const prdDeltas = normalizePrdDeltas(data?.prdDeltas, messages);
    const currentDiagram = deriveArchitectureDiagramMermaid({
        architecturePack,
        decisionRecords,
        guardrailChecklist,
        language,
        fallbackDiagram: typeof data?.currentDiagram === "string" ? data.currentDiagram : ""
    });

    return {
        messages,
        evaluation,
        currentDiagram,
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
        prdDeltas,
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

function inferTemplateKindHintFromTree(tree?: FileNode[]): "next_root" | "next_src" | "react_vite" | "monorepo_multiapp" | undefined {
    if (!tree || tree.length === 0) return undefined;

    const topLevel = new Set(
        tree
            .map((node) => node?.name)
            .filter((name): name is string => typeof name === "string" && name.trim().length > 0)
    );

    if (topLevel.has("apps") || topLevel.has("packages")) return "monorepo_multiapp";
    const allPaths = new Set<string>();
    const walk = (nodes: FileNode[], prefix = "") => {
        nodes.forEach((node) => {
            const path = prefix ? `${prefix}/${node.name}` : node.name;
            if (node.type === "file") {
                allPaths.add(path);
                return;
            }
            if (node.children?.length) {
                walk(node.children, path);
            }
        });
    };
    walk(tree);
    if (
        allPaths.has("vite.config.ts") ||
        Array.from(allPaths).some((path) => /^src\/pages\/.+\.(ts|tsx|js|jsx)$/i.test(path)) ||
        allPaths.has("src/main.tsx")
    ) {
        return "react_vite";
    }
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

const STRUCTURED_RESPONSE_TAGS = [
    "thinking",
    "stage",
    "density",
    "question",
    "options",
    "diagram",
    "analysis_clarified",
    "analysis_missing",
    "architecture_pack",
    "decision_records",
    "guardrails",
    "readiness",
    "analysis_ui",
    "analysis_ui_spec",
    "is_ready",
    "question_action",
    "question_key",
    "question_requirement_key"
] as const;

function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeStructuredResponseMarkup(raw: string) {
    return raw
        .replace(/\r\n/g, "\n")
        .replace(/<\s*\/\s*([a-z_][\w-]*)\s*>/gi, (_, tag: string) => `</${tag.toLowerCase()}>`)
        .replace(/<\s*([a-z_][\w-]*)\s*>/gi, (_, tag: string) => `<${tag.toLowerCase()}>`);
}

const OPTION_ACTION_PATTERN = [
    "generate_scaffold",
    "open_prd",
    "send_message",
    "focus_requirement",
    "fill_requirement",
    "show_blockers"
].map(escapeRegExp).join("|");

function extractStructuredBlock(raw: string, tag: string) {
    const normalized = normalizeStructuredResponseMarkup(raw).trim();
    if (!normalized) return null;

    const escapedTag = escapeRegExp(tag);
    const match = normalized.match(
        new RegExp(
            `<${escapedTag}>([\\s\\S]*?)(?:<\\/${escapedTag}>|(?=\\s*<(?!\\/?${escapedTag}\\b)[a-z_][\\w-]*\\s*>)|$)`,
            "i"
        )
    );

    return match?.[1] ?? null;
}

function stripStructuredResponseBlocks(raw: string) {
    let normalized = normalizeStructuredResponseMarkup(raw);

    for (const tag of STRUCTURED_RESPONSE_TAGS) {
        const escapedTag = escapeRegExp(tag);
        normalized = normalized.replace(
            new RegExp(
                `<${escapedTag}>[\\s\\S]*?(?:<\\/${escapedTag}>|(?=\\s*<(?!\\/?${escapedTag}\\b)[a-z_][\\w-]*\\s*>)|$)`,
                "gi"
            ),
            " "
        );
    }

    return normalized;
}

function normalizeOptionsBlockText(raw: string) {
    const normalized = normalizeStructuredResponseMarkup(raw).trim();
    if (!normalized) return "";

    return normalized
        .replace(
            new RegExp(`(::(?:${OPTION_ACTION_PATTERN}))\\s+(?=(?:[-*]\\s*)?[^:\\n<][^:\\n<]{1,80}::)`, "gi"),
            "$1\n"
        )
        .replace(/([.!?。！？]["')\]]?)\s+(?=(?:[-*]\s*)?[^:\n<][^:\n<]{1,80}::)/g, "$1\n")
        .replace(/\n{2,}/g, "\n");
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
                { label: "打开需求进度", value: "请切换到需求进度页，我想先确认需求沉淀。", action: "open_prd" },
                { label: "暂时不生成", value: "我暂时不生成，请继续完善架构包。" }
            ];
        }

        return [
            { label: "Generate scaffold now", value: "Generate scaffold now.", action: "generate_scaffold" },
            { label: "I will add more detail", value: "I will add more specific detail. Please continue with the key questions." },
            { label: "Open requirements", value: "Open the requirements tab first so I can double-check the current scope.", action: "open_prd" },
            { label: "Not yet", value: "Not yet. Please continue refining the architecture pack." }
        ];
    }

    if (language === "zh") {
        return [
            { label: "给我补充模板", value: "请给我一个高质量补充模板，我来补齐这项信息。" },
            { label: "我来补充细节", value: "我来补充更多具体细节，请继续问我关键问题。" },
            { label: "给我常见选项", value: "请给我 2 到 3 个常见方案并说明取舍。" },
            { label: "暂时不确定", value: "我暂时不确定，请先用最稳妥的方式继续追问我关键细节。" }
        ];
    }

    return [
        { label: "Give me a template", value: "Give me a high-quality template so I can fill the missing detail." },
        { label: "I will add more detail", value: "I will add more specific detail. Please continue with the key questions." },
        { label: "Show me common options", value: "Please show me 2 or 3 common options and explain the tradeoffs." },
        { label: "I'm not sure yet", value: "I'm not sure yet. Please keep guiding me with the safest next questions." }
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

function buildRequirementCaptureTemplateQuestion(
    language: "zh" | "en",
    requirementKey: ReadinessRequirementKey,
    architecturePack: ArchitecturePack
) {
    const label = getReadinessRequirementLabel(requirementKey, language);
    const knownGoal = architecturePack.businessContext.productGoal.trim();
    const templates: Record<ReadinessRequirementKey, { intro: string; lines: string[] }> = language === "zh"
        ? {
            "business_context.product_goal": {
                intro: "这项内容不能靠默认模板代填。为了达到生产级，我们需要明确业务目标、衡量方式和范围边界。",
                lines: [
                    "目标用户是谁？",
                    "他们当前最痛的 1 个问题是什么？",
                    "这个产品在 v1 要帮他们完成什么结果？",
                    "什么指标会让你判断这版有效？",
                    "这一版明确不做什么？"
                ]
            },
            "business_context.platforms": {
                intro: "平台策略必须直接约束后续架构，所以需要确认首发平台和必须覆盖的运行环境。",
                lines: [
                    "首发平台是什么？",
                    "必须覆盖哪些终端或运行环境？",
                    "为什么这一版优先选这个平台？",
                    "是否有必须支持的分发渠道或部署环境？"
                ]
            },
            "business_context.target_users": {
                intro: "目标用户需要具体到“谁在用、谁受益、谁拍板”，不能只写泛泛的人群。",
                lines: [
                    "主要使用者是谁？",
                    "谁是购买者、管理员或审批者？",
                    "他们现在怎么解决这个问题？",
                    "使用频率和典型规模是什么？",
                    "为什么他们会优先采用你的方案？"
                ]
            },
            "business_context.user_journeys": {
                intro: "用户旅程至少要能支持后续页面、接口和验收设计，所以需要写到可执行的粒度。",
                lines: [
                    "谁发起这条流程？",
                    "触发条件是什么？",
                    "关键步骤 1、2、3 是什么？",
                    "成功输出是什么？",
                    "失败或中断时用户怎么恢复？"
                ]
            },
            "business_context.constraints_or_risks": {
                intro: "生产级需求必须把约束和风险说透，否则后面的技术方案会失真。",
                lines: [
                    "时间、预算或团队约束是什么？",
                    "合规、隐私或安全边界是什么？",
                    "性能、稳定性或成本上限是什么？",
                    "最担心的上线风险是什么？",
                    "如果风险发生，最坏影响是什么？"
                ]
            },
            "boundaries.bounded_contexts": {
                intro: "限界上下文不能靠通用词硬凑，需要从真实业务边界出发。",
                lines: [
                    "这个上下文名称是什么？",
                    "它独立负责什么？",
                    "它明确不负责什么？",
                    "它拥有哪些核心数据或状态？",
                    "它依赖哪些外部上下文？"
                ]
            },
            "boundaries.module_responsibilities": {
                intro: "模块职责要能直接指导实现拆分，所以请明确输入、输出和边界。",
                lines: [
                    "模块名称是什么？",
                    "模块唯一责任是什么？",
                    "它接收哪些输入？",
                    "它输出什么结果？",
                    "它不能碰哪些职责或状态？"
                ]
            },
            "boundaries.data_ownership": {
                intro: "数据归属会直接影响隐私、同步和权限设计，不能用默认规则代替真实业务约束。",
                lines: [
                    "这类数据是什么？",
                    "谁拥有它？",
                    "谁可以读取、修改或导出？",
                    "默认保留期多久？",
                    "删除、审计或合规要求是什么？"
                ]
            },
            "decisions.decision_records": {
                intro: "架构决策必须带理由和取舍，否则只是口号。",
                lines: [
                    "你要锁定的决策是什么？",
                    "为什么现在就要这样定？",
                    "放弃了哪些替代方案？",
                    "最大的代价或限制是什么？",
                    "这个决策会影响哪些模块？"
                ]
            },
            "decisions.integration_contracts": {
                intro: "集成契约需要支撑接口设计和失败处理，必须具体到输入输出边界。",
                lines: [
                    "生产者和消费者分别是谁？",
                    "触发时机是什么？",
                    "核心 payload 字段有哪些？",
                    "同步还是异步？",
                    "失败时怎么重试、降级或回滚？"
                ]
            },
            "decisions.non_functional_requirements": {
                intro: "非功能性需求必须尽量可衡量，至少要说明目标、范围和代价。",
                lines: [
                    "类别是什么？例如性能 / 安全 / 隐私 / 可用性。",
                    "具体要求是什么？尽量带指标或阈值。",
                    "适用范围是什么？",
                    "为什么这条要求重要？",
                    "如果达不到，业务影响是什么？"
                ]
            },
            "guardrails.implementation_order": {
                intro: "实现顺序应该反映真实交付主线，而不是通用模板。",
                lines: [
                    "Phase 1 先做什么？",
                    "为什么它必须先做？",
                    "Phase 2 接着做什么？",
                    "每个阶段的退出条件是什么？"
                ]
            },
            "guardrails.acceptance_criteria": {
                intro: "验收标准必须可测试、可观察、可拒收，不能只是功能复述。",
                lines: [
                    "触发前提是什么？",
                    "用户执行什么动作？",
                    "系统必须返回什么结果？",
                    "什么情况下算失败？",
                    "谁来判定通过？"
                ]
            },
            "guardrails.test_strategy": {
                intro: "测试策略需要覆盖真实风险，不是简单写上 unit / e2e 就算完成。",
                lines: [
                    "最关键的风险场景是什么？",
                    "哪条流程要做端到端测试？",
                    "哪部分逻辑适合单元测试？",
                    "哪些接口或契约需要集成测试？",
                    "上线前必须人工回归什么？"
                ]
            },
            "ui.key_screens": {
                intro: "关键界面需要能支撑用户主流程，而不是为了过门槛凑页面数量。",
                lines: [
                    "界面名称是什么？",
                    "谁会使用这个界面？",
                    "这个界面的主要任务是什么？",
                    "最关键的状态有哪些？",
                    "和上下游界面的关系是什么？"
                ]
            },
            "ui.shared_components": {
                intro: "共享组件必须有复用场景和状态变化说明，不能只列 UI 名词。",
                lines: [
                    "组件名称是什么？",
                    "会被哪些界面复用？",
                    "它解决什么交互问题？",
                    "有哪些关键状态或变体？"
                ]
            },
            "ui.responsive_strategy": {
                intro: "响应式策略必须说明布局和交互怎么变，而不是只写“支持移动端”。",
                lines: [
                    "桌面布局是什么？",
                    "移动端怎么重排？",
                    "哪些操作在小屏上要简化？",
                    "是否有必须保留的关键信息层级？"
                ]
            }
        }
        : {
            "business_context.product_goal": {
                intro: "This cannot be safely filled with a generic default. To reach production quality, we need the business outcome, success signal, and scope boundary.",
                lines: [
                    "Who is the user?",
                    "What is the single painful problem today?",
                    "What exact result should v1 deliver?",
                    "What metric tells you this version worked?",
                    "What is explicitly out of scope?"
                ]
            },
            "business_context.platforms": {
                intro: "Platform strategy must constrain the downstream architecture, so we need the launch platform and required runtime coverage.",
                lines: [
                    "What is the launch platform?",
                    "Which devices or runtimes must be supported?",
                    "Why is this the right platform for v1?",
                    "Are there required distribution or hosting constraints?"
                ]
            },
            "business_context.target_users": {
                intro: "Target users need to be concrete enough to shape product and architecture choices.",
                lines: [
                    "Who is the primary user?",
                    "Who buys, approves, or administers it?",
                    "How do they solve this today?",
                    "What is the expected usage frequency or scale?",
                    "Why would they adopt this version first?"
                ]
            },
            "business_context.user_journeys": {
                intro: "User journeys need enough detail to drive pages, APIs, and acceptance criteria.",
                lines: [
                    "Who starts the flow?",
                    "What triggers it?",
                    "What are the key steps?",
                    "What is the success outcome?",
                    "How does the user recover from failure?"
                ]
            },
            "business_context.constraints_or_risks": {
                intro: "Production-grade discovery needs explicit constraints and failure risks, not just feature intent.",
                lines: [
                    "What are the team, budget, or timeline constraints?",
                    "What compliance, privacy, or security boundaries matter?",
                    "What performance, reliability, or cost limits matter?",
                    "What is the biggest launch risk?",
                    "What is the worst business impact if that risk happens?"
                ]
            },
            "boundaries.bounded_contexts": {
                intro: "Bounded contexts should come from real business boundaries, not generic placeholder labels.",
                lines: [
                    "What is the context name?",
                    "What is its unique responsibility?",
                    "What is explicitly out of scope for it?",
                    "What data or state does it own?",
                    "Which external contexts does it depend on?"
                ]
            },
            "boundaries.module_responsibilities": {
                intro: "Module responsibilities should directly drive implementation slicing.",
                lines: [
                    "What is the module name?",
                    "What is its single responsibility?",
                    "What inputs does it consume?",
                    "What outputs does it produce?",
                    "What responsibilities must stay outside this module?"
                ]
            },
            "boundaries.data_ownership": {
                intro: "Data ownership directly affects privacy, permissions, and lifecycle design, so it should be explicit.",
                lines: [
                    "What data object are we talking about?",
                    "Who owns it?",
                    "Who can read, update, or export it?",
                    "What is the default retention period?",
                    "What audit, deletion, or compliance rules apply?"
                ]
            },
            "decisions.decision_records": {
                intro: "Architecture decisions need rationale and rejected alternatives, otherwise they are not stable enough for production.",
                lines: [
                    "What decision are you locking?",
                    "Why does it need to be made now?",
                    "What alternatives are being rejected?",
                    "What cost or limitation does this choice create?",
                    "Which parts of the system are most affected?"
                ]
            },
            "decisions.integration_contracts": {
                intro: "Integration contracts should be specific enough to shape APIs and failure handling.",
                lines: [
                    "Who produces and consumes it?",
                    "What triggers the exchange?",
                    "What are the core payload fields?",
                    "Is it sync or async?",
                    "What is the retry, fallback, or rollback behavior on failure?"
                ]
            },
            "decisions.non_functional_requirements": {
                intro: "Non-functional requirements should be measurable whenever possible, with scope and business consequence.",
                lines: [
                    "What category is it? Performance, security, privacy, availability, and so on.",
                    "What exact target or threshold matters?",
                    "Where does this requirement apply?",
                    "Why is it important?",
                    "What happens if we miss it?"
                ]
            },
            "guardrails.implementation_order": {
                intro: "Implementation order should reflect the real delivery path, not a generic template.",
                lines: [
                    "What should Phase 1 deliver?",
                    "Why must it come first?",
                    "What should happen next?",
                    "What is the exit criterion for each phase?"
                ]
            },
            "guardrails.acceptance_criteria": {
                intro: "Acceptance criteria must be testable and rejectable, not just feature restatements.",
                lines: [
                    "What is the precondition?",
                    "What action does the user take?",
                    "What must the system return?",
                    "What counts as failure?",
                    "Who decides it passes?"
                ]
            },
            "guardrails.test_strategy": {
                intro: "Test strategy should cover real product risk, not just name test levels.",
                lines: [
                    "What is the highest-risk scenario?",
                    "Which journey needs an end-to-end test?",
                    "Which logic deserves unit tests?",
                    "Which contracts need integration tests?",
                    "What must be manually checked before release?"
                ]
            },
            "ui.key_screens": {
                intro: "Key screens should map to real user journeys, not invented pages to satisfy a checklist.",
                lines: [
                    "What is the screen name?",
                    "Who uses it?",
                    "What is the primary task on it?",
                    "What states matter most?",
                    "How does it connect to previous and next screens?"
                ]
            },
            "ui.shared_components": {
                intro: "Shared UI components should include reuse context and state variations, not only names.",
                lines: [
                    "What is the component name?",
                    "Which screens reuse it?",
                    "What interaction problem does it solve?",
                    "What key states or variants does it have?"
                ]
            },
            "ui.responsive_strategy": {
                intro: "Responsive strategy should explain how layout and interaction change across breakpoints.",
                lines: [
                    "What is the desktop layout?",
                    "How does it reflow on mobile?",
                    "Which actions need simplification on small screens?",
                    "What information hierarchy must remain visible?"
                ]
            }
        };

    const template = templates[requirementKey];
    const questionText = language === "zh"
        ? `请补充${label}的生产级细节。`
        : `Please provide production-grade detail for ${label}.`;

    return {
        content: [
            template.intro,
            knownGoal
                ? (language === "zh" ? `当前已知产品目标：${knownGoal}` : `Current product goal: ${knownGoal}`)
                : "",
            "",
            language === "zh" ? "请尽量按下面结构回复：" : "Please reply roughly in this structure:",
            ...template.lines.map((line, index) => `${index + 1}. ${line}`)
        ].filter(Boolean).join("\n"),
        options: language === "zh"
            ? [
                { label: "我按模板回答", value: `我来按这个模板补充${label}。` },
                { label: "给我高质量示例", value: `先给我一个高质量的${label}示例，再告诉我如何改成适合我的版本。` },
                { label: "继续追问最关键问题", value: `请继续只问我一个最关键的问题，帮助我补齐${label}。`, action: "focus_requirement" as const, requirementKey }
            ]
            : [
                { label: "I will answer using the template", value: `I will fill ${label} using that structure.` },
                { label: "Show a high-quality example", value: `Show me a high-quality example for ${label}, then tell me how to adapt it to my case.` },
                { label: "Ask the single highest-impact question", value: `Please ask me the single highest-impact question to complete ${label}.`, action: "focus_requirement" as const, requirementKey }
            ],
        questionKey: normalizeQuestionKey(questionText),
        questionAction: "focus_requirement" as const,
        questionRequirementKey: requirementKey
    };
}

function shouldAllowDeterministicRequirementResolution(
    requirementKey: ReadinessRequirementKey,
    architecturePack: ArchitecturePack,
    messages: Message[]
) {
    if (requirementKey === "business_context.platforms") return true;
    if (
        requirementKey === "ui.key_screens" &&
        isSingleScreenScopeCandidate(architecturePack, messages)
    ) {
        return true;
    }
    return false;
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
- 我建议先把“谁拥有数据、谁可以消费、保留多久、删除如何触发”说清楚，再继续往下走。

需要确认：
要不要我先给你一个高质量的数据归属补充模板？`
            : `Current view:
- We still need one explicit data ownership rule so the privacy and retention boundary stays clear.
- I recommend clarifying who owns the data, who can consume it, how long it is retained, and what triggers deletion before we move on.

Please confirm:
Should I give you a high-quality data-ownership template now?`;

        const questionText = language === "zh"
            ? "要不要我先给你一个高质量的数据归属补充模板？"
            : "Should I give you a high-quality data-ownership template now?";

        return {
            content,
            options: language === "zh"
                ? [
                    { label: "给我补充模板", value: "请给我一个高质量的数据归属补充模板。", action: "fill_requirement" as const, requirementKey },
                    { label: "我来指定规则", value: "我来指定自定义的数据归属与保留期。" },
                    { label: "列出当前阻塞项", value: "请列出当前阻塞项。", action: "show_blockers" as const, requirementKey }
                ]
                : [
                    { label: "Give me a template", value: "Give me a high-quality data-ownership template.", action: "fill_requirement" as const, requirementKey },
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
                    { label: "给我补充模板", value: "请给我一个高质量的目标用户补充模板。", action: "fill_requirement" as const, requirementKey },
                    { label: "我来自己定义", value: "我来手动描述目标用户。" },
                    { label: "给我示例", value: "先给我 2 个具体的目标用户示例。" }
                ]
                : [
                    { label: "Give me a template", value: "Give me a high-quality target-user template.", action: "fill_requirement" as const, requirementKey },
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
                    { label: "给我补充模板", value: "请给我一个高质量的用户旅程补充模板。", action: "fill_requirement" as const, requirementKey },
                    { label: "我来自己描述", value: "我来手动描述两条关键用户旅程。" },
                    { label: "给我示例", value: "先给我两条参考用户旅程。" }
                ]
                : [
                    { label: "Give me a template", value: "Give me a high-quality user-journey template.", action: "fill_requirement" as const, requirementKey },
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
                    { label: "给我补充模板", value: "请给我一个高质量的约束与风险补充模板。", action: "fill_requirement" as const, requirementKey },
                    { label: "我来自己定义", value: "我来手动描述约束与风险。" },
                    { label: "给我示例", value: "先给我两个常见约束与风险示例。" }
                ]
                : [
                    { label: "Give me a template", value: "Give me a high-quality constraints-and-risks template.", action: "fill_requirement" as const, requirementKey },
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
                    { label: "给我补充模板", value: "请给我一个高质量的限界上下文补充模板。", action: "fill_requirement" as const, requirementKey },
                    { label: "我来自己拆分", value: "我来手动定义限界上下文。" },
                    { label: "给我示例", value: "先给我 2 到 3 个常见的限界上下文示例。" }
                ]
                : [
                    { label: "Give me a template", value: "Give me a high-quality bounded-context template.", action: "fill_requirement" as const, requirementKey },
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
                    { label: "给我补充模板", value: "请给我一个高质量的模块职责补充模板。", action: "fill_requirement" as const, requirementKey },
                    { label: "我来自己定义", value: "我来手动描述模块职责。" },
                    { label: "给我示例", value: "先给我两个参考模块职责。" }
                ]
                : [
                    { label: "Give me a template", value: "Give me a high-quality module-responsibility template.", action: "fill_requirement" as const, requirementKey },
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
            ? "这一步需要锁定关键架构决策。要不要我先给你一个高质量补充模板？"
            : "We need to lock a key architecture decision at this stage. Should I give you a high-quality template first?";
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
                    { label: "给我补充模板", value: "请给我一个高质量的架构决策补充模板。", action: "fill_requirement" as const, requirementKey },
                    { label: "我来自己定义", value: "我来手动描述这条架构决策。" },
                    { label: "给我 2 个方向", value: "先给我两条常见的第二架构决策方向。" }
                ]
                : [
                    { label: "Give me a template", value: "Give me a high-quality architecture-decision template.", action: "fill_requirement" as const, requirementKey },
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
            ? "要不要我先给你一版高质量的关键输入输出契约模板？"
            : "Should I give you a high-quality key input-output contract template now?";
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
                    { label: "给我补充模板", value: "请给我一个高质量的集成契约补充模板。", action: "fill_requirement" as const, requirementKey },
                    { label: "我来自己定义", value: "我来手动描述关键集成契约。" },
                    { label: "给我示例", value: "先给我一个参考契约示例。" }
                ]
                : [
                    { label: "Give me a template", value: "Give me a high-quality integration-contract template.", action: "fill_requirement" as const, requirementKey },
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

要不要我先给你一版高质量的非功能性需求模板？`
            : `Let's finish the non-functional requirements so the v1 quality bar is explicit.
I recommend prioritizing response speed and output stability or confidence because they directly shape the user experience.

Should I give you a high-quality non-functional requirement template now?`;

        const questionText = language === "zh"
            ? "要不要我先给你一版高质量的非功能性需求模板？"
            : "Should I give you a high-quality non-functional requirement template now?";

        return {
            content,
            options: language === "zh"
                ? [
                    { label: "给我补充模板", value: "请给我一个高质量的非功能性需求补充模板。", action: "fill_requirement" as const, requirementKey },
                    { label: "我来指定其他需求", value: "我来指定另一个非功能性需求。" },
                    { label: "列出当前阻塞项", value: "请列出当前阻塞项。", action: "show_blockers" as const, requirementKey }
                ]
                : [
                    { label: "Give me a template", value: "Give me a high-quality non-functional requirement template.", action: "fill_requirement" as const, requirementKey },
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
            ? "要不要我先给你一版高质量的实施顺序模板？"
            : "Should I give you a high-quality implementation-order template now?";
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
                    { label: "给我补充模板", value: "请给我一个高质量的实施顺序补充模板。", action: "fill_requirement" as const, requirementKey },
                    { label: "我来自己定义", value: "我来手动定义实施顺序。" },
                    { label: "给我示例", value: "先给我一个参考实施顺序。" }
                ]
                : [
                    { label: "Give me a template", value: "Give me a high-quality implementation-order template.", action: "fill_requirement" as const, requirementKey },
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
            ? "要不要我先给你一版高质量的验收标准模板？"
            : "Should I give you a high-quality acceptance-criteria template now?";
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
                    { label: "给我补充模板", value: "请给我一个高质量的验收标准补充模板。", action: "fill_requirement" as const, requirementKey },
                    { label: "我来自己定义", value: "我来手动定义验收标准。" },
                    { label: "给我示例", value: "先给我 4 条参考验收标准。" }
                ]
                : [
                    { label: "Give me a template", value: "Give me a high-quality acceptance-criteria template.", action: "fill_requirement" as const, requirementKey },
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
            ? "要不要我先给你一版高质量的测试策略模板？"
            : "Should I give you a high-quality test-strategy template now?";
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
                    { label: "给我补充模板", value: "请给我一个高质量的测试策略补充模板。", action: "fill_requirement" as const, requirementKey },
                    { label: "我来自己定义", value: "我来手动定义测试策略。" },
                    { label: "给我示例", value: "先给我两条参考测试策略。" }
                ]
                : [
                    { label: "Give me a template", value: "Give me a high-quality test-strategy template.", action: "fill_requirement" as const, requirementKey },
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
                { label: "给我补充模板", value: "请给我一个高质量补充模板，我来补齐这个缺口。", action: "fill_requirement" as const, requirementKey },
                { label: "列出当前阻塞项", value: "请列出所有当前阻塞项。", action: "show_blockers" as const, requirementKey },
                { label: "我来手动补充", value: `我来手动补充${label}。` }
            ]
            : [
                { label: "Give me a template", value: "Give me a high-quality template so I can fill this gap.", action: "fill_requirement" as const, requirementKey },
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

type PrdStatusCardTone = "sky" | "emerald" | "amber" | "slate";

type PrdStatusCardItem = {
    label: string;
    value: string;
    detail: string;
    tone: PrdStatusCardTone;
};

type PrdPendingQuestionItem = {
    requirementKey: ReadinessRequirementKey;
    label: string;
    detail: string;
    progressLabel: string;
    status: ReadinessRequirementStatus;
};

type PrdChangeLogItem = {
    title: string;
    detail: string;
    tone: PrdStatusCardTone;
    sourceMessageId?: string;
};

type PrdProjectionModel = {
    currentStatus: PrdStatusCardItem[];
    confirmedScope: string[];
    pendingQuestions: PrdPendingQuestionItem[];
    implementationReadiness: PrdStatusCardItem[];
    changeLog: PrdChangeLogItem[];
};

function getPrdLayoutUiText(language: "zh" | "en") {
    return language === "zh"
        ? {
            pageDesc: "需求进度只展示用户可追踪的范围、进度、待确认事项与实施准备，不直接暴露内部架构原始数据。",
            confirmedScopeTitle: "已确认范围",
            confirmedScopeDesc: "这里只保留已经稳定下来的产品范围与目标，不展示内部架构原文。",
            noConfirmedScope: "还没有足够的已确认范围，请继续补充产品目标、用户和核心流程。",
            pendingQuestionsTitle: "待确认事项",
            pendingQuestionsDesc: "优先处理最影响架构质量的缺口；你可以继续追问，或直接索取高质量补充模板。",
            noPendingQuestions: "当前没有待确认事项，可以继续完善需求摘要或开始生成。",
            implementationReadinessTitle: "实施准备",
            implementationReadinessDesc: "只展示生成门槛、验收与测试准备摘要，不直接展开内部 guardrails 明细。",
            changeLogTitle: "变更记录",
            changeLogDesc: "这里记录本轮需求进度的高层更新，不展示完整聊天原文。",
            noChangeLog: "还没有新的需求进度更新记录。",
            jumpToChatAction: "查看聊天",
            followUpAction: "继续追问",
            fillAction: "给我模板"
        }
        : {
            pageDesc: "The requirements view shows user-facing scope, progress, open decisions, and implementation readiness without exposing the raw internal architecture data.",
            confirmedScopeTitle: "Confirmed Scope",
            confirmedScopeDesc: "This keeps only the stable product scope and intent, not the raw internal architecture content.",
            noConfirmedScope: "There is not enough confirmed scope yet. Continue clarifying the product goal, users, and key journeys.",
            pendingQuestionsTitle: "Pending Decisions",
            pendingQuestionsDesc: "Focus on the gaps with the highest architecture impact. You can continue the discussion or ask for a structured fill-in template.",
            noPendingQuestions: "There are no pending decisions right now. You can keep polishing the requirements summary or start generation.",
            implementationReadinessTitle: "Implementation Readiness",
            implementationReadinessDesc: "This section shows only the generation gate, acceptance summary, and test readiness instead of the raw internal guardrails.",
            changeLogTitle: "Change Log",
            changeLogDesc: "This records the high-level requirements updates from recent turns without replaying the full chat transcript.",
            noChangeLog: "No new requirements updates yet.",
            jumpToChatAction: "View in chat",
            followUpAction: "Continue in chat",
            fillAction: "Get template"
        };
}

function getPrdStatusCardClassName(tone: PrdStatusCardTone) {
    switch (tone) {
        case "emerald":
            return "rounded-2xl border border-emerald-100 bg-emerald-50/80 px-3 py-3 dark:border-emerald-800/40 dark:bg-emerald-900/15";
        case "amber":
            return "rounded-2xl border border-amber-100 bg-amber-50/80 px-3 py-3 dark:border-amber-800/40 dark:bg-amber-900/15";
        case "sky":
            return "rounded-2xl border border-sky-100 bg-sky-50/80 px-3 py-3 dark:border-sky-800/40 dark:bg-sky-900/15";
        default:
            return "rounded-2xl border border-[color:var(--border)] bg-slate-50/80 px-3 py-3 dark:bg-slate-800/40";
    }
}

function getPrdTaskStatusMeta(
    language: "zh" | "en",
    status: ReadinessRequirementStatus
) {
    switch (status) {
        case "confirmed":
            return {
                label: language === "zh" ? "已完成" : "Done",
                className: "border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-700/40 dark:bg-emerald-900/20 dark:text-emerald-300"
            };
        case "waived":
            return {
                label: language === "zh" ? "已豁免" : "Waived",
                className: "border border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-700/40 dark:bg-sky-900/20 dark:text-sky-300"
            };
        case "partial":
            return {
                label: language === "zh" ? "进行中" : "In progress",
                className: "border border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-300"
            };
        default:
            return {
                label: language === "zh" ? "待补齐" : "Missing",
                className: "border border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700/40 dark:bg-slate-900/40 dark:text-slate-300"
            };
    }
}

function buildPrdStageTaskProgressLabel(
    language: "zh" | "en",
    requirement: ReadinessRequirement
) {
    if (requirement.status === "waived") {
        return language === "zh" ? "已豁免" : "Waived";
    }

    const satisfiedCount = Math.min(requirement.satisfiedCount, requirement.requiredCount);
    return language === "zh"
        ? `${satisfiedCount}/${requirement.requiredCount} 完成`
        : `${satisfiedCount}/${requirement.requiredCount} done`;
}

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
    readiness: ReadinessChecklist
) {
    const readinessText = `${Math.round(readiness.score)}%`;
    const nextMilestone = clipText(
        readiness.nextMilestone || "",
        96
    );
    return language === "zh"
        ? `当前就绪度 ${readinessText}${nextMilestone ? ` | 下一步：${nextMilestone}` : ""}`
        : `Readiness ${readinessText}${nextMilestone ? ` | Next: ${nextMilestone}` : ""}`;
}

function buildPrdChangeLog(
    language: "zh" | "en",
    prdDeltas: PrdDelta[]
): PrdChangeLogItem[] {
    return [...prdDeltas]
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 6)
        .map((item) => {
            const targetLabel = item.requirementKey
                ? getReadinessRequirementLabel(item.requirementKey, language)
                : clipText(item.questionKey || (language === "zh" ? "当前问题" : "Current question"), 72);

            if (item.action === "fill_requirement") {
                return {
                    title: language === "zh"
                        ? `已更新：${targetLabel}`
                        : `Updated: ${targetLabel}`,
                    detail: language === "zh"
                        ? "已根据当前上下文更新这项内容，并重新计算需求就绪度。"
                        : "This requirement was updated from the current context and the readiness score was recalculated.",
                    tone: "emerald" as const,
                    sourceMessageId: item.sourceMessageId ?? undefined
                };
            }

            if (item.action === "focus_requirement") {
                return {
                    title: language === "zh"
                        ? `已切换焦点：${targetLabel}`
                        : `Focused next: ${targetLabel}`,
                    detail: language === "zh"
                        ? "聊天已重新聚焦到这一项，接下来会继续追问最关键的信息。"
                        : "The chat has been redirected to this item and will keep asking for the highest-impact missing detail.",
                    tone: "sky" as const,
                    sourceMessageId: item.sourceMessageId ?? undefined
                };
            }

            if (item.action === "show_blockers") {
                return {
                    title: language === "zh"
                        ? `已整理阻塞项：${targetLabel}`
                        : `Reviewed blockers: ${targetLabel}`,
                    detail: language === "zh"
                        ? "这项缺口和替代路径已经整理出来，方便继续判断下一步。"
                        : "The blocker and its alternative paths were organized so the next step stays clear.",
                    tone: "amber" as const,
                    sourceMessageId: item.sourceMessageId ?? undefined
                };
            }

            if (item.action === "confirmed") {
                return {
                    title: language === "zh"
                        ? `已确认：${targetLabel}`
                        : `Confirmed: ${targetLabel}`,
                    detail: language === "zh"
                        ? "新的确认内容已经同步进需求进度和进度摘要。"
                        : "The newly confirmed information has been synced into the requirements view and progress tracking.",
                    tone: "sky" as const,
                    sourceMessageId: item.sourceMessageId ?? undefined
                };
            }

            return {
                title: language === "zh"
                    ? `已整理：${targetLabel}`
                    : `Updated: ${targetLabel}`,
                detail: language === "zh"
                    ? "这条变更已经写入需求进度记录。"
                    : "This update has been written into the requirements record.",
                tone: "slate" as const,
                sourceMessageId: item.sourceMessageId ?? undefined
            };
        });
}

function buildPrdProjectionModel(
    language: "zh" | "en",
    architecturePack: ArchitecturePack,
    guardrailChecklist: GuardrailChecklist,
    readiness: ReadinessChecklist,
    prdDeltas: PrdDelta[],
    canGenerate: boolean
): PrdProjectionModel {
    const confirmedScope: string[] = [];
    const pendingQuestions: PrdPendingQuestionItem[] = [];
    const changeLog = buildPrdChangeLog(language, prdDeltas);
    const platformSummary = buildPlatformSummaryLine(architecturePack.platformStrategy);
    const targetUsers = joinPrdItems(language, architecturePack.businessContext.targetUsers, 4);
    const userJourneys = joinPrdItems(language, architecturePack.businessContext.userJourneys, 4);
    const constraints = joinPrdItems(language, architecturePack.businessContext.constraints, 3);
    const risks = joinPrdItems(language, architecturePack.businessContext.risks, 3);
    const keyScreens = joinPrdItems(language, architecturePack.experienceConstraints.keyScreens, 3);
    const primaryBlocker = canGenerate
        ? (
            language === "zh"
                ? "当前没有阻塞项，可以开始生成或继续微调。"
                : "There are no current blockers. You can generate now or keep polishing."
        )
        : translateReadinessText(
            language,
            readiness.blockingIssues[0] || (
                language === "zh"
                    ? "还需要继续补齐当前最关键的缺口。"
                    : "There is still a key gap to close."
            )
        );
    const latestUpdate = changeLog[0] ?? {
        title: language === "zh" ? "等待新的确认内容" : "Waiting for the next confirmed update",
        detail: language === "zh"
            ? "新的确认会在聊天里完成后自动同步到这里。"
            : "New confirmations will be synced here automatically after they are resolved in chat.",
        tone: "slate" as const
    };

    appendUniquePrdLine(
        confirmedScope,
        architecturePack.businessContext.productGoal.trim()
            ? language === "zh"
                ? `产品目标：${architecturePack.businessContext.productGoal.trim()}`
                : `Product goal: ${architecturePack.businessContext.productGoal.trim()}`
            : null
    );
    appendUniquePrdLine(confirmedScope, platformSummary, 180);
    appendUniquePrdLine(
        confirmedScope,
        targetUsers
            ? language === "zh"
                ? `目标用户：${targetUsers}`
                : `Target users: ${targetUsers}`
            : null
    );
    appendUniquePrdLine(
        confirmedScope,
        userJourneys
            ? language === "zh"
                ? `关键流程：${userJourneys}`
                : `Key journeys: ${userJourneys}`
            : null
    );
    appendUniquePrdLine(
        confirmedScope,
        constraints
            ? language === "zh"
                ? `关键约束：${constraints}`
                : `Key constraints: ${constraints}`
            : null
    );
    appendUniquePrdLine(
        confirmedScope,
        risks
            ? language === "zh"
                ? `主要风险：${risks}`
                : `Primary risks: ${risks}`
            : null
    );
    appendUniquePrdLine(
        confirmedScope,
        keyScreens
            ? language === "zh"
                ? `关键界面：${keyScreens}`
                : `Key screens: ${keyScreens}`
            : null
    );

    const incompleteRequirements = readiness.criteria.flatMap((criterion) =>
        criterion.requirements.filter((requirement) => requirement.status === "missing" || requirement.status === "partial")
    );
    for (const requirement of incompleteRequirements.slice(0, 3)) {
        pendingQuestions.push({
            requirementKey: requirement.key,
            label: getReadinessRequirementLabel(requirement.key, language),
            detail: translateReadinessText(
                language,
                requirement.missing[0] || (
                    language === "zh"
                        ? `请继续补齐${getReadinessRequirementLabel(requirement.key, language)}。`
                        : `Please clarify ${getReadinessRequirementLabel(requirement.key, language)}.`
                )
            ),
            progressLabel: buildPrdStageTaskProgressLabel(language, requirement),
            status: requirement.status
        });
    }

    const currentFocus = clipText(
        translateReadinessText(
            language,
            readiness.nextMilestone || pendingQuestions[0]?.detail || (
                canGenerate
                    ? (
                        language === "zh"
                            ? "可以开始生成，或者继续打磨已确认范围。"
                            : "You can start generation now or keep polishing the confirmed scope."
                    )
                    : (
                        language === "zh"
                            ? "优先补齐当前最影响生成质量的缺口。"
                            : "Focus on the highest-impact gap before generation."
                    )
            )
        ),
        120
    );
    const acceptanceRequirement = findReadinessRequirement(readiness, "guardrails.acceptance_criteria");
    const testStrategyRequirement = findReadinessRequirement(readiness, "guardrails.test_strategy");
        const buildGuardrailRequirementCard = (
        requirement: ReturnType<typeof findReadinessRequirement>,
        label: { zh: string; en: string },
        fallbackDetail: { zh: string; en: string }
    ): PrdStatusCardItem => {
        const status = requirement?.status ?? "missing";
        const progress = requirement ? buildPrdStageTaskProgressLabel(language, requirement) : (language === "zh" ? "待补齐" : "Missing");
        const detail = requirement?.status === "confirmed" || requirement?.status === "waived"
            ? fallbackDetail[language]
            : translateReadinessText(
                language,
                requirement?.missing[0] || fallbackDetail[language]
            );
        return {
            label: label[language],
            value: progress,
            detail,
            tone: status === "confirmed" || status === "waived"
                ? "emerald"
                : status === "partial"
                    ? "amber"
                    : "slate"
        };
    };

    const implementationReadiness: PrdStatusCardItem[] = [
        {
            label: language === "zh" ? "生成状态" : "Generation gate",
            value: canGenerate
                ? (language === "zh" ? "可以开始生成" : "Ready to generate")
                : (language === "zh" ? "仍需补齐" : "Not ready yet"),
            detail: primaryBlocker,
            tone: canGenerate ? "emerald" : "amber"
        },
        {
            label: language === "zh" ? "功能准备" : "Functional readiness",
            value: readiness.functionalReady
                ? (language === "zh" ? "已满足" : "Ready")
                : (language === "zh" ? "待补齐" : "Missing"),
            detail: readiness.functionalReady
                ? (
                    language === "zh"
                        ? "业务范围、边界和关键决策已经达到当前生成门槛。"
                        : "The business scope, boundaries, and key decisions have reached the current generation bar."
                )
                : (
                    language === "zh"
                        ? "功能范围、边界或关键决策里仍有缺口。"
                        : "There is still a gap in the functional scope, boundaries, or key decisions."
                ),
            tone: readiness.functionalReady ? "emerald" : "amber"
        },
        buildGuardrailRequirementCard(
            acceptanceRequirement,
            { zh: "验收准备", en: "Acceptance readiness" },
            {
                zh: guardrailChecklist.acceptanceCriteria[0]
                    ? clipText(guardrailChecklist.acceptanceCriteria[0], 120)
                    : "还没有可展示的验收标准摘要。",
                en: guardrailChecklist.acceptanceCriteria[0]
                    ? clipText(guardrailChecklist.acceptanceCriteria[0], 120)
                    : "There is no acceptance summary yet."
            }
        ),
        buildGuardrailRequirementCard(
            testStrategyRequirement,
            { zh: "测试准备", en: "Test readiness" },
            {
                zh: guardrailChecklist.testStrategy[0]
                    ? clipText(guardrailChecklist.testStrategy[0], 120)
                    : "还没有可展示的测试策略摘要。",
                en: guardrailChecklist.testStrategy[0]
                    ? clipText(guardrailChecklist.testStrategy[0], 120)
                    : "There is no test-strategy summary yet."
            }
        )
    ];

    const currentStatus: PrdStatusCardItem[] = [
        {
            label: language === "zh" ? "总体进度" : "Overall progress",
            value: buildPrdProgressLine(language, readiness),
            detail: canGenerate
                ? (
                    language === "zh"
                        ? "当前范围已经满足生成门槛，可以进入代码脚手架阶段。"
                        : "The current scope meets the generation gate and can move into scaffold generation."
                )
                : (
                    language === "zh"
                        ? "继续补齐高影响缺口，进度会随确认内容实时更新。"
                        : "Keep closing the highest-impact gaps and the progress summary will update with each confirmation."
                ),
            tone: "sky"
        },
        {
            label: language === "zh" ? "当前焦点" : "Current focus",
            value: currentFocus,
            detail: pendingQuestions[0]
                ? pendingQuestions[0].label
                : (
                    language === "zh"
                        ? "当前没有待确认事项，可以继续完善需求摘要或开始生成。"
                        : "There are no pending decisions right now. You can keep polishing the requirements summary or start generation."
                ),
            tone: canGenerate ? "emerald" : "amber"
        },
        {
            label: language === "zh" ? "当前阻塞" : "Primary blocker",
            value: primaryBlocker,
            detail: readiness.nextMilestone
                ? (
                    language === "zh"
                        ? `下一步：${clipText(readiness.nextMilestone, 120)}`
                        : `Next: ${clipText(readiness.nextMilestone, 120)}`
                )
                : (
                    language === "zh"
                        ? "继续处理当前最关键的缺口。"
                        : "Continue with the highest-impact remaining gap."
                ),
            tone: canGenerate ? "emerald" : "amber"
        },
        {
            label: language === "zh" ? "最近更新" : "Latest update",
            value: latestUpdate.title,
            detail: latestUpdate.detail,
            tone: latestUpdate.tone
        }
    ];

    return {
        currentStatus,
        confirmedScope: confirmedScope.slice(0, 7),
        pendingQuestions,
        implementationReadiness,
        changeLog
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
- 当前阶段仍是 ${stageLabel}，就绪度 ${Math.round(readiness.score)}%。主要阻塞项：${primaryBlocker}

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
                        : "给我补充模板",
                    value: primaryRequirement?.key === "ui.key_screens" && isSingleScreenScopeCandidate(architecturePack, messages)
                        ? "按你推荐的方式应用单屏例外。"
                        : "请给我一个高质量补充模板，我来补齐当前这个缺口。",
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
                        : "Give me a template",
                    value: primaryRequirement?.key === "ui.key_screens" && isSingleScreenScopeCandidate(architecturePack, messages)
                        ? "Apply the single-screen exception using your recommendation."
                        : "Give me a production-grade template so I can close this gap properly.",
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
    const questionText = extractStructuredBlock(raw, "question");
    if (!questionText) return "";
    return buildAssistantFinalContent(questionText);
}

function extractFallbackAssistantText(
    raw: string
) {
    const normalized = normalizeStructuredResponseMarkup(raw).trim();
    if (!normalized) return "";

    const questionBlock = extractStructuredBlock(normalized, "question");
    if (questionBlock) {
        const questionText = buildAssistantFinalContent(questionBlock);
        if (questionText) return questionText;
    }

    const plainText = stripStructuredResponseBlocks(normalized)
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

function parseOptionLine(rawLine: string): MessageOption | null {
    const line = stripWrappingQuotes(rawLine.replace(/^[-*]\s*/, "").trim());
    if (!line) return null;

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

    const option: MessageOption = {
        label: label || value,
        value
    };

    if (trailingAction) {
        option.action = trailingAction;
    }

    return option;
}

function parseOptionsBlock(raw: string): MessageOption[] {
    const normalized = normalizeOptionsBlockText(raw);
    if (!normalized) return [];

    const parsed = normalized
        .split("\n")
        .map((line) => parseOptionLine(line))
        .filter((item): item is MessageOption => item !== null);

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
                ...option,
                label: shouldPromoteValueToLabel ? value : label,
                value
            };
        })
        .filter((option) => {
            if (!option.label) return false;
            const key = `${option.label.toLowerCase()}::${option.value.toLowerCase()}::${option.action || ""}`;
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
    const normalized = normalizeStructuredResponseMarkup(raw);
    const match = normalized.match(
        /<options>([\s\S]*?)(<\/options>|(?=\s*<(?!\/?options\b)[a-z_][\w-]*\s*>)|$)/i
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
        "# Derived Architecture Diagram Preview",
        "This Mermaid view is derived locally from architecture pack, decision records, and guardrails.",
        "Treat the structured architecture state as source of truth; the diagram is only a derived preview.",
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
        "- Update Mode: Diagram cache is derived locally from structured architecture state."
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
    prdDeltas: PrdDelta[],
    sourceArtifacts: SourceArtifact[],
    architectureStage: ArchitectureStage,
    functionalLockedAt: number | null,
    uiReadyAt: number | null
): Project | null {
    if (!project || !currentVersion) return null;

    const compactMessages: Message[] = messages.map((message) => ({
        id: message.id,
        createdAt: message.createdAt,
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
            prdDeltas,
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
    const initialWorkspaceLanguage = getProjectWorkspaceLanguage(cachedSnapshot?.project ?? null);
    const initialNormalizedState = normalizeVersionDesignState(cachedSnapshot?.data ?? null, initialWorkspaceLanguage);
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
    const [prdDeltas, setPrdDeltas] = useState<PrdDelta[]>(initialNormalizedState.prdDeltas);
    const prdDeltasRef = useRef<PrdDelta[]>(initialNormalizedState.prdDeltas);

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
    const [syncConflictMessage, setSyncConflictMessage] = useState<string | null>(null);
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

    const [currentDiagram, setCurrentDiagram] = useState(initialNormalizedState.currentDiagram);
    const [diagramGovernance, setDiagramGovernance] = useState<DiagramGovernance>(
        normalizeDiagramGovernance(cachedSnapshot?.data.diagramGovernance)
    );

    const [activeTab, setActiveTab] = useState<StudioTab>(
        getPreferredGeneratedTab(initialGenerationArtifacts)
    );
    const [shouldMountArchitectureViewer, setShouldMountArchitectureViewer] = useState(false);
    const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const pendingScrollMessageIdRef = useRef<string | null>(null);
    const highlightResetTimerRef = useRef<number | null>(null);
    const messageElementRefs = useRef<Record<string, HTMLDivElement | null>>({});
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
    const workingArchitectureState = resolveWorkingArchitectureState(
        evaluation,
        architecturePack,
        decisionRecords,
        guardrailChecklist,
        readinessOverrides,
        messages
    );
    const hasWorkingDiagramSource = hasStructuredArchitectureDiagramSource(
        workingArchitectureState.architecturePack,
        workingArchitectureState.decisionRecords,
        workingArchitectureState.guardrailChecklist
    );
    const workingDiagramModel = buildArchitectureDiagramModel(
        workingArchitectureState.architecturePack,
        workingArchitectureState.decisionRecords,
        workingArchitectureState.guardrailChecklist,
        workspaceLanguage
    );
    const workingDerivedDiagram = deriveArchitectureDiagramMermaid({
        architecturePack: workingArchitectureState.architecturePack,
        decisionRecords: workingArchitectureState.decisionRecords,
        guardrailChecklist: workingArchitectureState.guardrailChecklist,
        language: workspaceLanguage,
        fallbackDiagram: currentDiagram
    });
    const committedDerivedDiagram = deriveArchitectureDiagramMermaid({
        architecturePack,
        decisionRecords,
        guardrailChecklist,
        language: workspaceLanguage,
        fallbackDiagram: currentDiagram
    });
    const workingScaffoldEligibility = computeScaffoldEligibility({
        architecturePack: workingArchitectureState.architecturePack,
        decisionRecords: workingArchitectureState.decisionRecords,
        guardrailChecklist: workingArchitectureState.guardrailChecklist,
        readinessOverrides
    });
    const activeScaffoldEligibility = workingScaffoldEligibility;
    const activeArchitectureStage = workingArchitectureState.stage;
    const activeDesignStage = activeScaffoldEligibility.designStage;
    const generationReady = activeScaffoldEligibility.canGenerate;
    const architectureCompletion = activeScaffoldEligibility.readiness.score;
    const readinessBlockers = activeScaffoldEligibility.blockingReasons;
    const isReadyToGenerateStage = activeScaffoldEligibility.canGenerate;
    const architectureViewerCode = workingDerivedDiagram;
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
        const result = await syncWorkspaceProjectsRemote(projects, {
            changeSummary: "Wizard workspace autosave"
        });
        if (!result.ok) {
            setSyncConflictMessage(result.message);
            if (!result.conflict) {
                console.error("Failed to sync workspace", result.message);
            }
            return;
        }

        setSyncConflictMessage(null);
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
                currentDiagram: overrides.currentDiagram ?? committedDerivedDiagram,
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
                prdDeltas: overrides.prdDeltas ?? prdDeltasRef.current,
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

    const commitArchitectureStageSnapshot = (
        snapshot: WorkingArchitectureState,
        nextReadinessOverrides: ReadinessOverride[] = readinessOverrides
    ) => {
        const nextEligibility = computeScaffoldEligibility({
            architecturePack: snapshot.architecturePack,
            decisionRecords: snapshot.decisionRecords,
            guardrailChecklist: snapshot.guardrailChecklist,
            readinessOverrides: nextReadinessOverrides
        });
        const nextStage = normalizeArchitectureStage(
            snapshot.stage,
            snapshot.architecturePack,
            snapshot.decisionRecords,
            snapshot.guardrailChecklist,
            nextReadinessOverrides
        );
        setHasUserEdited(true);
        setArchitecturePack(snapshot.architecturePack);
        setDecisionRecords(snapshot.decisionRecords);
        setGuardrailChecklist(snapshot.guardrailChecklist);
        setArchitectureReadiness(nextEligibility.readiness);
        setArchitectureStage(nextStage);
        setDesignStage(nextEligibility.designStage);
        return true;
    };

    const commitActiveEligibilitySnapshot = (
        snapshot: WorkingArchitectureState,
        nextMessages: Message[] = messages,
        nextReadinessOverrides: ReadinessOverride[] = readinessOverrides
    ) => {
        const nextEligibility = computeScaffoldEligibility({
            architecturePack: snapshot.architecturePack,
            decisionRecords: snapshot.decisionRecords,
            guardrailChecklist: snapshot.guardrailChecklist,
            readinessOverrides: nextReadinessOverrides
        });
        const nextStage = normalizeArchitectureStage(
            snapshot.stage,
            snapshot.architecturePack,
            snapshot.decisionRecords,
            snapshot.guardrailChecklist,
            nextReadinessOverrides
        );
        const nextDiagram = deriveArchitectureDiagramMermaid({
            architecturePack: snapshot.architecturePack,
            decisionRecords: snapshot.decisionRecords,
            guardrailChecklist: snapshot.guardrailChecklist,
            language: workspaceLanguage,
            fallbackDiagram: currentDiagram
        });
        const nextDiagramGovernance: DiagramGovernance = {
            ...diagramGovernance,
            pendingDiagram: null,
            pendingSourceRequestId: null,
            pendingUpdatedAt: null,
            lastDecision: "applied",
            lastDecisionNote: "Committed active eligibility snapshot for generation gating.",
            lastDecisionAt: Date.now()
        };

        commitArchitectureStageSnapshot(snapshot, nextReadinessOverrides);
        setCurrentDiagram(nextDiagram);
        setDiagramGovernance(nextDiagramGovernance);
        persistLocalVersionSnapshot({
            messages: nextMessages,
            currentDiagram: nextDiagram,
            diagramGovernance: nextDiagramGovernance,
            architecturePack: snapshot.architecturePack,
            decisionRecords: snapshot.decisionRecords,
            guardrailChecklist: snapshot.guardrailChecklist,
            architectureStage: nextStage,
            designStage: nextEligibility.designStage,
            readinessOverrides: nextReadinessOverrides
        });

        return {
            architecturePack: snapshot.architecturePack,
            decisionRecords: snapshot.decisionRecords,
            guardrailChecklist: snapshot.guardrailChecklist,
            readinessOverrides: nextReadinessOverrides,
            readiness: nextEligibility.readiness,
            stage: nextStage,
            canGenerate: nextEligibility.canGenerate,
            blockingReasons: nextEligibility.blockingReasons,
            designStage: nextEligibility.designStage,
            currentDiagram: nextDiagram,
            messages: nextMessages
        };
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
        prdDeltasRef.current = prdDeltas;
    }, [prdDeltas]);

    useEffect(() => {
        if (!hasMeaningfulDiagramChange(currentDiagram, committedDerivedDiagram)) {
            return;
        }

        setCurrentDiagram(committedDerivedDiagram);
        setDiagramGovernance((prev) => ({
            ...prev,
            pendingDiagram: null,
            pendingSourceRequestId: null,
            pendingUpdatedAt: null,
            lastDecision: "applied",
            lastDecisionNote: "Diagram cache derived locally from structured architecture state.",
            lastDecisionAt: Date.now()
        }));
    }, [committedDerivedDiagram, currentDiagram]);

    useEffect(() => {
        const targetId = pendingScrollMessageIdRef.current;
        if (!targetId || isChatCollapsed) return;

        const element = messageElementRefs.current[targetId];
        if (!element) return;

        element.scrollIntoView({ behavior: "smooth", block: "center" });
        setHighlightedMessageId(targetId);
        pendingScrollMessageIdRef.current = null;

        if (highlightResetTimerRef.current !== null) {
            window.clearTimeout(highlightResetTimerRef.current);
        }
        highlightResetTimerRef.current = window.setTimeout(() => {
            setHighlightedMessageId((current) => current === targetId ? null : current);
            highlightResetTimerRef.current = null;
        }, 1800);
    }, [messages, messageWindow, isChatCollapsed]);

    useEffect(() => {
        return () => {
            isUnmountingRef.current = true;
            if (highlightResetTimerRef.current !== null) {
                window.clearTimeout(highlightResetTimerRef.current);
            }
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
            setSyncConflictMessage(null);

            const selectedVersion = resolveProjectVersionForWizard(foundProject, versionId);
            if (!selectedVersion) return;

            setCurrentVersion(selectedVersion);
            setLoadedVersionId(selectedVersion.id);

            const data = selectedVersion.data;
            const normalizedDesignState = normalizeVersionDesignState(data, getProjectWorkspaceLanguage(foundProject));
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
            setCurrentDiagram(normalizedDesignState.currentDiagram);
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
            setPrdDeltas(normalizedDesignState.prdDeltas);
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

        const normalizedArchitecturePack = normalizeArchitecturePack(architecturePack);
        const packChanged = JSON.stringify(normalizedArchitecturePack) !== JSON.stringify(architecturePack);
        const nextScaffoldEligibility = computeScaffoldEligibility({
            architecturePack: normalizedArchitecturePack,
            decisionRecords,
            guardrailChecklist,
            readinessOverrides
        });
        const nextArchitectureStage = normalizeArchitectureStage(
            architectureStage,
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
                            workingDerivedDiagram,
                            diagramGovernance,
                            tasks,
                            activeDesignStage,
                            uiDesignState,
                            uiDesignSpec,
                            workingArchitectureState.architecturePack,
                            workingArchitectureState.decisionRecords,
                            workingArchitectureState.guardrailChecklist,
                            readinessOverrides,
                            prdDeltas,
                            sourceArtifacts,
                            activeArchitectureStage,
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
        workingDerivedDiagram,
        diagramGovernance,
        tasks,
        activeDesignStage,
        uiDesignState,
        uiDesignSpec,
        workingArchitectureState.architecturePack,
        workingArchitectureState.decisionRecords,
        workingArchitectureState.guardrailChecklist,
        readinessOverrides,
        prdDeltas,
        sourceArtifacts,
        activeArchitectureStage,
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
                currentDiagram: committedDerivedDiagram,
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
                prdDeltas,
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
        committedDerivedDiagram,
        diagramGovernance,
        tasks,
        designStage,
        uiDesignState,
        uiDesignSpec,
        architecturePack,
        decisionRecords,
        guardrailChecklist,
        readinessOverrides,
        prdDeltas,
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
            id: createMessageId(),
            createdAt: Date.now(),
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
                workingDerivedDiagram,
                evaluation,
                diagramGovernance,
                workingArchitectureState.architecturePack,
                workingArchitectureState.decisionRecords,
                workingArchitectureState.guardrailChecklist,
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
            let loggedLegacyDiagram = false;
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
                current_diagram: workingDerivedDiagram,
                analysis: normalizeAnalysis(evaluation?.analysis),
                next_step: { reasoning: "", question: null },
                stage: workingArchitectureState.stage,
                openQuestions: normalizeStringList(evaluation?.openQuestions ?? evaluation?.analysis?.missing, 12),
                architecturePackDraft: workingArchitectureState.architecturePack,
                decisionDrafts: workingArchitectureState.decisionRecords,
                guardrailDrafts: workingArchitectureState.guardrailChecklist,
                readiness: workingArchitectureState.readiness
            };
            let sseBuffer = "";

            const applyEvaluateTraceChunk = (chunk: string) => {
                buffer += chunk;
                const parseBuffer = normalizeStructuredResponseMarkup(buffer);

                const diagramMatch = parseBuffer.match(/<diagram>([\s\S]*?)<\/diagram>/i);
                if (diagramMatch && diagramMatch[1] && !loggedLegacyDiagram) {
                    const rawContent = diagramMatch[1].trim();
                    let code = rawContent;

                    const codeBlockMatch = rawContent.match(/```mermaid([\s\S]*?)```/);
                    if (codeBlockMatch && codeBlockMatch[1]) {
                        code = codeBlockMatch[1].trim();
                    } else {
                        code = code.replace(/```mermaid\n?|```\n?/g, "").replace(/```$/g, "").trim();
                    }
                    code = code.replace(/<\s*\/\s*subgraph\s*>/gi, "\nend\n").trim();
                    if (normalizeMermaidForComparison(code)) {
                        loggedLegacyDiagram = true;
                        console.info("[wizard] Ignoring legacy <diagram> block because Mermaid is derived locally.");
                    }
                }

                const questionActionMatch = parseBuffer.match(/<question_action>([\s\S]*?)<\/question_action>/i);
                if (questionActionMatch?.[1]) {
                    currentQuestionAction = normalizeMessageAction(questionActionMatch[1].trim()) ?? currentQuestionAction;
                }

                const questionRequirementKeyMatch = parseBuffer.match(/<question_requirement_key>([\s\S]*?)<\/question_requirement_key>/i);
                if (questionRequirementKeyMatch?.[1]) {
                    currentQuestionRequirementKey = normalizeReadinessRequirementKey(questionRequirementKeyMatch[1].trim()) ?? currentQuestionRequirementKey;
                }

                const rawQuestion = extractStructuredBlock(parseBuffer, "question");
                if (rawQuestion) {
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

                const stageMatch = parseBuffer.match(/<stage>([\s\S]*?)<\/stage>/i);
                if (stageMatch?.[1]) {
                    const parsedStage = normalizeArchitectureStage(
                        stageMatch[1].trim(),
                        currentEval.architecturePackDraft ?? architecturePack,
                        currentEval.decisionDrafts ?? decisionRecords,
                        currentEval.guardrailDrafts ?? guardrailChecklist,
                        readinessOverrides
                    );
                    currentEval.stage = parsedStage;
                }

                const densityMatch = parseBuffer.match(/<density>\s*(\d+)\s*<\/density>/i);
                if (densityMatch) {
                    currentEval.density_score = parseInt(densityMatch[1]);
                }

                const readyMatch = parseBuffer.match(/<is_ready>\s*(true|false)\s*<\/is_ready>/i);
                if (readyMatch) currentEval.is_ready = readyMatch[1] === 'true';

                const clarifiedMatch = parseBuffer.match(/<analysis_clarified>([\s\S]*?)<\/analysis_clarified>/i);
                if (clarifiedMatch) {
                    currentEval.analysis.clarified = parseAnalysisList(clarifiedMatch[1]);
                }

                const missingMatch = parseBuffer.match(/<analysis_missing>([\s\S]*?)<\/analysis_missing>/i);
                if (missingMatch) {
                    currentEval.analysis.missing = parseAnalysisList(missingMatch[1])
                        .filter((item) => !resolvedQuestionKeys.has(normalizeQuestionKey(item)));
                    currentEval.openQuestions = currentEval.analysis.missing.slice(0, 8);
                }

                const uiSpecMatch = parseBuffer.match(/<analysis_ui_spec>([\s\S]*?)<\/analysis_ui_spec>/i);
                if (uiSpecMatch) {
                    const parsedSpec = parseUiDesignSpecBlock(uiSpecMatch[1]);
                    if (parsedSpec) {
                        setUiDesignSpec(parsedSpec);
                        currentEval.analysis.ui = deriveUiRequirements(parsedSpec);
                    }
                }

                const uiMatch = parseBuffer.match(/<analysis_ui>([\s\S]*?)<\/analysis_ui>/i);
                if (uiMatch) {
                    currentEval.analysis.ui = parseAnalysisUiBlock(uiMatch[1]);
                    setUiDesignSpec((prev) => prev ?? buildMinimalUiDesignSpec(currentEval.analysis.ui));
                }

                const architecturePackMatch = parseBuffer.match(/<architecture_pack>([\s\S]*?)<\/architecture_pack>/i);
                if (architecturePackMatch) {
                    const parsedPack = parseJsonBlock(architecturePackMatch[1], (value) => normalizeArchitecturePack(value, currentEval.analysis.ui));
                    if (parsedPack) {
                        currentEval.architecturePackDraft = parsedPack;
                    }
                }

                const decisionsMatch = parseBuffer.match(/<decision_records>([\s\S]*?)<\/decision_records>/i);
                if (decisionsMatch) {
                    const parsedDecisions = parseJsonBlock(decisionsMatch[1], normalizeDecisionRecords);
                    if (parsedDecisions) {
                        currentEval.decisionDrafts = parsedDecisions;
                    }
                }

                const guardrailsMatch = parseBuffer.match(/<guardrails>([\s\S]*?)<\/guardrails>/i);
                if (guardrailsMatch) {
                    const parsedGuardrails = parseJsonBlock(guardrailsMatch[1], normalizeGuardrailChecklist);
                    if (parsedGuardrails) {
                        currentEval.guardrailDrafts = parsedGuardrails;
                    }
                }

                currentEval.architecturePackDraft = normalizeArchitecturePack(
                    currentEval.architecturePackDraft ?? seedArchitecturePackFromAnalysis(currentEval.analysis, currentEval.analysis.ui),
                    currentEval.analysis.ui
                );
                const syncedCurrentState = syncStructuredStateFromConversation({
                    architecturePack: currentEval.architecturePackDraft,
                    decisionRecords: currentEval.decisionDrafts ?? decisionRecords,
                    guardrailChecklist: currentEval.guardrailDrafts ?? guardrailChecklist,
                    analysis: currentEval.analysis,
                    messages: requestMessages
                });
                currentEval.architecturePackDraft = syncedCurrentState.architecturePack;
                currentEval.decisionDrafts = syncedCurrentState.decisionRecords;
                currentEval.guardrailDrafts = syncedCurrentState.guardrailChecklist;
                const syncedArchitecturePack = currentEval.architecturePackDraft;
                const syncedDecisionDrafts = currentEval.decisionDrafts;
                const syncedGuardrailDrafts = currentEval.guardrailDrafts;

                let nextReadiness = createReadinessChecklist(
                    syncedArchitecturePack,
                    syncedDecisionDrafts,
                    syncedGuardrailDrafts,
                    readinessOverrides
                );
                const readinessMatch = parseBuffer.match(/<readiness>([\s\S]*?)<\/readiness>/i);
                if (readinessMatch) {
                    const parsedReadiness = parseJsonBlock(readinessMatch[1], (value) => normalizeReadiness(
                        value,
                        syncedArchitecturePack,
                        syncedDecisionDrafts,
                        syncedGuardrailDrafts,
                        readinessOverrides
                    ));
                    if (parsedReadiness) {
                        nextReadiness = parsedReadiness;
                    }
                }
                currentEval.readiness = nextReadiness;
                currentEval.is_ready = currentEval.readiness.functionalReady && currentEval.readiness.uiReady;
                currentEval.density_score = currentEval.readiness.score;

                if (!currentEval.stage) {
                    currentEval.stage = inferArchitectureStage(
                        syncedArchitecturePack,
                        syncedDecisionDrafts,
                        syncedGuardrailDrafts,
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

                const normalizedEval = normalizeEvaluation({ ...currentEval }, readinessOverrides, requestMessages);
                setEvaluation(normalizedEval);
            };

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                if (evalRequestIdRef.current !== requestId) break;

                sseBuffer += decoder.decode(value, { stream: true });
                const parsedFrames = extractSseFrames(sseBuffer);
                sseBuffer = parsedFrames.rest;

                for (const frame of parsedFrames.frames) {
                    if (frame.event === "trace") {
                        const traceEvent = parseSsePayload<EvaluateTraceEvent>(frame.data);
                        if (traceEvent?.kind === "chunk" && typeof traceEvent.chunk === "string") {
                            applyEvaluateTraceChunk(traceEvent.chunk);
                        }
                        continue;
                    }

                    if (frame.event === "question") {
                        const questionEvent = parseSsePayload<EvaluateQuestionEvent>(frame.data);
                        if (questionEvent?.questionAction) {
                            currentQuestionAction = questionEvent.questionAction;
                        }
                        if (questionEvent?.questionRequirementKey) {
                            currentQuestionRequirementKey = normalizeReadinessRequirementKey(questionEvent.questionRequirementKey) ?? currentQuestionRequirementKey;
                        }
                        continue;
                    }

                    if (frame.event === "readiness.update") {
                        const readinessEvent = parseSsePayload<EvaluateReadinessUpdateEvent>(frame.data);
                        if (readinessEvent?.raw) {
                            const parsedReadiness = parseJsonBlock(readinessEvent.raw, (value) => normalizeReadiness(
                                value,
                                currentEval.architecturePackDraft ?? architecturePack,
                                currentEval.decisionDrafts ?? decisionRecords,
                                currentEval.guardrailDrafts ?? guardrailChecklist,
                                readinessOverrides
                            ));
                            if (parsedReadiness) {
                                currentEval.readiness = parsedReadiness;
                            }
                        }
                        continue;
                    }

                    if (frame.event === "remediation") {
                        const remediationEvent = parseSsePayload<EvaluateRemediationEvent>(frame.data);
                        if (remediationEvent?.message) {
                            console.warn("[wizard] evaluate remediation", remediationEvent.code, remediationEvent.message);
                        }
                    }
                }
            }

            if (evalRequestIdRef.current === requestId) {
                const finalEvaluation = normalizeEvaluation({ ...currentEval }, readinessOverrides, requestMessages);
                const finalWorkingArchitectureState = resolveWorkingArchitectureState(
                    finalEvaluation,
                    architecturePack,
                    decisionRecords,
                    guardrailChecklist,
                    readinessOverrides,
                    requestMessages
                );
                const resolvedPack = finalWorkingArchitectureState.architecturePack;
                const resolvedDecisions = finalWorkingArchitectureState.decisionRecords;
                const resolvedGuardrails = finalWorkingArchitectureState.guardrailChecklist;
                const resolvedStage = finalWorkingArchitectureState.stage;
                const resolvedEligibility = computeScaffoldEligibility({
                    architecturePack: resolvedPack,
                    decisionRecords: resolvedDecisions,
                    guardrailChecklist: resolvedGuardrails,
                    readinessOverrides
                });
                setEvaluation(finalEvaluation);
                commitArchitectureStageSnapshot(finalWorkingArchitectureState);
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
        id: createMessageId(),
        createdAt: Date.now(),
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
            content: buildBlockersSummary(language, activeScaffoldEligibility.readiness),
            options: language === "zh"
                ? [
                    { label: "给我补充模板", value: "请给我一个高质量补充模板，我来补齐这个缺口。", action: "fill_requirement", requirementKey },
                    { label: "我来手动补充", value: "我来手动补充。" }
                ]
                : [
                    { label: "Give me a template", value: "Give me a high-quality template so I can fill this gap.", action: "fill_requirement", requirementKey },
                    { label: "I will fill it manually", value: "I will fill it manually." }
                ],
            questionKey: normalizeQuestionKey(language === "zh" ? "要不要先给你一个高质量补充模板？" : "Should I give you a high-quality template first?"),
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
        const architecturePack = workingArchitectureState.architecturePack;
        const decisionRecords = workingArchitectureState.decisionRecords;
        const guardrailChecklist = workingArchitectureState.guardrailChecklist;
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
            return /阻塞项|blockers|补齐这个缺口|fill this gap|给我补充模板|give me a template|high-quality template|production-grade template|show me 2 or 3|请给我 2 到 3 个常见方案|我来补充这个缺口|i will fill/i.test(normalized);
        };
        const meaningfulUserInputs = baseMessages
            .filter((message) => message.role === "user")
            .map((message) => message.content.trim())
            .filter((text) => text.length > 0 && !isSteeringReply(text));
        const deterministicResolutionAllowed = shouldAllowDeterministicRequirementResolution(
            requirementKey,
            architecturePack,
            baseMessages
        );
        if (!deterministicResolutionAllowed) {
            return {
                architecturePack,
                guardrailChecklist,
                readinessOverrides,
                summary: "",
                applied: false
            };
        }
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
                    ? `已更新产品目标：${inferredProductGoal.trim()}`
                    : `Updated the product goal: ${inferredProductGoal.trim()}`,
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
                        ? "已更新目标用户。"
                        : "Updated the target users.",
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
                        ? "已更新关键用户旅程。"
                        : "Updated the key user journeys.",
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
                        ? "已更新约束与风险。"
                        : "Updated the constraints and risks.",
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
                        ? "已更新限界上下文。"
                        : "Updated the bounded contexts.",
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
                        ? "已更新模块职责。"
                        : "Updated the module responsibilities.",
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
                        ? "已更新数据归属规则。"
                        : "Updated the data ownership policy.",
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
                        ? "已更新集成契约。"
                        : "Updated the integration contracts.",
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
                        ? `已记录架构决策：${summaryParts.join("；")}。`
                        : `Recorded the architecture decisions: ${summaryParts.join("; ")}.`,
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
                        ? "已更新实现顺序。"
                        : "Updated the implementation order.",
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
                        ? "已更新验收标准。"
                        : "Updated the acceptance criteria.",
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
                        ? "已更新测试策略。"
                        : "Updated the test strategy.",
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
                    ? "已更新关键界面定义。"
                    : "Updated the key screen definitions.",
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
                        ? "已更新共享 UI 组件。"
                        : "Updated the shared UI components.",
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
                        ? "已更新响应式策略。"
                        : "Updated the responsive strategy.",
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

    const scrollToChatMessage = (messageId: string) => {
        if (!messageId) return;

        pendingScrollMessageIdRef.current = messageId;
        setIsChatCollapsed(false);
        setActiveTab("prd");

        const targetIndex = messages.findIndex((message) => message.id === messageId);
        if (targetIndex >= 0) {
            setMessageWindow((prev) => Math.max(prev, messages.length - targetIndex));
        }
    };

    const appendPrdDelta = (input: {
        action: PrdDelta["action"];
        requirementKey?: ReadinessRequirementKey | null;
        questionKey?: string | null;
        sourceMessageId?: string | null;
    }) => {
        const nextDelta: PrdDelta = {
            id: createPrdDeltaId(),
            createdAt: Date.now(),
            action: input.action,
            requirementKey: input.requirementKey ?? undefined,
            questionKey: input.questionKey ? normalizeQuestionKey(input.questionKey) : undefined,
            sourceMessageId: input.sourceMessageId ?? undefined
        };
        const previous = prdDeltasRef.current;
        const last = previous[previous.length - 1];

        if (
            last &&
            last.action === nextDelta.action &&
            last.requirementKey === nextDelta.requirementKey &&
            last.questionKey === nextDelta.questionKey &&
            last.sourceMessageId === nextDelta.sourceMessageId
        ) {
            return previous;
        }

        const next = [...previous, nextDelta].slice(-24);
        prdDeltasRef.current = next;
        setPrdDeltas(next);
        return next;
    };

    const handleRequirementAction = (
        action: "focus_requirement" | "fill_requirement" | "show_blockers",
        requirementKey: ReadinessRequirementKey | null,
        baseMessages: Message[]
    ) => {
        if (!requirementKey) return false;
        if (!findReadinessRequirement(activeScaffoldEligibility.readiness, requirementKey)) return false;

        const language = workspaceLanguage;

        if (action === "focus_requirement") {
            const focused = buildFocusedRequirementQuestion(
                language,
                requirementKey,
                workingArchitectureState.architecturePack,
                baseMessages
            );
            const assistantMessage = buildAssistantQuestionMessage(focused);
            appendDeterministicAssistantResponse(baseMessages, assistantMessage);
            appendPrdDelta({
                action: "focus_requirement",
                requirementKey,
                questionKey: focused.questionKey,
                sourceMessageId: assistantMessage.id
            });
            return true;
        }

        if (action === "show_blockers") {
            const blockersMessage = buildRequirementAlternativesMessage(language, requirementKey);
            appendDeterministicAssistantResponse(baseMessages, blockersMessage);
            appendPrdDelta({
                action: "show_blockers",
                requirementKey,
                questionKey: blockersMessage.questionKey,
                sourceMessageId: blockersMessage.id
            });
            return true;
        }

        const resolution = applyDefaultRequirementResolution(requirementKey, language, baseMessages);
        if (!resolution.applied) {
            const captureTemplate = buildRequirementCaptureTemplateQuestion(
                language,
                requirementKey,
                workingArchitectureState.architecturePack
            );
            const assistantMessage = buildAssistantQuestionMessage(captureTemplate);
            appendDeterministicAssistantResponse(baseMessages, assistantMessage);
            appendPrdDelta({
                action: "focus_requirement",
                requirementKey,
                questionKey: captureTemplate.questionKey,
                sourceMessageId: assistantMessage.id
            });
            return true;
        }

        setHasUserEdited(true);
        setReadinessOverrides(resolution.readinessOverrides);
        const resolvedDecisions = resolution.decisionRecords ?? workingArchitectureState.decisionRecords;

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
        const baseEvaluation = evaluation ?? {
            density_score: 0,
            is_ready: false,
            current_diagram: committedDerivedDiagram,
            analysis: normalizeAnalysis(null),
            next_step: { reasoning: "", question: null }
        };
        const nextEvaluation = normalizeEvaluation({
            ...baseEvaluation,
            analysis: normalizeAnalysis(baseEvaluation.analysis),
            architecturePackDraft: resolution.architecturePack,
            decisionDrafts: resolvedDecisions,
            guardrailDrafts: resolution.guardrailChecklist,
            readiness: nextEligibility.readiness,
            stage: nextStage,
            openQuestions: normalizeStringList(baseEvaluation.openQuestions ?? baseEvaluation.analysis?.missing, 12),
            density_score: nextEligibility.readiness.score,
            is_ready: nextEligibility.readiness.functionalReady && nextEligibility.readiness.uiReady
        }, resolution.readinessOverrides, baseMessages);
        const nextWorkingArchitectureState = resolveWorkingArchitectureState(
            nextEvaluation,
            architecturePack,
            decisionRecords,
            guardrailChecklist,
            resolution.readinessOverrides,
            baseMessages
        );
        setEvaluation(nextEvaluation);
        commitArchitectureStageSnapshot(nextWorkingArchitectureState, resolution.readinessOverrides);
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
        const assistantMessage = buildAssistantQuestionMessage({
            ...followUp,
            content: combinedContent
        });
        appendDeterministicAssistantResponse(baseMessages, assistantMessage);
        appendPrdDelta({
            action: "fill_requirement",
            requirementKey,
            questionKey: followUp.questionKey,
            sourceMessageId: assistantMessage.id
        });
        return true;
    };

    const handlePrdRequirementAction = async (
        action: "focus_requirement" | "fill_requirement",
        requirementKey: ReadinessRequirementKey
    ) => {
        if (isConversationLocked) return;

        if (isLoading) {
            cancelEvaluation();
        }

        const requirementLabel = getReadinessRequirementLabel(requirementKey, workspaceLanguage);
        const textToSend = action === "fill_requirement"
            ? (
                workspaceLanguage === "zh"
                    ? `请给我一个高质量补充模板，我来补齐${requirementLabel}。`
                    : `Give me a production-grade template so I can fill ${requirementLabel}.`
            )
            : (
                workspaceLanguage === "zh"
                    ? `请继续追问${requirementLabel}。`
                    : `Continue asking about ${requirementLabel}.`
            );
        const latestPendingQuestion = getLatestPendingQuestion(messages);
        const answeredQuestionKey = latestPendingQuestion?.questionKey ?? null;
        const preparedMessages = closeOpenAssistantQuestions(messages, answeredQuestionKey);
        const newUserMessage: Message = {
            id: createMessageId(),
            createdAt: Date.now(),
            role: "user",
            content: textToSend,
            answeredQuestionKey: answeredQuestionKey ?? undefined,
            triggeredAction: action
        };
        const newMessages = [...preparedMessages, newUserMessage];

        setHasUserEdited(true);
        setMessages(newMessages);
        setMessageWindow(MESSAGE_WINDOW_SIZE);
        setInput("");
        setActiveTab("architecture");

        if (handleRequirementAction(action, requirementKey, newMessages)) {
            return;
        }

        await continueEvaluation({
            requestMessages: newMessages,
            latestUserContext: textToSend,
            interactionMode: "architecture"
        });
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
        const shouldRecordConfirmationDelta = Boolean(
            answeredQuestionKey &&
            latestPendingQuestion &&
            !triggeredAction
        );

        // Optimistic UI Update
        setHasUserEdited(true);
        const newUserMessage: Message = {
            id: createMessageId(),
            createdAt: Date.now(),
            role: "user",
            content: textToSend,
            attachments: attachmentsToSend,
            answeredQuestionKey: answeredQuestionKey ?? undefined,
            triggeredAction: triggeredAction ?? undefined
        };
        const newMessages = [...preparedMessages, newUserMessage];
        if (shouldRecordConfirmationDelta) {
            appendPrdDelta({
                action: "confirmed",
                requirementKey: contextualRequirementKey,
                questionKey: answeredQuestionKey,
                sourceMessageId: newUserMessage.id
            });
        }
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
    const generateScaffold = async (snapshot?: {
        architecturePack: ArchitecturePack;
        decisionRecords: DecisionRecord[];
        guardrailChecklist: GuardrailChecklist;
        readinessOverrides: ReadinessOverride[];
        currentDiagram: string;
        messages: Message[];
    }) => {
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
            const effectiveArchitecturePack = snapshot?.architecturePack ?? workingArchitectureState.architecturePack;
            const effectiveDecisionRecords = snapshot?.decisionRecords ?? workingArchitectureState.decisionRecords;
            const effectiveGuardrailChecklist = snapshot?.guardrailChecklist ?? workingArchitectureState.guardrailChecklist;
            const effectiveReadinessOverrides = snapshot?.readinessOverrides ?? readinessOverrides;
            const effectiveDiagram = snapshot?.currentDiagram ?? workingDerivedDiagram;
            const effectiveMessages = snapshot?.messages ?? messages;
            const historyText = buildGenerateSummary(
                effectiveArchitecturePack,
                effectiveDecisionRecords,
                effectiveGuardrailChecklist,
                effectiveMessages
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
                        diagram: effectiveDiagram,
                        projectName: project?.name,
                        outputLanguage,
                        outputMode,
                        oneClickMode: GENERATE_ONE_CLICK_MODE,
                        ideProfile: GENERATE_IDE_PROFILE,
                        templateKindHint,
                        currentProjectTree,
                        architecturePack: effectiveArchitecturePack,
                        decisionRecords: effectiveDecisionRecords,
                        guardrailChecklist: effectiveGuardrailChecklist,
                        readinessOverrides: effectiveReadinessOverrides
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

    const startCheckout = async (snapshot?: {
        architecturePack: ArchitecturePack;
        decisionRecords: DecisionRecord[];
        guardrailChecklist: GuardrailChecklist;
        readinessOverrides: ReadinessOverride[];
        currentDiagram: string;
        messages: Message[];
        stage: ArchitectureStage;
        designStage: DesignStage;
    }) => {
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
            const effectiveArchitecturePack = snapshot?.architecturePack ?? workingArchitectureState.architecturePack;
            const effectiveDecisionRecords = snapshot?.decisionRecords ?? workingArchitectureState.decisionRecords;
            const effectiveGuardrailChecklist = snapshot?.guardrailChecklist ?? workingArchitectureState.guardrailChecklist;
            const effectiveReadinessOverrides = snapshot?.readinessOverrides ?? readinessOverrides;
            const effectiveDiagram = snapshot?.currentDiagram ?? workingDerivedDiagram;
            const effectiveMessages = snapshot?.messages ?? messages;
            const effectiveStage = snapshot?.stage ?? activeArchitectureStage;
            const effectiveDesignStage = snapshot?.designStage ?? activeDesignStage;
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
                            effectiveMessages,
                            evaluation,
                            generation,
                            generationArtifacts,
                            effectiveDiagram,
                            diagramGovernance,
                            tasks,
                            effectiveDesignStage,
                            uiDesignState,
                            uiDesignSpec,
                            effectiveArchitecturePack,
                            effectiveDecisionRecords,
                            effectiveGuardrailChecklist,
                            effectiveReadinessOverrides,
                            prdDeltas,
                            sourceArtifacts,
                            effectiveStage,
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
        const requestMessages = baseMessages ?? messages;
        const pendingQuestion = getLatestPendingQuestion(requestMessages);
        const committedMessages = closeOpenAssistantQuestions(
            requestMessages,
            pendingQuestion?.questionAction === "generate_scaffold" ? pendingQuestion.questionKey : null
        );
        const committedSnapshot = commitActiveEligibilitySnapshot(
            workingArchitectureState,
            committedMessages
        );

        setMessages(committedMessages);

        setGenerateError(null);
        if (!committedSnapshot.canGenerate) {
            const message = translateReadinessText(
                workspaceLanguage,
                committedSnapshot.blockingReasons[0] || uiText.completeReadinessBeforeGenerate
            );
            setGenerateError(message);
            if (source === "chat") {
                const blockedResponse = buildBlockedGenerateQuestion(
                    workspaceLanguage,
                    committedSnapshot.stage,
                    committedSnapshot.readiness,
                    committedSnapshot.architecturePack,
                    committedMessages
                );
                setMessages(() => {
                    return [
                        ...committedMessages,
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
            await startCheckout(committedSnapshot);
            return;
        }
        await generateScaffold(committedSnapshot);
    };

    const handleArchitectureNodeSelect = () => {
        setGenerateError(null);
    };

    const isPrdTabActive = activeTab === "prd";
    const prdLayoutUi = getPrdLayoutUiText(workspaceLanguage);
    const requirementsTabLabel = workspaceLanguage === "zh" ? "需求进度" : "Requirements";
    const requirementsTitle = workspaceLanguage === "zh" ? "需求进度" : "Requirements";
    const requirementsSyncLabel = workspaceLanguage === "zh" ? "实时更新" : "Live updates";
    const prdProjection = isPrdTabActive
        ? buildPrdProjectionModel(
            workspaceLanguage,
            workingArchitectureState.architecturePack,
            workingArchitectureState.guardrailChecklist,
            activeScaffoldEligibility.readiness,
            prdDeltas,
            generationReady
        )
        : null;
    const prdStatusCards = prdProjection?.currentStatus ?? [];
    const prdConfirmedScope = prdProjection?.confirmedScope ?? [];
    const prdPendingQuestions = prdProjection?.pendingQuestions ?? [];
    const prdImplementationReadiness = prdProjection?.implementationReadiness ?? [];
    const prdChangeLog = prdProjection?.changeLog ?? [];
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
                                    const messageId = msg.id ?? `message-${messageIndex}`;
                                    return (
                                        <div
                                            key={messageId}
                                            ref={(node) => {
                                                messageElementRefs.current[messageId] = node;
                                            }}
                                            data-message-id={messageId}
                                            className={highlightedMessageId === messageId
                                                ? "rounded-2xl ring-2 ring-sky-300/80 ring-offset-2 ring-offset-white transition-all dark:ring-sky-500/70 dark:ring-offset-slate-900"
                                                : "transition-all"
                                            }
                                        >
                                            <ChatBubble
                                                message={msg}
                                                onOptionClick={handleOptionClick}
                                                disableOptions={isConversationLocked}
                                                isStreaming={isAssistantStreamingVisible && messageIndex === lastMessageIndex}
                                            />
                                        </div>
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
                                        {uiText.architectStage}: {getArchitectureStageLabel(workspaceLanguage, activeArchitectureStage)} | {uiText.readiness} {Math.round(architectureCompletion)}%
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
                                                disabled={isGenerating || isCheckingOut || !isAdminStatusLoaded || !generationReady}
                                                className="fc-button-primary flex w-full items-center justify-center gap-2 px-6 py-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                                            >
                                                {isGenerating || isCheckingOut
                                                    ? <Loader2 className="animate-spin" />
                                                    : <Sparkles className="w-5 h-5" />}
                                                {!isAdminStatusLoaded
                                                    ? uiText.checkingAccess
                                                    : !generationReady
                                                    ? uiText.generateLockedUntilReady
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
                                                    : !generationReady
                                                    ? uiText.readinessNotReady(translateReadinessText(workspaceLanguage, readinessBlockers[0] || ""))
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
                                    {!generationReady && (
                                        <p className="px-1 text-[11px] text-slate-500 dark:text-slate-300">
                                            {uiText.nextReadinessBlocker(translateReadinessText(workspaceLanguage, readinessBlockers[0] || ""))}
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
                {syncConflictMessage && (
                    <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50/90 px-4 py-3 text-sm text-amber-800 shadow-sm dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-200">
                        {syncConflictMessage}
                    </div>
                )}
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
                        label={requirementsTabLabel}
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
                                    <ArchitectureViewer
                                        code={architectureViewerCode}
                                        onNodeSelect={handleArchitectureNodeSelect}
                                        language={workspaceLanguage}
                                        diagramModel={hasWorkingDiagramSource ? workingDiagramModel : undefined}
                                    />
                                ) : (
                                    <ArchitecturePanelPlaceholder />
                                )}
                            </div>
                        </div>
                    )}

                    {/* Requirements Tab */}
                    {activeTab === 'prd' && (
                        <div className="absolute inset-0 overflow-y-auto p-4 md:p-6">
                            <div className="mx-auto max-w-6xl space-y-4">
                                <section className="rounded-2xl border border-[color:var(--border)] bg-white/80 p-4 dark:bg-slate-900/60">
                                    <div className="flex items-center justify-between gap-3">
                                        <div>
                                            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{requirementsTitle}</h3>
                                            <p className="mt-1 text-sm text-slate-500 dark:text-slate-300">{prdLayoutUi.pageDesc}</p>
                                        </div>
                                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 dark:border-emerald-700/40 dark:bg-emerald-900/20 dark:text-emerald-300">
                                            {requirementsSyncLabel}
                                        </span>
                                    </div>

                                    <div className="mt-4 space-y-5">
                                        <div className="rounded-2xl border border-sky-100 bg-sky-50/70 p-4 dark:border-sky-800/40 dark:bg-sky-900/15">
                                            <div className="flex flex-wrap items-start justify-between gap-3">
                                                <div>
                                                    <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                                                        {workspaceLanguage === "zh" ? "当前状态" : "Current status"}
                                                    </h4>
                                                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                                                        {workspaceLanguage === "zh"
                                                            ? "这里按每回合最新确认内容展示进度、当前焦点、阻塞项和最近更新。"
                                                            : "This view tracks the latest confirmed progress, active focus, blockers, and recent updates from each turn."}
                                                    </p>
                                                </div>
                                            </div>

                                            <div className="mt-4 grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
                                                {prdStatusCards.map((card, index) => (
                                                    <div key={`prd-status-${index}`} className={getPrdStatusCardClassName(card.tone)}>
                                                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-300">{card.label}</p>
                                                        <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-slate-100">{card.value}</p>
                                                        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{card.detail}</p>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>

                                        <div>
                                            <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{prdLayoutUi.confirmedScopeTitle}</h4>
                                            <p className="mt-1 text-sm text-slate-500 dark:text-slate-300">{prdLayoutUi.confirmedScopeDesc}</p>
                                            <div className="mt-2 space-y-2">
                                                {prdConfirmedScope.length > 0 ? prdConfirmedScope.map((item, index) => (
                                                    <div key={`prd-scope-${index}`} className="rounded-xl border border-[color:var(--border)] bg-slate-50/80 px-3 py-2 text-sm text-slate-700 dark:bg-slate-800/40 dark:text-slate-200">
                                                        {item}
                                                    </div>
                                                )) : (
                                                    <p className="text-sm text-slate-500 dark:text-slate-300">{prdLayoutUi.noConfirmedScope}</p>
                                                )}
                                            </div>
                                        </div>

                                        <div>
                                            <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{prdLayoutUi.pendingQuestionsTitle}</h4>
                                            <p className="mt-1 text-sm text-slate-500 dark:text-slate-300">{prdLayoutUi.pendingQuestionsDesc}</p>
                                            <div className="mt-2 space-y-3">
                                                {prdPendingQuestions.length > 0 ? prdPendingQuestions.map((item, index) => {
                                                    const statusMeta = getPrdTaskStatusMeta(workspaceLanguage, item.status);
                                                    return (
                                                        <div key={`prd-pending-${index}`} className="rounded-xl border border-amber-100 bg-amber-50/60 px-3 py-3 dark:border-amber-800/40 dark:bg-amber-900/10">
                                                            <div className="flex flex-wrap items-center justify-between gap-2">
                                                                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{item.label}</p>
                                                                <div className="flex flex-wrap items-center gap-2">
                                                                    <span className="rounded-full border border-amber-200 bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-amber-700 dark:border-amber-700/40 dark:bg-slate-900/40 dark:text-amber-300">
                                                                        {item.progressLabel}
                                                                    </span>
                                                                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusMeta.className}`}>
                                                                        {statusMeta.label}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                            <p className="mt-2 text-sm text-slate-700 dark:text-slate-200">{item.detail}</p>
                                                            <div className="mt-3 flex flex-wrap gap-2">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => {
                                                                        void handlePrdRequirementAction("focus_requirement", item.requirementKey);
                                                                    }}
                                                                    disabled={isConversationLocked || isLoading}
                                                                    className="rounded-xl border border-slate-200 bg-white/90 px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700/40 dark:bg-slate-900/50 dark:text-slate-200 dark:hover:bg-slate-900/70"
                                                                >
                                                                    {prdLayoutUi.followUpAction}
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => {
                                                                        void handlePrdRequirementAction("fill_requirement", item.requirementKey);
                                                                    }}
                                                                    disabled={isConversationLocked || isLoading}
                                                                    className="rounded-xl border border-emerald-200 bg-emerald-50/90 px-3 py-2 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-700/40 dark:bg-emerald-900/20 dark:text-emerald-300 dark:hover:bg-emerald-900/30"
                                                                >
                                                                    {prdLayoutUi.fillAction}
                                                                </button>
                                                            </div>
                                                        </div>
                                                    );
                                                }) : (
                                                    <p className="text-sm text-slate-500 dark:text-slate-300">{prdLayoutUi.noPendingQuestions}</p>
                                                )}
                                            </div>
                                        </div>

                                        <></>
                                    </div>
                                </section>

                                <section className="space-y-4">
                                    <div className="rounded-2xl border border-[color:var(--border)] bg-white/80 p-4 dark:bg-slate-900/60">
                                        <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{prdLayoutUi.implementationReadinessTitle}</h4>
                                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-300">{prdLayoutUi.implementationReadinessDesc}</p>
                                        <div className="mt-3 space-y-3">
                                            {prdImplementationReadiness.map((item, index) => (
                                                <div key={`prd-readiness-${index}`} className={getPrdStatusCardClassName(item.tone)}>
                                                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-300">{item.label}</p>
                                                    <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-slate-100">{item.value}</p>
                                                    <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{item.detail}</p>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="rounded-2xl border border-[color:var(--border)] bg-white/80 p-4 dark:bg-slate-900/60">
                                        <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{prdLayoutUi.changeLogTitle}</h4>
                                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-300">{prdLayoutUi.changeLogDesc}</p>
                                        <div className="mt-3 space-y-3">
                                            {prdChangeLog.length > 0 ? prdChangeLog.map((item, index) => (
                                                <div key={`prd-change-${index}`} className={getPrdStatusCardClassName(item.tone)}>
                                                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{item.title}</p>
                                                    <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{item.detail}</p>
                                                    {item.sourceMessageId && (
                                                        <button
                                                            type="button"
                                                            onClick={() => scrollToChatMessage(item.sourceMessageId!)}
                                                            className="mt-3 rounded-xl border border-slate-200 bg-white/90 px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-white dark:border-slate-700/40 dark:bg-slate-900/40 dark:text-slate-200 dark:hover:bg-slate-900/60"
                                                        >
                                                            {prdLayoutUi.jumpToChatAction}
                                                        </button>
                                                    )}
                                                </div>
                                            )) : (
                                                <p className="text-sm text-slate-500 dark:text-slate-300">{prdLayoutUi.noChangeLog}</p>
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
