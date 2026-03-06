
import { NextResponse } from "next/server";
import { getActiveAiProvider, streamEvaluateInput } from "@/lib/gemini";
import type { Message, Attachment } from "@/types";

const MAX_EVALUATE_BODY_CHARS = 1_200_000;
const EVALUATE_STREAM_HEARTBEAT_MS = readBoundedIntEnv("EVALUATE_STREAM_HEARTBEAT_MS", 10_000, 5_000, 20_000);
// Clamp timeout values so misconfigured env vars cannot cause multi-minute UI stalls.
const EVALUATE_MODEL_IDLE_TIMEOUT_MS = readBoundedIntEnv("EVALUATE_MODEL_IDLE_TIMEOUT_MS", 25_000, 8_000, 30_000);
const EVALUATE_TOTAL_TIMEOUT_MS = Math.max(
    readBoundedIntEnv("EVALUATE_TOTAL_TIMEOUT_MS", 70_000, 20_000, 90_000),
    EVALUATE_MODEL_IDLE_TIMEOUT_MS + 5_000
);
const EVALUATE_RETRY_HISTORY_MESSAGES = 10;
const EVALUATE_RETRY_CONTENT_CHARS = 2_500;
const EVALUATE_RETRY_CONTEXT_CHARS = 3_000;
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

function isErrorWithMessage(error: unknown, message: string) {
    return error instanceof Error && error.message === message;
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
        designMemory?: string;
        diagramPolicy?: string;
        idleTimeoutMs?: number;
        totalTimeoutMs?: number;
    }
) {
    const startedAt = Date.now();
    const idleTimeoutMs = Math.max(
        1_000,
        Math.floor(options?.idleTimeoutMs ?? EVALUATE_MODEL_IDLE_TIMEOUT_MS)
    );
    const totalTimeoutMs = Math.max(
        idleTimeoutMs + 1_000,
        Math.floor(options?.totalTimeoutMs ?? EVALUATE_TOTAL_TIMEOUT_MS)
    );
    const iterator = streamEvaluateInput(messages, contextText, {
        generationReady,
        preferBackupModel: options?.preferBackupModel === true,
        designMemory: options?.designMemory,
        diagramPolicy: options?.diagramPolicy
    })[Symbol.asyncIterator]();
    try {
        while (true) {
            const elapsedMs = Date.now() - startedAt;
            const remainingTotalMs = totalTimeoutMs - elapsedMs;
            if (remainingTotalMs <= 0) {
                throw new Error("EVALUATE_TOTAL_TIMEOUT");
            }

            // Cap each next() wait by the remaining total budget to avoid timeout overshoot.
            const nextTimeoutMs = Math.max(
                1_000,
                Math.min(idleTimeoutMs, remainingTotalMs)
            );
            const timeoutMessage =
                nextTimeoutMs < idleTimeoutMs
                    ? "EVALUATE_TOTAL_TIMEOUT"
                    : "EVALUATE_MODEL_IDLE_TIMEOUT";

            const next = await withTimeout(
                iterator.next(),
                nextTimeoutMs,
                timeoutMessage
            );

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

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const guardedPromise: Promise<
        { status: "resolved"; value: T } | { status: "rejected"; error: unknown }
    > = promise
        .then((value) => ({ status: "resolved" as const, value }))
        .catch((error) => ({ status: "rejected" as const, error }));

    try {
        const outcome = await Promise.race([
            guardedPromise,
            new Promise<{ status: "timeout" }>((resolve) => {
                timer = setTimeout(() => {
                    resolve({ status: "timeout" });
                }, timeoutMs);
            })
        ]);

        if (outcome.status === "resolved") {
            return outcome.value;
        }

        if (outcome.status === "rejected") {
            throw outcome.error;
        }

        // Keep observing the original promise so late failures stay handled after timeout.
        void guardedPromise;
        throw new Error(timeoutMessage);
    } finally {
        if (timer) clearTimeout(timer);
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
        const { messages, context, generationReady, designMemory, diagramPolicy } = await parseEvaluateRequest(req);
        const contextText = typeof context === "string" ? context : undefined;
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
        const timeoutBudget = {
            idleTimeoutMs: EVALUATE_MODEL_IDLE_TIMEOUT_MS,
            totalTimeoutMs: EVALUATE_TOTAL_TIMEOUT_MS
        };
        const messageStats = getMessageStats(messages);
        console.log(
            `[evaluate][${requestId}] start provider=${provider} messages=${messageStats.messageCount} contextChars=${contextText?.length || 0} designMemoryChars=${designMemoryText?.length || 0} diagramPolicy=${normalizedDiagramPolicy} generationReady=${generationReady === true} contentChars=${messageStats.totalContentChars} attachments=${messageStats.totalAttachments} textAttachments=${messageStats.textAttachments} binaryAttachments=${messageStats.binaryAttachments} idleTimeoutMs=${timeoutBudget.idleTimeoutMs} totalTimeoutMs=${timeoutBudget.totalTimeoutMs}`
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
                            designMemory: designMemoryText,
                            diagramPolicy: normalizedDiagramPolicy,
                            idleTimeoutMs: timeoutBudget.idleTimeoutMs,
                            totalTimeoutMs: timeoutBudget.totalTimeoutMs
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
                        (isErrorWithMessage(e, "EVALUATE_MODEL_IDLE_TIMEOUT") ||
                            isErrorWithMessage(e, "EVALUATE_TOTAL_TIMEOUT") ||
                            isGeminiStreamParseError(e) ||
                            isUpstreamOverloadError(e))
                    ) {
                        console.warn(
                            `[evaluate][${requestId}] primaryRetryableFailure type=${getErrorDetails(e)} afterMs=${Date.now() - streamStartedAt} idleTimeoutMs=${timeoutBudget.idleTimeoutMs} totalTimeoutMs=${timeoutBudget.totalTimeoutMs}; retrying compact payload`
                        );
                        try {
                            const compactRetryTimeoutBudget = timeoutBudget;
                            const retryMessages = buildRetryMessages(messages);
                            const retryContext = contextText
                                ? clipText(contextText, EVALUATE_RETRY_CONTEXT_CHARS)
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
                                    designMemory: retryDesignMemory,
                                    diagramPolicy: normalizedDiagramPolicy,
                                    idleTimeoutMs: compactRetryTimeoutBudget.idleTimeoutMs,
                                    totalTimeoutMs: compactRetryTimeoutBudget.totalTimeoutMs
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
                                `[evaluate][${requestId}] compactRetryFailed type=${getErrorDetails(retryError)} afterMs=${Date.now() - streamStartedAt} idleTimeoutMs=${timeoutBudget.idleTimeoutMs} totalTimeoutMs=${timeoutBudget.totalTimeoutMs}`
                            );
                            enqueueQuestionFallback(
                                isUpstreamOverloadError(retryError)
                                    ? "AI service is experiencing high demand. Please try again in a moment."
                                    : "AI response timed out. Please retry with a shorter prompt."
                            );
                            emittedMeaningfulChunk = true;
                        }
                    } else {
                        console.error(`[evaluate][${requestId}] streamingError:`, e);
                        enqueueQuestionFallback("Sorry, the AI service is temporarily unavailable. Please try again in a moment.");
                        emittedMeaningfulChunk = true;
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
