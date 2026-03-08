
import { NextResponse } from "next/server";
import { getActiveAiProvider, streamEvaluateInput } from "@/lib/gemini";
import type { Message, Attachment } from "@/types";

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
    designMemory?: unknown;
    diagramPolicy?: unknown;
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

function buildFallbackQuestion(output: string) {
    const missingRaw = extractTaggedSection(output, "analysis_missing");
    const missingItems = parseMissingItems(missingRaw);
    if (missingItems.length > 0) {
        const summary = missingItems.slice(0, 3).join("; ");
        const question = `Could you clarify the following so I can proceed: ${summary}?`;
        return clipText(question, EVALUATE_FALLBACK_QUESTION_MAX_CHARS);
    }
    return "Could you confirm this direction so I can proceed?";
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
    }
) {
    const iterator = streamEvaluateInput(messages, contextText, {
        generationReady,
        preferBackupModel: options?.preferBackupModel === true,
        sourceContext: options?.sourceContext,
        designMemory: options?.designMemory,
        diagramPolicy: options?.diagramPolicy
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
        const { messages, context, sourceContext, generationReady, designMemory, diagramPolicy } = await parseEvaluateRequest(req);
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
            `[evaluate][${requestId}] start provider=${provider} messages=${messageStats.messageCount} contextChars=${contextText?.length || 0} sourceContextChars=${sourceContextText?.length || 0} designMemoryChars=${designMemoryText?.length || 0} diagramPolicy=${normalizedDiagramPolicy} generationReady=${generationReady === true} contentChars=${messageStats.totalContentChars} attachments=${messageStats.totalAttachments} textAttachments=${messageStats.textAttachments} binaryAttachments=${messageStats.binaryAttachments}`
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

                const enqueueQuestionFallback = (message: string) => {
                    safeEnqueue(`<question>${message} (ref: ${requestId})</question>`);
                    fallbackQuestionInjected = true;
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
                            diagramPolicy: normalizedDiagramPolicy
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
                                    diagramPolicy: normalizedDiagramPolicy
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
                                    ? "AI service is experiencing high demand. Please try again in a moment."
                                    : "AI response failed before any content was returned. Please retry."
                            );
                            emittedMeaningfulChunk = true;
                        }
                    } else {
                        console.error(`[evaluate][${requestId}] streamingError:`, e);
                        if (!emittedMeaningfulChunk) {
                            enqueueQuestionFallback(
                                isUpstreamOverloadError(e)
                                    ? "AI service is experiencing high demand. Please try again in a moment."
                                    : "Sorry, the AI service is temporarily unavailable. Please try again in a moment."
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
                        enqueueQuestionFallback("No model output received. Please retry.");
                    } else if (emittedMeaningfulChunk && !sawQuestionTag && !fallbackQuestionInjected) {
                        console.warn(
                            `[evaluate][${requestId}] missingQuestionTag streamedMs=${Date.now() - streamStartedAt} totalMs=${Date.now() - requestStartedAt}`
                        );
                        enqueueQuestionFallback(buildFallbackQuestion(fullOutput));
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
