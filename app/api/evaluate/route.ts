
import { NextResponse } from "next/server";
import { getActiveAiProvider, streamEvaluateInput } from "@/lib/gemini";
import type { Message, Attachment } from "@/types";

const MAX_EVALUATE_BODY_CHARS = 1_200_000;
const EVALUATE_STREAM_HEARTBEAT_MS = 15_000;
const EVALUATE_MODEL_IDLE_TIMEOUT_MS = 70_000;
const EVALUATE_TOTAL_TIMEOUT_MS = 180_000;
const EVALUATE_RETRY_HISTORY_MESSAGES = 10;
const EVALUATE_RETRY_CONTENT_CHARS = 2_500;
const EVALUATE_RETRY_CONTEXT_CHARS = 3_000;
const EVALUATE_RETRY_TEXT_ATTACHMENT_CHARS = 2_000;

export const runtime = "nodejs";

type EvaluateRequestBody = {
    messages?: unknown;
    context?: unknown;
    generationReady?: unknown;
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

function isErrorWithMessage(error: unknown, message: string) {
    return error instanceof Error && error.message === message;
}

function clipText(text: string, maxChars: number) {
    if (text.length <= maxChars) return text;
    return `${text.slice(0, maxChars)}\n... [truncated]`;
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

async function* streamWithTimeGuards(
    messages: Message[],
    contextText: string | undefined,
    generationReady: boolean
) {
    const startedAt = Date.now();
    const iterator = streamEvaluateInput(messages, contextText, {
        generationReady
    })[Symbol.asyncIterator]();

    while (true) {
        if (Date.now() - startedAt > EVALUATE_TOTAL_TIMEOUT_MS) {
            throw new Error("EVALUATE_TOTAL_TIMEOUT");
        }

        const next = await withTimeout(
            iterator.next(),
            EVALUATE_MODEL_IDLE_TIMEOUT_MS,
            "EVALUATE_MODEL_IDLE_TIMEOUT"
        );

        if (next.done) {
            break;
        }

        const chunk = typeof next.value === "string" ? next.value : String(next.value ?? "");
        yield chunk;
    }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<T>((_, reject) => {
                timer = setTimeout(() => {
                    reject(new Error(timeoutMessage));
                }, timeoutMs);
            })
        ]);
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
        const { messages, context, generationReady } = await parseEvaluateRequest(req);
        const contextText = typeof context === "string" ? context : undefined;
        if (!Array.isArray(messages) || messages.length === 0) {
            return NextResponse.json({ error: "No messages provided" }, { status: 400 });
        }
        const provider = getActiveAiProvider();
        console.log(
            `[evaluate][${requestId}] start provider=${provider} messages=${messages.length} contextChars=${contextText?.length || 0} generationReady=${generationReady === true}`
        );

        const stream = new ReadableStream({
            async start(controller) {
                const encoder = new TextEncoder();
                let closed = false;
                let emittedMeaningfulChunk = false;
                let firstChunkLogged = false;
                const streamStartedAt = Date.now();

                const safeEnqueue = (chunk: string) => {
                    if (closed) return;
                    try {
                        controller.enqueue(encoder.encode(chunk));
                    } catch {
                        closed = true;
                    }
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
                        generationReady === true
                    )) {
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
                            isErrorWithMessage(e, "EVALUATE_TOTAL_TIMEOUT"))
                    ) {
                        console.warn(
                            `[evaluate][${requestId}] primaryTimeout type=${getErrorDetails(e)} afterMs=${Date.now() - streamStartedAt}; retrying compact payload`
                        );
                        try {
                            const retryMessages = buildRetryMessages(messages);
                            const retryContext = contextText
                                ? clipText(contextText, EVALUATE_RETRY_CONTEXT_CHARS)
                                : undefined;

                            for await (const retryChunk of streamWithTimeGuards(
                                retryMessages,
                                retryContext,
                                generationReady === true
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
                        } catch {
                            console.error(
                                `[evaluate][${requestId}] compactRetryFailed afterMs=${Date.now() - streamStartedAt}`
                            );
                            safeEnqueue("<question>AI response timed out. Please retry with a shorter prompt.</question>");
                            emittedMeaningfulChunk = true;
                        }
                    } else {
                        console.error(`[evaluate][${requestId}] streamingError:`, e);
                        safeEnqueue("<question>Sorry, the AI service is temporarily unavailable. Please try again in a moment.</question>");
                        emittedMeaningfulChunk = true;
                    }
                } finally {
                    clearInterval(heartbeat);
                    if (!emittedMeaningfulChunk) {
                        console.warn(
                            `[evaluate][${requestId}] noMeaningfulOutput streamedMs=${Date.now() - streamStartedAt} totalMs=${Date.now() - requestStartedAt}`
                        );
                        safeEnqueue("<question>No model output received. Please retry.</question>");
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
                'Content-Type': 'text/plain; charset=utf-8',
            }
        });

    } catch (error) {
        console.error(`[evaluate][${requestId}] requestError:`, error);
        const status = error instanceof RequestPayloadError ? error.status : 500;
        return NextResponse.json({
            error: status === 413 ? "Evaluate request payload is too large" : "Failed to evaluate input",
            details: getErrorDetails(error)
        }, { status });
    }
}
