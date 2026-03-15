
import { NextResponse } from "next/server";
import { getActiveAiProvider, streamEvaluateInput } from "@/lib/gemini";
import type { Message, Attachment, EvaluateInteractionMode, ReadinessRequirementKey } from "@/types";

const MAX_EVALUATE_BODY_CHARS = 1_200_000;
const EVALUATE_STREAM_HEARTBEAT_MS = readBoundedIntEnv("EVALUATE_STREAM_HEARTBEAT_MS", 10_000, 5_000, 20_000);
const EVALUATE_RETRY_HISTORY_MESSAGES = 10;
const EVALUATE_RETRY_CONTENT_CHARS = 2_500;
const EVALUATE_RETRY_CONTEXT_CHARS = 3_000;
const EVALUATE_SOURCE_CONTEXT_CHARS = 6_000;
const EVALUATE_RETRY_SOURCE_CONTEXT_CHARS = 2_500;
const EVALUATE_RETRY_TEXT_ATTACHMENT_CHARS = 2_000;
const EVALUATE_DESIGN_MEMORY_CHARS = 14_000;
const EVALUATE_RETRY_DESIGN_MEMORY_CHARS = 5_000;
const EVALUATE_DIAGRAM_POLICY_MAX_CHARS = 120;
const DEFAULT_DIAGRAM_POLICY = "incremental_auto_apply_v1";
const EVALUATE_FALLBACK_BUFFER_CHARS = 120_000;
const EVALUATE_FALLBACK_QUESTION_MAX_CHARS = 280;

export const runtime = "nodejs";

type EvaluateRequestBody = {
    messages?: unknown;
    context?: unknown;
    sourceContext?: unknown;
    generationReady?: unknown;
    interactionMode?: unknown;
    designMemory?: unknown;
    diagramPolicy?: unknown;
    outputLanguage?: unknown;
};

class RequestPayloadError extends Error {
    status: number;

    constructor(message: string, status: number) {
        super(message);
        this.status = status;
    }
}

function getErrorDetails(error: unknown) {
    if (error instanceof Error) return error.message;
    return String(error);
}

function normalizeServerErrorDetails(raw: string) {
    const source = (raw || "").trim();
    if (!source) return "Unknown error";

    const looksLikeHtmlOrCss = /<!doctype html|<html|<head|<body|<style|<\/[a-z]+>|\bbody\s*\{|font-family\s*:|h1\s*,\s*h2/i.test(source);
    if (looksLikeHtmlOrCss) {
        return "Internal Server Error from upstream gateway.";
    }

    const compact = source.replace(/\s+/g, " ").trim();
    if (!compact) return "Unknown error";
    return compact.length > 260 ? `${compact.slice(0, 260)}...` : compact;
}

function readBoundedIntEnv(name: string, fallback: number, min: number, max: number) {
    const value = process.env[name];
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
        const intValue = Math.floor(parsed);
        return Math.min(max, Math.max(min, intValue));
    }
    return Math.min(max, Math.max(min, fallback));
}

function isGeminiStreamParseError(error: unknown) {
    const details = getErrorDetails(error).toLowerCase();
    return details.includes("failed to parse stream") || details.includes("parse stream");
}

function isUpstreamOverloadError(error: unknown) {
    const details = getErrorDetails(error).toLowerCase();
    return (
        details.includes("503") ||
        details.includes("service unavailable") ||
        details.includes("high demand") ||
        details.includes("overloaded") ||
        details.includes("resource exhausted")
    );
}

function clipText(text: string, maxChars: number) {
    if (text.length <= maxChars) return text;
    return `${text.slice(0, maxChars)}\n... [truncated]`;
}

function extractTaggedSection(output: string, tag: string) {
    const regex = new RegExp(`<${tag}>([\\s\\S]*?)(?:<\\/${tag}>|$)`, "i");
    const match = output.match(regex);
    return match?.[1]?.trim() ?? "";
}

function parseMissingItems(raw: string) {
    return raw
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => line.replace(/^[-*]\s*/, ""))
        .map((line) => line.replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .map((line) => line.replace(/[?？]+$/g, ""))
        .filter(Boolean);
}

// Legacy fallback kept while the structured fallback flow rolls out.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function buildFallbackQuestion(output: string, language: "zh" | "en") {
    const missingRaw = extractTaggedSection(output, "analysis_missing");
    const missingItems = parseMissingItems(missingRaw);
    if (missingItems.length > 0) {
        const summary = missingItems.slice(0, 3).join("; ");
        const question = language === "zh"
            ? `请先确认以下几点，我才能继续推进：${summary}？`
            : `Could you clarify the following so I can proceed: ${summary}?`;
        return clipText(question, EVALUATE_FALLBACK_QUESTION_MAX_CHARS);
    }
    return language === "zh"
        ? "请确认这个方向，我再继续推进。"
        : "Could you confirm this direction so I can proceed?";
}

// Legacy fallback kept while the structured fallback flow rolls out.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function buildFallbackOptions(language: "zh" | "en") {
    if (language === "zh") {
        return [
            "按你的建议继续::按你的建议继续推进",
            "我来补充细节::我来补充更多关键信息",
            "给我常见选项::请给我常见可选方案",
            "我暂时不确定::我暂时不确定，请给默认建议"
        ];
    }

    return [
        "Proceed with your recommendation::Proceed with your recommendation.",
        "I will add more detail::I will add more detail.",
        "Show me common options::Show me common options.",
        "I am not sure yet::I am not sure yet. Please use the default approach."
    ];
}

type FallbackQuestionPayload = {
    message: string;
    questionAction?: "fill_requirement";
    questionRequirementKey?: ReadinessRequirementKey | null;
};

function parseFallbackMissingItems(raw: string) {
    return raw
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => line.replace(/^[-*]\s*/, ""))
        .map((line) => line.replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .map((line) => line.replace(/[?？]+$/g, ""))
        .filter(Boolean);
}

function inferFallbackRequirementKey(item: string): ReadinessRequirementKey | null {
    const normalized = item.toLowerCase();
    const rules: Array<{ key: ReadinessRequirementKey; patterns: RegExp[] }> = [
        {
            key: "business_context.platforms",
            patterns: [
                /platform/,
                /runtime/,
                /launch platform/,
                /platform strategy/,
                /平台/,
                /首发平台/,
                /运行时/,
                /浏览器/,
                /ios/,
                /android/,
                /desktop/,
                /mobile app/,
                /web 应用/
            ]
        },
        {
            key: "business_context.target_users",
            patterns: [/target user/, /audience/, /目标用户/]
        },
        {
            key: "business_context.user_journeys",
            patterns: [/user journey/, /workflow/, /journey step/, /用户旅程/, /流程步骤/]
        },
        {
            key: "business_context.constraints_or_risks",
            patterns: [/constraint/, /risk/, /约束/, /风险/]
        },
        {
            key: "boundaries.bounded_contexts",
            patterns: [/bounded context/, /限界上下文/]
        },
        {
            key: "boundaries.module_responsibilities",
            patterns: [/module/, /responsibilit/, /模块职责/, /服务模块/]
        },
        {
            key: "boundaries.data_ownership",
            patterns: [/data ownership/, /ownership/, /retention/, /保留期/, /数据归属/, /数据所有权/, /主权/]
        },
        {
            key: "decisions.decision_records",
            patterns: [/stack/, /framework/, /hosting/, /backend/, /deploy/, /技术栈/, /框架/, /托管/, /后端/]
        },
        {
            key: "decisions.integration_contracts",
            patterns: [/integration contract/, /api contract/, /接口契约/, /集成契约/, /contract/]
        },
        {
            key: "decisions.non_functional_requirements",
            patterns: [/non-functional/, /performance/, /privacy/, /availability/, /latency/, /sla/, /性能/, /隐私/, /可用性/, /响应时间/, /并发/]
        },
        {
            key: "guardrails.implementation_order",
            patterns: [/implementation order/, /phase/, /milestone/, /实现顺序/, /阶段计划/]
        },
        {
            key: "guardrails.acceptance_criteria",
            patterns: [/acceptance criteria/, /definition of done/, /验收标准/]
        },
        {
            key: "guardrails.test_strategy",
            patterns: [/test strategy/, /testing/, /测试策略/]
        },
        {
            key: "ui.key_screens",
            patterns: [/key screen/, /screen/, /关键界面/, /页面/]
        },
        {
            key: "ui.shared_components",
            patterns: [/shared ui/, /shared component/, /共享 ui/, /共享组件/]
        },
        {
            key: "ui.responsive_strategy",
            patterns: [/responsive/, /breakpoint/, /响应式/]
        }
    ];

    for (const rule of rules) {
        if (rule.patterns.some((pattern) => pattern.test(normalized))) {
            return rule.key;
        }
    }

    return null;
}

function getFallbackRequirementLabel(
    requirementKey: ReadinessRequirementKey,
    language: "zh" | "en"
) {
    const labels: Record<ReadinessRequirementKey, { zh: string; en: string }> = {
        "business_context.product_goal": { zh: "产品目标", en: "the product goal" },
        "business_context.platforms": { zh: "平台策略", en: "the platform strategy" },
        "business_context.target_users": { zh: "目标用户", en: "the target users" },
        "business_context.user_journeys": { zh: "用户旅程", en: "the user journey" },
        "business_context.constraints_or_risks": { zh: "约束与风险", en: "the constraints and risks" },
        "boundaries.bounded_contexts": { zh: "限界上下文", en: "the bounded contexts" },
        "boundaries.module_responsibilities": { zh: "模块职责", en: "the module responsibilities" },
        "boundaries.data_ownership": { zh: "数据归属", en: "the data ownership policy" },
        "decisions.decision_records": { zh: "技术决策基线", en: "the architecture decision baseline" },
        "decisions.integration_contracts": { zh: "集成契约", en: "the integration contract" },
        "decisions.non_functional_requirements": { zh: "非功能性需求", en: "the non-functional requirement" },
        "guardrails.implementation_order": { zh: "实现顺序", en: "the implementation order" },
        "guardrails.acceptance_criteria": { zh: "验收标准", en: "the acceptance criteria" },
        "guardrails.test_strategy": { zh: "测试策略", en: "the test strategy" },
        "ui.key_screens": { zh: "关键界面", en: "the key screens" },
        "ui.shared_components": { zh: "共享组件", en: "the shared UI components" },
        "ui.responsive_strategy": { zh: "响应式策略", en: "the responsive strategy" }
    };

    return labels[requirementKey][language];
}

function buildStructuredFallbackQuestion(output: string, language: "zh" | "en"): FallbackQuestionPayload {
    const missingRaw = extractTaggedSection(output, "analysis_missing");
    const missingItems = parseFallbackMissingItems(missingRaw);

    if (missingItems.length > 0) {
        const primaryItem = missingItems[0];
        const requirementKey = inferFallbackRequirementKey(primaryItem);

        if (requirementKey) {
            const label = getFallbackRequirementLabel(requirementKey, language);
            return {
                message: clipText(
                    language === "zh"
                        ? `我建议先按默认方案补齐“${label}”。是否现在先处理这一项？`
                        : `I recommend resolving ${label} next using the default approach. Should I do that now?`,
                    EVALUATE_FALLBACK_QUESTION_MAX_CHARS
                ),
                questionAction: "fill_requirement",
                questionRequirementKey: requirementKey
            };
        }

        return {
            message: clipText(
                language === "zh"
                    ? `我建议先澄清这一项：${clipText(primaryItem, 180)}。是否先处理它？`
                    : `I recommend resolving this gap first: ${clipText(primaryItem, 180)}. Should we handle it now?`,
                EVALUATE_FALLBACK_QUESTION_MAX_CHARS
            )
        };
    }

    return {
        message: language === "zh"
            ? "请先确认这个方向，我再继续推进。"
            : "Could you confirm this direction so I can proceed?"
    };
}

function buildStructuredFallbackOptions(language: "zh" | "en") {
    if (language === "zh") {
        return [
            "\u6309\u4f60\u7684\u5efa\u8bae\u7ee7\u7eed::\u6309\u4f60\u63a8\u8350\u7684\u9ed8\u8ba4\u65b9\u6848\u7ee7\u7eed\u3002",
            "\u6211\u6765\u8865\u5145\u7ec6\u8282::\u6211\u6765\u8865\u5145\u66f4\u591a\u5173\u952e\u4fe1\u606f\u3002",
            "\u7ed9\u6211\u5e38\u89c1\u9009\u9879::\u8bf7\u7ed9\u6211 2 \u5230 3 \u4e2a\u5e38\u89c1\u65b9\u6848\u5e76\u8bf4\u660e\u53d6\u820d\u3002",
            "\u6211\u6682\u65f6\u4e0d\u786e\u5b9a::\u6211\u6682\u65f6\u4e0d\u786e\u5b9a\uff0c\u8bf7\u6309\u6700\u7a33\u59a5\u7684\u9ed8\u8ba4\u65b9\u6848\u63a8\u8fdb\u3002"
        ];
    }

    return [
        "Proceed with your recommendation::Proceed with your recommendation.",
        "I will add more detail::I will add more detail.",
        "Show me common options::Show me 2 or 3 common options and explain the tradeoffs.",
        "I am not sure yet::I am not sure yet. Please use the safest default approach."
    ];
}

function getEvaluateFallbackMessage(
    language: "zh" | "en",
    key: "high_demand" | "empty_before_content" | "service_unavailable" | "no_output"
) {
    if (language === "zh") {
        switch (key) {
            case "high_demand":
                return "AI \u670d\u52a1\u5f53\u524d\u8d1f\u8f7d\u8f83\u9ad8\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5\u3002";
            case "empty_before_content":
                return "AI \u5728\u8fd4\u56de\u4efb\u4f55\u5185\u5bb9\u524d\u5c31\u5931\u8d25\u4e86\uff0c\u8bf7\u91cd\u8bd5\u3002";
            case "service_unavailable":
                return "\u62b1\u6b49\uff0cAI \u670d\u52a1\u6682\u65f6\u4e0d\u53ef\u7528\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5\u3002";
            case "no_output":
                return "\u6a21\u578b\u6ca1\u6709\u8fd4\u56de\u5185\u5bb9\uff0c\u8bf7\u91cd\u8bd5\u3002";
            default:
                return "\u8bf7\u91cd\u8bd5\u3002";
        }
    }

    switch (key) {
        case "high_demand":
            return "AI service is experiencing high demand. Please try again in a moment.";
        case "empty_before_content":
            return "AI response failed before any content was returned. Please retry.";
        case "service_unavailable":
            return "Sorry, the AI service is temporarily unavailable. Please try again in a moment.";
        case "no_output":
            return "No model output received. Please retry.";
        default:
            return "Please retry.";
    }
}

function compactAttachment(attachment: Attachment): Attachment {
    if (attachment.type === "text") {
        return {
            ...attachment,
            content: clipText(attachment.content || "", EVALUATE_RETRY_TEXT_ATTACHMENT_CHARS)
        };
    }

    return {
        type: "text",
        mimeType: "text/plain",
        name: attachment.name,
        content: `[Attachment omitted in retry: ${attachment.name} (${attachment.mimeType})]`
    };
}

function buildRetryMessages(rawMessages: unknown): Message[] {
    if (!Array.isArray(rawMessages)) return [];

    const normalized: Message[] = rawMessages
        .filter((item) => item && typeof item === "object")
        .map((item) => {
            const candidate = item as Message;
            const role = candidate.role === "assistant" ? "assistant" : "user";
            const content = clipText(
                typeof candidate.content === "string" ? candidate.content : "",
                EVALUATE_RETRY_CONTENT_CHARS
            );

            const attachments = Array.isArray(candidate.attachments)
                ? candidate.attachments.map((att) => compactAttachment(att))
                : undefined;

            return {
                role,
                content,
                attachments
            } as Message;
        });

    return normalized.slice(-EVALUATE_RETRY_HISTORY_MESSAGES);
}

function getMessageStats(rawMessages: unknown) {
    if (!Array.isArray(rawMessages)) {
        return {
            messageCount: 0,
            totalContentChars: 0,
            totalAttachments: 0,
            textAttachments: 0,
            binaryAttachments: 0
        };
    }

    let totalContentChars = 0;
    let totalAttachments = 0;
    let textAttachments = 0;
    let binaryAttachments = 0;

    for (const item of rawMessages) {
        if (!item || typeof item !== "object") continue;
        const candidate = item as Message;
        totalContentChars += typeof candidate.content === "string" ? candidate.content.length : 0;

        if (!Array.isArray(candidate.attachments)) continue;
        totalAttachments += candidate.attachments.length;
        for (const attachment of candidate.attachments) {
            if (attachment.type === "text") {
                textAttachments += 1;
            } else {
                binaryAttachments += 1;
            }
        }
    }

    return {
        messageCount: rawMessages.length,
        totalContentChars,
        totalAttachments,
        textAttachments,
        binaryAttachments
    };
}

async function* streamWithTimeGuards(
    messages: Message[],
    contextText: string | undefined,
    generationReady: boolean,
    options?: {
        preferBackupModel?: boolean;
        sourceContext?: string;
        designMemory?: string;
        diagramPolicy?: string;
        outputLanguage?: "zh" | "en";
        interactionMode?: EvaluateInteractionMode;
    }
) {
    const iterator = streamEvaluateInput(messages, contextText, {
        generationReady,
        preferBackupModel: options?.preferBackupModel === true,
        sourceContext: options?.sourceContext,
        designMemory: options?.designMemory,
        diagramPolicy: options?.diagramPolicy,
        outputLanguage: options?.outputLanguage,
        interactionMode: options?.interactionMode
    })[Symbol.asyncIterator]();
    try {
        while (true) {
            const next = await iterator.next();

            if (next.done) {
                break;
            }

            const chunk = typeof next.value === "string" ? next.value : String(next.value ?? "");
            yield chunk;
        }
    } finally {
        if (typeof iterator.return === "function") {
            try {
                await iterator.return();
            } catch {
                // Swallow cleanup errors so timeout paths can return gracefully.
            }
        }
    }
}

async function parseEvaluateRequest(req: Request): Promise<EvaluateRequestBody> {
    const raw = await req.text();
    if (!raw || !raw.trim()) {
        throw new RequestPayloadError("Request body is empty.", 400);
    }

    if (raw.length > MAX_EVALUATE_BODY_CHARS) {
        throw new RequestPayloadError(
            `Request body too large (${raw.length} chars).`,
            413
        );
    }

    try {
        return JSON.parse(raw) as EvaluateRequestBody;
    } catch (error) {
        throw new RequestPayloadError(`Invalid JSON body: ${getErrorDetails(error)}`, 400);
    }
}

export async function POST(req: Request) {
    const requestId = (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`).slice(0, 12);
    const requestStartedAt = Date.now();
    try {
        const { messages, context, sourceContext, generationReady, interactionMode, designMemory, diagramPolicy, outputLanguage } = await parseEvaluateRequest(req);
        const responseLanguage = outputLanguage === "zh" ? "zh" : "en";
        const normalizedInteractionMode: EvaluateInteractionMode = interactionMode === "chat" ? "chat" : "architecture";
        const contextText = typeof context === "string" ? context : undefined;
        const sourceContextText =
            typeof sourceContext === "string" && sourceContext.trim()
                ? clipText(sourceContext.trim(), EVALUATE_SOURCE_CONTEXT_CHARS)
                : undefined;
        const designMemoryText =
            typeof designMemory === "string" && designMemory.trim()
                ? clipText(designMemory.trim(), EVALUATE_DESIGN_MEMORY_CHARS)
                : undefined;
        const incomingDiagramPolicy =
            typeof diagramPolicy === "string" && diagramPolicy.trim()
                ? clipText(diagramPolicy.trim(), EVALUATE_DIAGRAM_POLICY_MAX_CHARS)
                : DEFAULT_DIAGRAM_POLICY;
        const normalizedDiagramPolicy =
            incomingDiagramPolicy === DEFAULT_DIAGRAM_POLICY
                ? incomingDiagramPolicy
                : DEFAULT_DIAGRAM_POLICY;
        if (!Array.isArray(messages) || messages.length === 0) {
            return NextResponse.json({ error: "No messages provided" }, { status: 400 });
        }
        const provider = getActiveAiProvider();
        const messageStats = getMessageStats(messages);
        console.log(
            `[evaluate][${requestId}] start provider=${provider} mode=${normalizedInteractionMode} messages=${messageStats.messageCount} contextChars=${contextText?.length || 0} sourceContextChars=${sourceContextText?.length || 0} designMemoryChars=${designMemoryText?.length || 0} diagramPolicy=${normalizedDiagramPolicy} generationReady=${generationReady === true} contentChars=${messageStats.totalContentChars} attachments=${messageStats.totalAttachments} textAttachments=${messageStats.textAttachments} binaryAttachments=${messageStats.binaryAttachments}`
        );

        const stream = new ReadableStream({
            async start(controller) {
                const encoder = new TextEncoder();
                let closed = false;
                let emittedMeaningfulChunk = false;
                let firstChunkLogged = false;
                let sawQuestionTag = false;
                let fallbackQuestionInjected = false;
                let tagScanBuffer = "";
                let fullOutput = "";
                const streamStartedAt = Date.now();

                const safeEnqueue = (chunk: string) => {
                    if (closed) return;
                    try {
                        controller.enqueue(encoder.encode(chunk));
                    } catch {
                        closed = true;
                    }
                };

                const enqueueQuestionFallback = (payload: string | FallbackQuestionPayload) => {
                    const normalizedPayload = typeof payload === "string"
                        ? { message: payload }
                        : payload;
                    const actionTag = normalizedPayload.questionAction
                        ? `\n<question_action>${normalizedPayload.questionAction}</question_action>`
                        : "";
                    const requirementTag = normalizedPayload.questionRequirementKey
                        ? `\n<question_requirement_key>${normalizedPayload.questionRequirementKey}</question_requirement_key>`
                        : "";
                    const optionsBlock = normalizedInteractionMode === "architecture"
                        ? `\n<options>${buildStructuredFallbackOptions(responseLanguage).join("\n")}</options>`
                        : "";
                    safeEnqueue(
                        `<question>${normalizedPayload.message} (ref: ${requestId})</question>${actionTag}${requirementTag}${optionsBlock}`
                    );
                    fallbackQuestionInjected = true;
                    sawQuestionTag = true;
                };

                // Send an early byte to reduce upstream gateway idle timeouts.
                safeEnqueue(" ");

                const heartbeat = setInterval(() => {
                    safeEnqueue(" ");
                }, EVALUATE_STREAM_HEARTBEAT_MS);

                try {
                    for await (const chunk of streamWithTimeGuards(
                        messages as Message[],
                        contextText,
                        generationReady === true,
                        {
                            sourceContext: sourceContextText,
                            designMemory: designMemoryText,
                            diagramPolicy: normalizedDiagramPolicy,
                            outputLanguage: responseLanguage,
                            interactionMode: normalizedInteractionMode
                        }
                    )) {
                        if (chunk) {
                            fullOutput = (fullOutput + chunk).slice(-EVALUATE_FALLBACK_BUFFER_CHARS);
                        }
                        tagScanBuffer = (tagScanBuffer + chunk).slice(-8192);
                        if (!sawQuestionTag && /<question>/i.test(tagScanBuffer)) {
                            sawQuestionTag = true;
                        }

                        if (chunk.trim().length > 0) {
                            emittedMeaningfulChunk = true;
                            if (!firstChunkLogged) {
                                firstChunkLogged = true;
                                console.log(
                                    `[evaluate][${requestId}] firstChunkMs=${Date.now() - streamStartedAt}`
                                );
                            }
                        }
                        safeEnqueue(chunk);
                    }
                    console.log(
                        `[evaluate][${requestId}] completed streamedMs=${Date.now() - streamStartedAt} totalMs=${Date.now() - requestStartedAt}`
                    );
                } catch (e) {
                    if (
                        !emittedMeaningfulChunk &&
                        (isGeminiStreamParseError(e) ||
                            isUpstreamOverloadError(e))
                    ) {
                        console.warn(
                            `[evaluate][${requestId}] primaryRetryableFailure type=${getErrorDetails(e)} afterMs=${Date.now() - streamStartedAt}; retrying compact payload`
                        );
                        try {
                            const retryMessages = buildRetryMessages(messages);
                            const retryContext = contextText
                                ? clipText(contextText, EVALUATE_RETRY_CONTEXT_CHARS)
                                : undefined;
                            const retrySourceContext = sourceContextText
                                ? clipText(sourceContextText, EVALUATE_RETRY_SOURCE_CONTEXT_CHARS)
                                : undefined;
                            const retryDesignMemory = designMemoryText
                                ? clipText(designMemoryText, EVALUATE_RETRY_DESIGN_MEMORY_CHARS)
                                : undefined;

                            for await (const retryChunk of streamWithTimeGuards(
                                retryMessages,
                                retryContext,
                                generationReady === true,
                                {
                                    preferBackupModel: true,
                                    sourceContext: retrySourceContext,
                                    designMemory: retryDesignMemory,
                                    diagramPolicy: normalizedDiagramPolicy,
                                    outputLanguage: responseLanguage,
                                    interactionMode: normalizedInteractionMode
                                }
                            )) {
                                if (retryChunk.trim().length > 0) {
                                    emittedMeaningfulChunk = true;
                                    if (!firstChunkLogged) {
                                        firstChunkLogged = true;
                                        console.log(
                                            `[evaluate][${requestId}] firstChunkMs=${Date.now() - streamStartedAt} source=compactRetry`
                                        );
                                    }
                                }
                                safeEnqueue(retryChunk);
                            }
                            console.log(
                                `[evaluate][${requestId}] completedAfterRetry streamedMs=${Date.now() - streamStartedAt} totalMs=${Date.now() - requestStartedAt}`
                            );
                        } catch (retryError) {
                            console.error(
                                `[evaluate][${requestId}] compactRetryFailed type=${getErrorDetails(retryError)} afterMs=${Date.now() - streamStartedAt}`
                            );
                            enqueueQuestionFallback(
                                isUpstreamOverloadError(retryError)
                                    ? getEvaluateFallbackMessage(responseLanguage, "high_demand")
                                    : getEvaluateFallbackMessage(responseLanguage, "empty_before_content")
                            );
                            emittedMeaningfulChunk = true;
                        }
                    } else {
                        console.error(`[evaluate][${requestId}] streamingError:`, e);
                        if (!emittedMeaningfulChunk) {
                            enqueueQuestionFallback(
                                isUpstreamOverloadError(e)
                                    ? getEvaluateFallbackMessage(responseLanguage, "high_demand")
                                    : getEvaluateFallbackMessage(responseLanguage, "service_unavailable")
                            );
                            emittedMeaningfulChunk = true;
                        } else {
                            console.warn(
                                `[evaluate][${requestId}] partialStreamInterrupted afterMs=${Date.now() - streamStartedAt}; preserving partial output`
                            );
                        }
                    }
                } finally {
                    clearInterval(heartbeat);
                    if (!emittedMeaningfulChunk && !fallbackQuestionInjected) {
                        console.warn(
                            `[evaluate][${requestId}] noMeaningfulOutput streamedMs=${Date.now() - streamStartedAt} totalMs=${Date.now() - requestStartedAt}`
                        );
                        enqueueQuestionFallback(getEvaluateFallbackMessage(responseLanguage, "no_output"));
                    } else if (emittedMeaningfulChunk && !sawQuestionTag && !fallbackQuestionInjected) {
                        console.warn(
                            `[evaluate][${requestId}] missingQuestionTag injectingFallback streamedMs=${Date.now() - streamStartedAt} totalMs=${Date.now() - requestStartedAt}`
                        );
                        enqueueQuestionFallback(
                            normalizedInteractionMode === "architecture"
                                ? buildStructuredFallbackQuestion(fullOutput, responseLanguage)
                                : getEvaluateFallbackMessage(responseLanguage, "no_output")
                        );
                    }
                    if (!closed) {
                        closed = true;
                        controller.close();
                    }
                }
            }
        });

        return new Response(stream, {
            headers: {
                // Event-stream headers help intermediaries avoid buffering long responses.
                'Content-Type': 'text/event-stream; charset=utf-8',
                'Cache-Control': 'no-cache, no-transform',
                'Connection': 'keep-alive',
                'X-Accel-Buffering': 'no',
                'X-Evaluate-Request-Id': requestId
            }
        });

    } catch (error) {
        console.error(`[evaluate][${requestId}] requestError:`, error);
        const status = error instanceof RequestPayloadError ? error.status : 500;
        return NextResponse.json(
            {
                error: status === 413 ? "Evaluate request payload is too large" : "Failed to evaluate input",
                details: normalizeServerErrorDetails(getErrorDetails(error))
            },
            {
                status,
                headers: {
                    "X-Evaluate-Request-Id": requestId
                }
            }
        );
    }
}
