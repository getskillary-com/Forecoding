
import { NextResponse } from "next/server";
import {
    buildStructuredGenerationContext,
    buildArchitecturePackScaffoldInput,
    normalizeArchitecturePack,
    normalizeDecisionRecords,
    normalizeGuardrailChecklist
} from "@/lib/architecture";
import { generateProjectResources } from "@/lib/gemini";
import { isAdminUser } from "@/lib/admin";
import { getWorkspaceByUserId } from "@/lib/data/workspaces";
import { getServerUser } from "@/lib/server-auth";
import {
    buildScaffoldEligibilityErrorMessage,
    computeVersionScaffoldEligibility
} from "@/lib/scaffold-eligibility";
import { getProjectWorkspaceLanguage, normalizeProjects } from "@/lib/project-language";
import type { OutputMode, Project } from "@/types";

type OutputLanguage = "zh" | "en";
type OneClickMode = "strict_build_v1";
type IdeProfile = "generic";
type TemplateKindHint = "next_root" | "next_src" | "monorepo_multiapp";

type GenerateRequestBody = {
    summary?: unknown;
    diagram?: unknown;
    currentProjectTree?: unknown;
    projectName?: unknown;
    outputLanguage?: unknown;
    outputMode?: unknown;
    oneClickMode?: unknown;
    ideProfile?: unknown;
    templateKindHint?: unknown;
    projectId?: unknown;
    versionId?: unknown;
};

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

function parseOutputMode(value: unknown): OutputMode | undefined {
    if (value === "virtual_spec" || value === "runnable_scaffold") return value;
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

function sanitizeText(value: unknown) {
    return typeof value === "string" ? value.trim().slice(0, 160) : "";
}

function parseProjects(raw: unknown): Project[] {
    return normalizeProjects(raw);
}

function resolveProjectVersion(projects: Project[], projectId: string, versionId: string) {
    for (const project of projects) {
        if (project.id !== projectId) continue;
        const version = project.versions.find((candidate) => candidate.id === versionId) || null;
        if (version) {
            return { project, version };
        }
    }

    return null;
}

export async function POST(req: Request) {
    try {
        const user = await getServerUser();
        if (!user?.uid) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const body = (await req.json()) as GenerateRequestBody;
        const projectId = sanitizeText(body.projectId);
        const versionId = sanitizeText(body.versionId);
        if (!projectId || !versionId) {
            return NextResponse.json(
                { error: "projectId and versionId are required before scaffold generation." },
                { status: 400 }
            );
        }

        const workspace = await getWorkspaceByUserId(user.uid);
        const projects = parseProjects(workspace?.projects);
        const resolved = resolveProjectVersion(projects, projectId, versionId);
        if (!resolved) {
            return NextResponse.json(
                { error: "Project version not found for scaffold generation." },
                { status: 404 }
            );
        }

        const { project, version } = resolved;
        const parsedOutputMode = parseOutputMode(body.outputMode) || "runnable_scaffold";
        const eligibility = computeVersionScaffoldEligibility(version.data, parsedOutputMode);
        if (!eligibility.canGenerate) {
            return NextResponse.json(
                {
                    error: buildScaffoldEligibilityErrorMessage(eligibility),
                    code: eligibility.code,
                    blockingReasons: eligibility.blockingReasons,
                    readiness: eligibility.readiness
                },
                { status: 409 }
            );
        }

        const hasPaid = version.data.paymentStatus === "paid";
        const isAdmin = isAdminUser({ email: user.email });
        if (!hasPaid && !isAdmin) {
            return NextResponse.json(
                {
                    error: "Payment required before scaffold generation.",
                    code: "PAYMENT_REQUIRED"
                },
                { status: 402 }
            );
        }

        const architecturePack = version.data.architecturePack;
        const decisionRecords = version.data.decisionRecords;
        const guardrailChecklist = version.data.guardrailChecklist;
        const normalizedArchitecturePack = normalizeArchitecturePack(architecturePack);
        const normalizedDecisionRecords = normalizeDecisionRecords(decisionRecords);
        const normalizedGuardrailChecklist = normalizeGuardrailChecklist(guardrailChecklist);
        const generationContext = buildStructuredGenerationContext(
            normalizedArchitecturePack,
            normalizedDecisionRecords,
            normalizedGuardrailChecklist
        );
        const renderedSummary = buildArchitecturePackScaffoldInput(
            normalizedArchitecturePack,
            normalizedDecisionRecords,
            normalizedGuardrailChecklist
        );
        const normalizedSummary = clipText(
            renderedSummary,
            MAX_GENERATE_SUMMARY_CHARS
        );
        const normalizedDiagram =
            typeof version.data.currentDiagram === "string" && version.data.currentDiagram.trim()
                ? clipText(version.data.currentDiagram.trim(), MAX_GENERATE_DIAGRAM_CHARS)
                : undefined;
        const parsedOneClickMode = parseOneClickMode(body.oneClickMode);
        const parsedIdeProfile = parseIdeProfile(body.ideProfile);
        const parsedTemplateKindHint = parseTemplateKindHint(body.templateKindHint);
        const parsedOutputLanguage = parseOutputLanguage(body.outputLanguage) || getProjectWorkspaceLanguage(project);
        console.info(
            `[generate] request outputMode=${parsedOutputMode} outputLanguage=${parsedOutputLanguage || "auto"} oneClickMode=${parsedOneClickMode || "strict_build_v1(default)"} ideProfile=${parsedIdeProfile || "generic(default)"} templateKindHint=${parsedTemplateKindHint || "auto"}`
        );
        const resources = await generateProjectResources(normalizedSummary, normalizedDiagram, version.data.generation?.projectTree, {
            projectName: project.name || sanitizeText(body.projectName) || undefined,
            outputLanguage: parsedOutputLanguage,
            outputMode: parsedOutputMode,
            oneClickMode: parsedOneClickMode,
            ideProfile: parsedIdeProfile,
            templateKindHint: parsedTemplateKindHint,
            generationContext
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
