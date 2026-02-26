
import { NextResponse } from "next/server";
import { streamEvaluateInput } from "@/lib/gemini";

const MAX_EVALUATE_BODY_CHARS = 1_200_000;

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
                try {
                    for await (const chunk of streamEvaluateInput(messages, contextText, {
                        generationReady: generationReady === true
                    })) {
                        controller.enqueue(new TextEncoder().encode(chunk));
                    }
                    controller.close();
                } catch (e) {
                    console.error("Streaming error:", e);
                    controller.enqueue(new TextEncoder().encode(`<question>Sorry, the AI service is temporarily unavailable. Please try again in a moment.</question>`));
                    controller.close();
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
