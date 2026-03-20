
import { NextResponse } from "next/server";
import {
    buildStructuredGenerationContext,
    buildArchitecturePackScaffoldInput,
    normalizeArchitecturePack,
    normalizeDecisionRecords,
    normalizeGuardrailChecklist,
    normalizeReadinessOverrides
} from "@/lib/architecture";
import { deriveArchitectureDiagramMermaid } from "@/lib/architecture-diagram";
import { generateProjectResources } from "@/lib/gemini";
import {
    inferTemplateKindFromProjectTree,
    resolveGenerateJobContract,
    type GenerateJobContractIssue
} from "@/lib/generate-contract";
import { isAdminUser } from "@/lib/admin";
import { createGenerationJob, updateGenerationJob } from "@/lib/data/generation-jobs";
import { isFeatureFlagEnabledForContext } from "@/lib/data/feature-flags";
import {
    getWorkspaceByUserId,
    updateProjectVersionInWorkspaceByUserId,
    WorkspaceRevisionConflictError
} from "@/lib/data/workspaces";
import { getServerUser } from "@/lib/server-auth";
import {
    buildScaffoldEligibilityErrorMessage,
    computeVersionScaffoldEligibility
} from "@/lib/scaffold-eligibility";
import { getProjectWorkspaceLanguage, normalizeProjects } from "@/lib/project-language";
import type {
    ArtifactManifest,
    ArtifactManifestEntry,
    ContractCoverage,
    FileNode,
    OutputMode,
    Project,
    ProjectVersion,
    ProjectVersionData,
    RemediationHint,
    GenerationArtifacts,
    GenerationResponse,
    TemplateKind
} from "@/types";

export const runtime = "nodejs";

type OutputLanguage = "zh" | "en";
type OneClickMode = "strict_build_v1";
type IdeProfile = "generic";

type GenerateRequestBody = {
    summary?: unknown;
    diagram?: unknown;
    currentProjectTree?: unknown;
    projectName?: unknown;
    outputLanguage?: unknown;
    outputMode?: unknown;
    oneClickMode?: unknown;
    ideProfile?: unknown;
    templateKind?: unknown;
    templateKindHint?: unknown;
    projectId?: unknown;
    versionId?: unknown;
    workspaceSnapshotId?: unknown;
    expectedRevision?: unknown;
    releaseIntent?: unknown;
    architecturePack?: unknown;
    decisionRecords?: unknown;
    guardrailChecklist?: unknown;
    readinessOverrides?: unknown;
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
const GENERATE_STREAM_HEARTBEAT_MS = 10_000;

type GenerateErrorPayload = {
    error: string;
    details: string;
    code: string;
    status: number;
    remediationHints?: RemediationHint[];
    generationJobId?: string;
};

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

function clipText(text: string, maxChars: number) {
    if (text.length <= maxChars) return text;
    return `${text.slice(0, maxChars)}\n... [truncated]`;
}

function sanitizeText(value: unknown) {
    return typeof value === "string" ? value.trim().slice(0, 160) : "";
}

function parseExpectedRevision(value: unknown): number | null {
    if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
        return value;
    }
    if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) return null;
        const parsed = Number.parseInt(trimmed, 10);
        if (Number.isInteger(parsed) && parsed >= 0) {
            return parsed;
        }
    }
    return null;
}

function flattenProjectTree(nodes: FileNode[], parentPath = ""): ArtifactManifestEntry[] {
    const entries: ArtifactManifestEntry[] = [];

    for (const node of nodes) {
        const path = parentPath ? `${parentPath}/${node.name}` : node.name;
        entries.push({
            path,
            nodeType: node.type === "folder" ? "folder" : "file"
        });

        if (node.type === "folder" && Array.isArray(node.children) && node.children.length > 0) {
            entries.push(...flattenProjectTree(node.children, path));
        }
    }

    return entries;
}

function buildArtifactManifest(input: {
    workspaceSnapshotId: string;
    projectId: string;
    versionId: string;
    outputMode: OutputMode;
    templateKind?: TemplateKind | null;
    projectTree: FileNode[];
    generationManifest?: {
        files?: Array<{
            path: string;
            contentKind?: ArtifactManifestEntry["contentKind"];
            promptPath?: string;
        }>;
    } | null;
}): ArtifactManifest {
    const treeEntries = flattenProjectTree(input.projectTree);
    const manifestFiles = new Map(
        (input.generationManifest?.files || [])
            .filter((file) => Boolean(file.path))
            .map((file) => [file.path, file])
    );

    const files = treeEntries.map((entry) => {
        const manifestFile = manifestFiles.get(entry.path);
        return {
            ...entry,
            contentKind: manifestFile?.contentKind,
            promptPath: manifestFile?.promptPath
        };
    });

    return {
        version: "artifact_manifest_v1",
        workspaceSnapshotId: input.workspaceSnapshotId,
        projectId: input.projectId,
        versionId: input.versionId,
        outputMode: input.outputMode,
        templateKind: input.templateKind ?? null,
        generatedAt: Date.now(),
        fileCount: files.length,
        files
    };
}

function buildContractCoverage(contractCount: number): ContractCoverage {
    if (contractCount <= 0) {
        return {
            status: "unknown",
            contractCount: 0,
            notes: ["No structured integration contracts were available in the architecture pack."]
        };
    }

    return {
        status: "covered",
        contractCount,
        notes: [`${contractCount} integration contract(s) were carried into scaffold generation.`]
    };
}

function buildUpdatedGenerationArtifacts(
    currentArtifacts: GenerationArtifacts | undefined,
    outputMode: OutputMode,
    generation: GenerationResponse
): GenerationArtifacts {
    const nextArtifacts: GenerationArtifacts = {
        ...(currentArtifacts || {})
    };

    if (outputMode === "virtual_spec") {
        nextArtifacts.virtual_spec = generation;
    } else {
        nextArtifacts.runnable_scaffold = generation;
    }

    return nextArtifacts;
}

function uniqueRemediationHints(...groups: Array<RemediationHint[] | undefined>): RemediationHint[] {
    const dedupe = new Map<string, RemediationHint>();

    for (const group of groups) {
        for (const hint of group || []) {
            const key = `${hint.code}::${hint.message}`;
            if (!dedupe.has(key)) {
                dedupe.set(key, hint);
            }
        }
    }

    return Array.from(dedupe.values()).slice(0, 12);
}

function buildPreflightRemediationHints(
    preflight?: {
        issues?: Array<{ code: string; severity: "warning" | "error"; message: string }>;
    } | null
): RemediationHint[] {
    return (preflight?.issues || []).map((issue) => ({
        code: issue.code,
        severity: issue.severity === "error" ? "error" : "warning",
        message: issue.message,
        action: "Resolve the reported preflight issue before retrying generation.",
        autoFixable: false
    }));
}

function buildContractRemediationHints(issues: GenerateJobContractIssue[]): RemediationHint[] {
    return issues.map((issue) => ({
        code: issue.code,
        severity: issue.severity,
        message: issue.message,
        action: issue.severity === "error"
            ? "Update the request payload so all required generation contract fields are present."
            : "Prefer sending explicit workspaceSnapshotId, outputMode, templateKind, and releaseIntent in the request payload.",
        autoFixable: false
    }));
}

function buildFailureRemediationHints(failure: GenerateErrorPayload): RemediationHint[] {
    return [
        {
            code: failure.code,
            severity: failure.status >= 500 ? "error" : "warning",
            message: failure.details || failure.error,
            action: failure.code === "SCAFFOLD_PREFLIGHT_FAILED"
                ? "Review the preflight findings and retry after fixing the blocking issues."
                : failure.code === "WORKSPACE_REVISION_CONFLICT"
                ? "Refresh workspace state, reconcile the latest revision, and retry generation with an updated expectedRevision."
                : "Retry generation after checking the latest architecture pack and environment configuration.",
            autoFixable: false
        }
    ];
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

function pickLatestVersionId(project: Project): string | null {
    if (!Array.isArray(project.versions) || project.versions.length === 0) {
        return null;
    }
    const sorted = [...project.versions].sort((left, right) => right.createdAt - left.createdAt);
    return sorted[0]?.id || null;
}

function pickVersionIdForProject(project: Project, preferredVersionIds: string[]): string | null {
    const preferredMatches = project.versions
        .filter((version) => preferredVersionIds.includes(version.id))
        .sort((left, right) => right.createdAt - left.createdAt);

    if (preferredMatches.length > 0) {
        return preferredMatches[0]?.id || null;
    }

    return pickLatestVersionId(project);
}

type ProjectVersionReferenceResolution =
    | { ok: true; projectId: string; versionId: string }
    | { ok: false; status: number; error: string };

function resolveProjectVersionReference(input: {
    projects: Project[];
    requestedProjectId: string;
    requestedVersionId: string;
    preferredVersionIds: string[];
}): ProjectVersionReferenceResolution {
    const { projects, requestedProjectId, requestedVersionId, preferredVersionIds } = input;

    if (requestedProjectId && requestedVersionId) {
        return {
            ok: true,
            projectId: requestedProjectId,
            versionId: requestedVersionId
        };
    }

    if (requestedProjectId) {
        const project = projects.find((candidate) => candidate.id === requestedProjectId);
        if (!project) {
            return {
                ok: false,
                status: 404,
                error: "Requested project was not found in this workspace."
            };
        }
        const versionId = requestedVersionId || pickVersionIdForProject(project, preferredVersionIds);
        if (!versionId) {
            return {
                ok: false,
                status: 404,
                error: "Requested project has no available versions for generation."
            };
        }
        return {
            ok: true,
            projectId: project.id,
            versionId
        };
    }

    if (requestedVersionId) {
        const matches = projects.filter((project) => project.versions.some((version) => version.id === requestedVersionId));
        if (matches.length === 1) {
            return {
                ok: true,
                projectId: matches[0].id,
                versionId: requestedVersionId
            };
        }
        if (matches.length > 1) {
            return {
                ok: false,
                status: 409,
                error: "The requested versionId exists in multiple projects. Provide projectId explicitly."
            };
        }
        return {
            ok: false,
            status: 404,
            error: "Requested versionId was not found in this workspace."
        };
    }

    if (projects.length === 1) {
        const project = projects[0];
        const versionId = pickVersionIdForProject(project, preferredVersionIds);
        if (!versionId) {
            return {
                ok: false,
                status: 404,
                error: "The only project in this workspace has no available versions."
            };
        }
        return {
            ok: true,
            projectId: project.id,
            versionId
        };
    }

    if (preferredVersionIds.length === 1) {
        const preferredVersionId = preferredVersionIds[0];
        const project = projects.find((candidate) => candidate.versions.some((version) => version.id === preferredVersionId));
        if (project) {
            return {
                ok: true,
                projectId: project.id,
                versionId: preferredVersionId
            };
        }
    }

    return {
        ok: false,
        status: 400,
        error: "projectId and versionId are required when workspace resolution is ambiguous."
    };
}

function buildGenerateFailurePayload(error: unknown): GenerateErrorPayload {
    const details = error instanceof Error ? error.message : "Unknown error";
    const isRevisionConflict = error instanceof WorkspaceRevisionConflictError;
    const isPreflight = /Scaffold preflight failed/i.test(details);
    const isTimeout = /timeout/i.test(details);

    return {
        error: isRevisionConflict
            ? "Workspace revision conflict"
            : isPreflight
            ? "Scaffold preflight failed"
            : "Failed to generate resources",
        details,
        code: isRevisionConflict
            ? "WORKSPACE_REVISION_CONFLICT"
            : isPreflight
            ? "SCAFFOLD_PREFLIGHT_FAILED"
            : isTimeout
            ? "GENERATION_TIMEOUT"
            : "GENERATION_FAILED",
        status: isRevisionConflict ? 409 : isPreflight ? 422 : isTimeout ? 504 : 500,
        remediationHints: buildFailureRemediationHints({
            error: isRevisionConflict
                ? "Workspace revision conflict"
                : isPreflight
                ? "Scaffold preflight failed"
                : "Failed to generate resources",
            details,
            code: isRevisionConflict
                ? "WORKSPACE_REVISION_CONFLICT"
                : isPreflight
                ? "SCAFFOLD_PREFLIGHT_FAILED"
                : isTimeout
                ? "GENERATION_TIMEOUT"
                : "GENERATION_FAILED",
            status: isRevisionConflict ? 409 : isPreflight ? 422 : isTimeout ? 504 : 500
        })
    };
}

function createKeepAliveJsonStream(executor: () => Promise<unknown>) {
    return new ReadableStream({
        async start(controller) {
            const encoder = new TextEncoder();
            let closed = false;

            const safeEnqueue = (chunk: string) => {
                if (closed) return;
                try {
                    controller.enqueue(encoder.encode(chunk));
                } catch {
                    closed = true;
                }
            };

            // Keep long-running AI generation requests alive through the CDN/origin chain.
            safeEnqueue(" ");
            const heartbeat = setInterval(() => {
                safeEnqueue(" ");
            }, GENERATE_STREAM_HEARTBEAT_MS);

            try {
                const payload = await executor();
                safeEnqueue(JSON.stringify(payload));
            } catch (error) {
                console.error("Generation error:", error);
                safeEnqueue(JSON.stringify(buildGenerateFailurePayload(error)));
            } finally {
                clearInterval(heartbeat);
                if (!closed) {
                    try {
                        controller.close();
                    } catch {
                        closed = true;
                    }
                }
            }
        }
    });
}

export async function POST(req: Request) {
    try {
        const user = await getServerUser();
        if (!user?.uid) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const body = (await req.json()) as GenerateRequestBody;
        const requestedProjectId = sanitizeText(body.projectId);
        const requestedVersionId = sanitizeText(body.versionId);
        const requestedSnapshotId = sanitizeText(body.workspaceSnapshotId);

        const workspace = await getWorkspaceByUserId(user.uid);
        const projects = parseProjects(workspace?.projects);
        const preferredSnapshot =
            (requestedSnapshotId
                ? workspace?.envelope?.snapshots.find((snapshot) => snapshot.id === requestedSnapshotId)
                : null)
            || workspace?.envelope?.snapshots[0]
            || null;
        const preferredVersionIds = Array.isArray(preferredSnapshot?.activeVersionIds)
            ? preferredSnapshot.activeVersionIds.filter((candidate): candidate is string => typeof candidate === "string" && candidate.trim().length > 0)
            : [];
        const referenceResolution = resolveProjectVersionReference({
            projects,
            requestedProjectId,
            requestedVersionId,
            preferredVersionIds
        });
        if (!referenceResolution.ok) {
            return NextResponse.json(
                {
                    error: referenceResolution.error,
                    code: "GENERATE_PROJECT_REFERENCE_UNRESOLVED"
                },
                { status: referenceResolution.status }
            );
        }
        const projectId = referenceResolution.projectId;
        const versionId = referenceResolution.versionId;
        const resolved = resolveProjectVersion(projects, projectId, versionId);
        if (!resolved) {
            return NextResponse.json(
                { error: "Project version not found for scaffold generation." },
                { status: 404 }
            );
        }

        const { project, version } = resolved;
        const requestVersionData: ProjectVersionData = {
            ...version.data,
            architecturePack: normalizeArchitecturePack(body.architecturePack ?? version.data.architecturePack),
            decisionRecords: normalizeDecisionRecords(body.decisionRecords ?? version.data.decisionRecords),
            guardrailChecklist: normalizeGuardrailChecklist(body.guardrailChecklist ?? version.data.guardrailChecklist),
            readinessOverrides: normalizeReadinessOverrides(body.readinessOverrides ?? version.data.readinessOverrides)
        };
        const previousProjectTree = Array.isArray(version.data.generation?.projectTree)
            ? version.data.generation.projectTree
            : Array.isArray(version.data.generationArtifacts?.virtual_spec?.projectTree)
            ? version.data.generationArtifacts.virtual_spec.projectTree
            : undefined;
        const requestProjectTree = Array.isArray(body.currentProjectTree)
            ? body.currentProjectTree as FileNode[]
            : previousProjectTree;
        const fallbackSnapshotId =
            requestedSnapshotId ||
            preferredSnapshot?.id ||
            workspace?.envelope?.snapshots[0]?.id ||
            `${user.uid}:${projectId}:${versionId}:snapshotless`;
        const expectedRevision = parseExpectedRevision(body.expectedRevision);
        const contractResult = resolveGenerateJobContract(body, {
            workspaceSnapshotId: fallbackSnapshotId,
            outputMode: "virtual_spec",
            templateKind: inferTemplateKindFromProjectTree(requestProjectTree) || "next_root",
            releaseIntent: `generate:${projectId}:${versionId}`
        }, {
            strict: true
        });
        const contractRemediationHints = buildContractRemediationHints(contractResult.issues);
        if (!contractResult.ok) {
            return NextResponse.json(
                {
                    error: "Generate request contract validation failed.",
                    code: "GENERATE_CONTRACT_INVALID",
                    details: contractResult.issues.map((issue) => issue.message).join(" | "),
                    remediationHints: contractRemediationHints
                },
                { status: 400 }
            );
        }
        const parsedOutputMode = contractResult.contract.outputMode;
        const parsedTemplateKind = contractResult.contract.templateKind;
        const workspaceSnapshotId = contractResult.contract.workspaceSnapshotId;
        const releaseIntent = contractResult.contract.releaseIntent;
        const eligibility = computeVersionScaffoldEligibility(requestVersionData, parsedOutputMode);
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
        const tenantId = user.tenantId ?? null;
        const tenantStatus = user.tenantStatus ?? null;
        if (tenantStatus === "suspended" && !isAdmin) {
            return NextResponse.json(
                {
                    error: "Generation is blocked because this tenant is suspended.",
                    code: "TENANT_SUSPENDED",
                    remediationHints: [
                        {
                            code: "TENANT_SUSPENDED",
                            severity: "error",
                            message: `Tenant ${tenantId || "unknown"} is currently suspended.`,
                            action: "Ask an admin to reactivate the tenant before retrying generation.",
                            autoFixable: false
                        }
                    ]
                },
                { status: 423 }
            );
        }
        const generationEnabled = await isFeatureFlagEnabledForContext({
            key: "generation.enabled",
            fallback: true,
            tenantId,
            workspaceId: user.uid
        });
        if (!generationEnabled && !isAdmin) {
            return NextResponse.json(
                {
                    error: "Generation is currently disabled by platform governance.",
                    code: "GENERATION_DISABLED",
                    remediationHints: [
                        {
                            code: "GENERATION_DISABLED",
                            severity: "warning",
                            message: "A platform feature flag has disabled scaffold generation.",
                            action: "Ask an operator or admin to enable generation.enabled before retrying.",
                            autoFixable: false
                        }
                    ]
                },
                { status: 423 }
            );
        }

        if (!hasPaid && !isAdmin) {
            return NextResponse.json(
                {
                    error: "Payment required before scaffold generation.",
                    code: "PAYMENT_REQUIRED"
                },
                { status: 402 }
            );
        }

        const normalizedArchitecturePack = normalizeArchitecturePack(requestVersionData.architecturePack);
        const normalizedDecisionRecords = normalizeDecisionRecords(requestVersionData.decisionRecords);
        const normalizedGuardrailChecklist = normalizeGuardrailChecklist(requestVersionData.guardrailChecklist);
        const parsedOutputLanguage = parseOutputLanguage(body.outputLanguage) || getProjectWorkspaceLanguage(project);
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
        const derivedDiagram = deriveArchitectureDiagramMermaid({
            architecturePack: normalizedArchitecturePack,
            decisionRecords: normalizedDecisionRecords,
            guardrailChecklist: normalizedGuardrailChecklist,
            language: parsedOutputLanguage,
            fallbackDiagram: typeof body.diagram === "string"
                ? body.diagram.trim()
                : typeof version.data.currentDiagram === "string"
                ? version.data.currentDiagram.trim()
                : ""
        });
        const normalizedDiagram = derivedDiagram
            ? clipText(derivedDiagram, MAX_GENERATE_DIAGRAM_CHARS)
            : undefined;
        const parsedOneClickMode = parseOneClickMode(body.oneClickMode);
        const parsedIdeProfile = parseIdeProfile(body.ideProfile);
        const generationJob = await createGenerationJob({
            workspaceSnapshotId,
            projectId,
            versionId,
            tenantId,
            tenantStatus,
            outputMode: parsedOutputMode,
            templateKind: parsedTemplateKind,
            releaseIntent,
            status: "queued"
        });
        console.info(
            `[generate] request outputMode=${parsedOutputMode} outputLanguage=${parsedOutputLanguage || "auto"} oneClickMode=${parsedOneClickMode || "strict_build_v1(default)"} ideProfile=${parsedIdeProfile || "generic(default)"} templateKind=${parsedTemplateKind} releaseIntent=${releaseIntent}`
        );
        const responseStream = createKeepAliveJsonStream(async () => {
            await updateGenerationJob(generationJob.id, { status: "running" });

            try {
                const resources = await generateProjectResources(normalizedSummary, normalizedDiagram, version.data.generation?.projectTree, {
                    projectName: project.name || sanitizeText(body.projectName) || undefined,
                    outputLanguage: parsedOutputLanguage,
                    outputMode: parsedOutputMode,
                    oneClickMode: parsedOneClickMode,
                    ideProfile: parsedIdeProfile,
                    templateKindHint: parsedTemplateKind,
                    generationContext
                });
                const preflight = resources.preflightReport;
                if (preflight) {
                    console.info(
                        `[generate] preflight pass=${preflight.pass} planCoveragePct=${preflight.planCoveragePct} nextConfigValid=${preflight.nextConfigValid} envExamplePresent=${preflight.envExamplePresent} pathNormalizationFixCount=${preflight.pathNormalizationFixCount} manifestTaskCount=${preflight.manifestTaskCount} missingDepsCount=${preflight.missingDepsCount}`
                    );
                }

                const artifactManifest = buildArtifactManifest({
                    workspaceSnapshotId,
                    projectId,
                    versionId,
                    outputMode: parsedOutputMode,
                    templateKind: resources.generationManifest?.templateKind ?? parsedTemplateKind ?? null,
                    projectTree: Array.isArray(resources.projectTree) ? resources.projectTree : [],
                    generationManifest: resources.generationManifest
                });
                const contractCoverage = buildContractCoverage(normalizedArchitecturePack.integrationContracts.length);
                const remediationHints = uniqueRemediationHints(
                    buildPreflightRemediationHints(preflight),
                    contractRemediationHints
                );

                if (preflight && !preflight.pass) {
                    const codes = (Array.isArray(preflight.issues) ? preflight.issues : [])
                        .map((issue: { code?: string }) => issue.code || "")
                        .filter(Boolean)
                        .join(", ");
                    const failurePayload: GenerateErrorPayload = {
                        error: "Scaffold preflight failed",
                        details: codes || "Unknown preflight error",
                        code: "SCAFFOLD_PREFLIGHT_FAILED",
                        status: 422,
                        remediationHints
                    };
                    const failedJob = await updateGenerationJob(generationJob.id, {
                        status: "failed",
                        artifactManifest,
                        preflightReport: preflight,
                        remediationHints,
                        errorCode: failurePayload.code,
                        errorMessage: failurePayload.details
                    });

                    return {
                        ...failurePayload,
                        generationJobId: generationJob.id,
                        job: failedJob
                    };
                }

                const succeededJob = await updateGenerationJob(generationJob.id, {
                    status: "succeeded",
                    artifactManifest,
                    preflightReport: preflight ?? null,
                    remediationHints,
                    errorCode: null,
                    errorMessage: null
                });

                const persistedGeneration: GenerationResponse = {
                    ...resources,
                    artifactManifest,
                    contractCoverage,
                    remediationHints,
                    generationJobId: generationJob.id,
                    job: succeededJob ?? undefined
                };

                await updateProjectVersionInWorkspaceByUserId({
                    userId: user.uid,
                    tenantId,
                    projectId,
                    versionId,
                    expectedRevision: expectedRevision ?? undefined,
                    actorId: user.uid,
                    actorEmail: user.email,
                    summary: `Generated ${parsedOutputMode} artifact for project ${projectId} (snapshot ${workspaceSnapshotId}).`,
                    kind: "generation_update",
                    mutateVersion: (currentVersion: ProjectVersion) => ({
                        ...currentVersion,
                        status: "published",
                        data: {
                            ...currentVersion.data,
                            generation: persistedGeneration,
                            generationArtifacts: buildUpdatedGenerationArtifacts(
                                currentVersion.data.generationArtifacts,
                                parsedOutputMode,
                                persistedGeneration
                            )
                        }
                    })
                });

                return {
                    ...persistedGeneration
                };
            } catch (error) {
                console.error("Generation error:", error);
                const failure = buildGenerateFailurePayload(error);
                const mergedFailureHints = uniqueRemediationHints(
                    failure.remediationHints,
                    contractRemediationHints
                );
                const failedJob = await updateGenerationJob(generationJob.id, {
                    status: "failed",
                    remediationHints: mergedFailureHints,
                    errorCode: failure.code,
                    errorMessage: failure.details
                });

                return {
                    ...failure,
                    remediationHints: mergedFailureHints,
                    generationJobId: generationJob.id,
                    job: failedJob
                };
            }
        });

        return new Response(responseStream, {
            status: 200,
            headers: {
                "Content-Type": "application/json; charset=utf-8",
                "Cache-Control": "no-store"
            }
        });
    } catch (error) {
        console.error("Generation setup error:", error);
        const failure = buildGenerateFailurePayload(error);
        return NextResponse.json(failure, { status: failure.status });
    }
}
