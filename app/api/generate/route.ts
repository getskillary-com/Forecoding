
import { NextResponse } from "next/server";
import { generateProjectResources } from "@/lib/gemini";

type OutputLanguage = "zh" | "en";

function parseOutputLanguage(value: unknown): OutputLanguage | undefined {
    if (value === "zh" || value === "en") return value;
    return undefined;
}

export async function POST(req: Request) {
    try {
        const { summary, diagram, currentProjectTree, projectName, outputLanguage } = await req.json();
        if (!summary) {
            return NextResponse.json({ error: "No summary provided" }, { status: 400 });
        }
        const resources = await generateProjectResources(summary, diagram, currentProjectTree, {
            projectName: typeof projectName === "string" ? projectName : undefined,
            outputLanguage: parseOutputLanguage(outputLanguage)
        });
        return NextResponse.json(resources);
    } catch (error) {
        console.error("Generation error:", error);
        return NextResponse.json({ error: "Failed to generate resources" }, { status: 500 });
    }
}
