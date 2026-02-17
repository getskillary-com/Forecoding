
import { NextRequest } from "next/server";
import { runBatchAnalysis } from "@/lib/batch-processing";

export const runtime = 'nodejs'; // Use nodejs for potentially long running process? 
// Actually, edge might be better for streaming, but Gemini SDK is node.
// We'll stick to default (nodejs) and manual streaming.

export async function POST(req: NextRequest) {
    const { projectTree, goal } = await req.json();

    if (!projectTree || !goal) {
        return new Response("Missing projectTree or goal", { status: 400 });
    }

    const stream = new ReadableStream({
        async start(controller) {
            const encoder = new TextEncoder();

            try {
                // Run the generator
                for await (const update of runBatchAnalysis(projectTree, goal)) {
                    // Format: "type: content"
                    // If it's the final report, it comes after "DONE"
                    // But our generator yields "DONE" then "REPORT"

                    if (update === "DONE") {
                        // Signal completion of processing phase
                        controller.enqueue(encoder.encode(`event: done\ndata: true\n\n`));
                    } else if (update.startsWith("Processing") || update.startsWith("Consolidating")) {
                        // Progress update
                        controller.enqueue(encoder.encode(`event: progress\ndata: ${JSON.stringify(update)}\n\n`));
                    } else {
                        // Final Report content (large chunk)
                        controller.enqueue(encoder.encode(`event: report\ndata: ${JSON.stringify(update)}\n\n`));
                    }
                }

                controller.close();
            } catch (error) {
                console.error("Batch processing error:", error);
                controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify(String(error))}\n\n`));
                controller.close();
            }
        }
    });

    return new Response(stream, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    });
}
