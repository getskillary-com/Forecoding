
import { NextResponse } from "next/server";
import { streamEvaluateInput } from "@/lib/gemini";

const MAX_EVALUATE_BODY_CHARS = 1_200_000;
const EVALUATE_STREAM_HEARTBEAT_MS = 15_000;
const EVALUATE_MODEL_IDLE_TIMEOUT_MS = 45_000;
const EVALUATE_TOTAL_TIMEOUT_MS = 120_000;

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
    try {
        const { messages, context, generationReady } = await parseEvaluateRequest(req);
        const contextText = typeof context === "string" ? context : undefined;
        if (!Array.isArray(messages) || messages.length === 0) {
            return NextResponse.json({ error: "No messages provided" }, { status: 400 });
        }

        const stream = new ReadableStream({
            async start(controller) {
                const encoder = new TextEncoder();
                let closed = false;
                let emittedMeaningfulChunk = false;
                const startedAt = Date.now();

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
                    const iterator = streamEvaluateInput(messages, contextText, {
                        generationReady: generationReady === true
                    })[Symbol.asyncIterator]();

                    while (true) {
                        if (Date.now() - startedAt > EVALUATE_TOTAL_TIMEOUT_MS) {
                            safeEnqueue("<question>AI response timed out. Please retry with a shorter prompt.</question>");
                            emittedMeaningfulChunk = true;
                            if (typeof iterator.return === "function") {
                                await iterator.return();
                            }
                            break;
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
                        if (chunk.trim().length > 0) {
                            emittedMeaningfulChunk = true;
                        }
                        safeEnqueue(chunk);
                    }
                } catch (e) {
                    if (isErrorWithMessage(e, "EVALUATE_MODEL_IDLE_TIMEOUT")) {
                        safeEnqueue("<question>AI response timed out. Please retry with a shorter prompt.</question>");
                        emittedMeaningfulChunk = true;
                    } else {
                        console.error("Streaming error:", e);
                        safeEnqueue("<question>Sorry, the AI service is temporarily unavailable. Please try again in a moment.</question>");
                        emittedMeaningfulChunk = true;
                    }
                } finally {
                    clearInterval(heartbeat);
                    if (!emittedMeaningfulChunk) {
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
        console.error("Evaluation error:", error);
        const status = error instanceof RequestPayloadError ? error.status : 500;
        return NextResponse.json({
            error: status === 413 ? "Evaluate request payload is too large" : "Failed to evaluate input",
            details: getErrorDetails(error)
        }, { status });
    }
}
