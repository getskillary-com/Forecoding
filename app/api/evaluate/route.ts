
import { NextResponse } from "next/server";
import { streamEvaluateInput } from "@/lib/gemini";

export async function POST(req: Request) {
    try {
        const { messages, context, generationReady } = await req.json();
        const contextText = typeof context === "string" ? context : undefined;
        if (!messages) {
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
        return NextResponse.json({
            error: "Failed to evaluate input",
            details: error instanceof Error ? error.message : String(error)
        }, { status: 500 });
    }
}
