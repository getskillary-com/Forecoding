
import { NextResponse } from "next/server";
import {
    buildArchitecturePackScaffoldInput,
    createReadinessChecklist,
    normalizeArchitecturePack,
    normalizeDecisionRecords,
    normalizeGuardrailChecklist
} from "@/lib/architecture";
import { generateProjectResources } from "@/lib/gemini";

type OutputLanguage = "zh" | "en";
type OneClickMode = "strict_build_v1";
type IdeProfile = "generic";
type TemplateKindHint = "next_root" | "next_src" | "monorepo_multiapp";

const MAX_GENERATE_SUMMARY_CHARS = Math.min(
    200_000,
    Math.max(
        4_000,
        Number.parseInt(process.env.GENERATE_MAX_SUMMARY_CHARS || "", 10) || 50_000
    )
);
const MAX_GENERATE_DIAGRAM_CHARS = Math.min(
    100_000,
    Math.max(
        1_000,
        Number.parseInt(process.env.GENERATE_MAX_DIAGRAM_CHARS || "", 10) || 16_000
    )
);

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

function clipText(text: string, maxChars: number) {
    if (text.length <= maxChars) return text;
    return `${text.slice(0, maxChars)}\n... [truncated]`;
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
            templateKindHint,
            architecturePack,
            decisionRecords,
            guardrailChecklist
        } = await req.json();
        if (!architecturePack || typeof architecturePack !== "object") {
            return NextResponse.json(
                { error: "Architecture pack is required before scaffold generation." },
                { status: 400 }
            );
        }
        const normalizedArchitecturePack = normalizeArchitecturePack(architecturePack);
        const normalizedDecisionRecords = normalizeDecisionRecords(decisionRecords);
        const normalizedGuardrailChecklist = normalizeGuardrailChecklist(guardrailChecklist);
        const readiness = createReadinessChecklist(
            normalizedArchitecturePack,
            normalizedDecisionRecords,
            normalizedGuardrailChecklist
        );
        if (!readiness.functionalReady || !readiness.uiReady) {
            return NextResponse.json(
                {
                    error: "Architecture pack is not ready for scaffold generation.",
                    blockingIssues: readiness.blockingIssues,
                    readiness
                },
                { status: 409 }
            );
        }
        const renderedSummary = buildArchitecturePackScaffoldInput(
            normalizedArchitecturePack,
            normalizedDecisionRecords,
            normalizedGuardrailChecklist
        );
        const normalizedSummary = clipText(
            renderedSummary || String(summary || "").trim(),
            MAX_GENERATE_SUMMARY_CHARS
        );
        const normalizedDiagram =
            typeof diagram === "string" && diagram.trim()
                ? clipText(diagram.trim(), MAX_GENERATE_DIAGRAM_CHARS)
                : undefined;
        const parsedOneClickMode = parseOneClickMode(oneClickMode);
        const parsedIdeProfile = parseIdeProfile(ideProfile);
        const parsedTemplateKindHint = parseTemplateKindHint(templateKindHint);
        const parsedOutputLanguage = parseOutputLanguage(outputLanguage);
        console.info(
            `[generate] request outputLanguage=${parsedOutputLanguage || "auto"} oneClickMode=${parsedOneClickMode || "strict_build_v1(default)"} ideProfile=${parsedIdeProfile || "generic(default)"} templateKindHint=${parsedTemplateKindHint || "auto"}`
        );
        const resources = await generateProjectResources(normalizedSummary, normalizedDiagram, currentProjectTree, {
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
                error: isPreflight
                    ? "Scaffold preflight failed"
                    : "Failed to generate resources",
                details
            },
            { status: isPreflight ? 422 : 500 }
        );
    }
}
