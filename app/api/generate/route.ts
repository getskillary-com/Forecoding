
import { NextResponse } from "next/server";
import { generateProjectResources } from "@/lib/gemini";

type OutputLanguage = "zh" | "en";
type OneClickMode = "strict_build_v1";
type IdeProfile = "generic";
type TemplateKindHint = "next_root" | "next_src" | "monorepo_multiapp";

function parseOutputLanguage(value: unknown): OutputLanguage | undefined {
    if (value === "zh" || value === "en") return value;
    return undefined;
}

function parseOneClickMode(value: unknown): OneClickMode | undefined {
    if (value === "strict_build_v1") return value;
    return undefined;
}

function parseIdeProfile(value: unknown): IdeProfile | undefined {
    if (value === "generic") return value;
    return undefined;
}

function parseTemplateKindHint(value: unknown): TemplateKindHint | undefined {
    if (value === "next_root" || value === "next_src" || value === "monorepo_multiapp") return value;
    return undefined;
}

export async function POST(req: Request) {
    try {
        const {
            summary,
            diagram,
            currentProjectTree,
            projectName,
            outputLanguage,
            oneClickMode,
            ideProfile,
            templateKindHint
        } = await req.json();
        if (!summary) {
            return NextResponse.json({ error: "No summary provided" }, { status: 400 });
        }
        const parsedOneClickMode = parseOneClickMode(oneClickMode);
        const parsedIdeProfile = parseIdeProfile(ideProfile);
        const parsedTemplateKindHint = parseTemplateKindHint(templateKindHint);
        const parsedOutputLanguage = parseOutputLanguage(outputLanguage);
        console.info(
            `[generate] request outputLanguage=${parsedOutputLanguage || "auto"} oneClickMode=${parsedOneClickMode || "strict_build_v1(default)"} ideProfile=${parsedIdeProfile || "generic(default)"} templateKindHint=${parsedTemplateKindHint || "auto"}`
        );
        const resources = await generateProjectResources(summary, diagram, currentProjectTree, {
            projectName: typeof projectName === "string" ? projectName : undefined,
            outputLanguage: parsedOutputLanguage,
            oneClickMode: parsedOneClickMode,
            ideProfile: parsedIdeProfile,
            templateKindHint: parsedTemplateKindHint
        });
        const preflight = resources.preflightReport;
        if (preflight) {
            console.info(
                `[generate] preflight pass=${preflight.pass} planCoveragePct=${preflight.planCoveragePct} nextConfigValid=${preflight.nextConfigValid} envExamplePresent=${preflight.envExamplePresent} pathNormalizationFixCount=${preflight.pathNormalizationFixCount} manifestTaskCount=${preflight.manifestTaskCount} missingDepsCount=${preflight.missingDepsCount}`
            );
            if (!preflight.pass) {
                const codes = (Array.isArray(preflight.issues) ? preflight.issues : [])
                    .map((issue: { code?: string }) => issue.code || "")
                    .filter(Boolean)
                    .join(", ");
                return NextResponse.json(
                    {
                        error: "Scaffold preflight failed",
                        details: codes || "Unknown preflight error"
                    },
                    { status: 422 }
                );
            }
        }
        return NextResponse.json(resources);
    } catch (error) {
        console.error("Generation error:", error);
        const details = error instanceof Error ? error.message : "Unknown error";
        const isPreflight = /Scaffold preflight failed/i.test(details);
        return NextResponse.json(
            {
                error: isPreflight ? "Scaffold preflight failed" : "Failed to generate resources",
                details
            },
            { status: isPreflight ? 422 : 500 }
        );
    }
}
