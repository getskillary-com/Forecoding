
import { NextResponse } from "next/server";
import { generateProjectResources } from "@/lib/gemini";

export async function POST(req: Request) {
    try {
        const { summary, diagram, currentProjectTree, projectName } = await req.json();
        if (!summary) {
            return NextResponse.json({ error: "No summary provided" }, { status: 400 });
        }
        const resources = await generateProjectResources(summary, diagram, currentProjectTree, {
            projectName: typeof projectName === "string" ? projectName : undefined
        });
        return NextResponse.json(resources);
    } catch (error) {
        console.error("Generation error:", error);
        return NextResponse.json({ error: "Failed to generate resources" }, { status: 500 });
    }
}
