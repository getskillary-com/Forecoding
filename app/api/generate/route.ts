
import { NextResponse } from "next/server";
import { generateProjectResources } from "@/lib/gemini";

export async function POST(req: Request) {
    try {
        const { summary, diagram, currentProjectTree } = await req.json();
        if (!summary) {
            return NextResponse.json({ error: "No summary provided" }, { status: 400 });
        }
        const resources = await generateProjectResources(summary, diagram, currentProjectTree);
        return NextResponse.json(resources);
    } catch (error) {
        console.error("Generation error:", error);
        return NextResponse.json({ error: "Failed to generate resources" }, { status: 500 });
    }
}
