import { adminDb } from "@/lib/firebase-admin";
import { toDateOrNull } from "./firestore-utils";
import { recordAuditEvent } from "./audit-events";
import type {
    ArtifactManifest,
    ArtifactManifestEntry,
    GenerationJob,
    PreflightIssue,
    PreflightReport,
    RemediationHint
} from "@/types";

type GenerationJobStatus = GenerationJob["status"];

type GenerationJobInput = {
    workspaceSnapshotId: string;
    projectId?: string | null;
    versionId?: string | null;
    outputMode: string;
    templateKind?: string | null;
    releaseIntent?: string | null;
    artifactManifest?: ArtifactManifest | null;
    preflightReport?: PreflightReport | null;
    remediationHints?: RemediationHint[];
    errorCode?: string | null;
    errorMessage?: string | null;
};

type GenerationJobUpdate = Partial<Omit<GenerationJobInput, "workspaceSnapshotId" | "outputMode">> & {
    status?: GenerationJobStatus;
};

function generationJobsCollection() {
    return adminDb.collection("generationJobs");
}

function randomId() {
    return `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeRemediationHints(value: unknown): RemediationHint[] {
    if (!Array.isArray(value)) return [];

    return value
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
        .map((item) => {
            const severity: RemediationHint["severity"] =
                item.severity === "info" || item.severity === "warning" || item.severity === "error"
                    ? item.severity
                    : "warning";

            return {
                code: typeof item.code === "string" && item.code.trim() ? item.code.trim() : "UNKNOWN",
                severity,
                message: typeof item.message === "string" ? item.message : "Generation remediation available.",
                action: typeof item.action === "string" ? item.action : undefined,
                autoFixable: item.autoFixable === true
            } satisfies RemediationHint;
        })
        .slice(0, 12);
}

function normalizeArtifactManifest(value: unknown): ArtifactManifest | null {
    if (!value || typeof value !== "object") return null;

    const item = value as Record<string, unknown>;
    const files = Array.isArray(item.files)
        ? item.files
            .filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object"))
            .map((entry) => {
                const nodeType: "file" | "folder" = entry.nodeType === "folder" ? "folder" : "file";
                const contentKind: ArtifactManifestEntry["contentKind"] =
                    entry.contentKind === "doc" ||
                    entry.contentKind === "config" ||
                    entry.contentKind === "placeholder" ||
                    entry.contentKind === "template"
                        ? entry.contentKind
                        : undefined;

                return {
                    path: typeof entry.path === "string" ? entry.path : "",
                    nodeType,
                    contentKind,
                    promptPath: typeof entry.promptPath === "string" ? entry.promptPath : undefined
                };
            })
            .filter((entry) => entry.path)
        : [];

    return {
        version: "artifact_manifest_v1",
        workspaceSnapshotId: typeof item.workspaceSnapshotId === "string" ? item.workspaceSnapshotId : "",
        projectId: typeof item.projectId === "string" ? item.projectId : "",
        versionId: typeof item.versionId === "string" ? item.versionId : "",
        outputMode:
            item.outputMode === "runnable_scaffold" || item.outputMode === "virtual_spec"
                ? item.outputMode
                : "virtual_spec",
        templateKind:
            item.templateKind === "next_root" ||
            item.templateKind === "next_src" ||
            item.templateKind === "react_vite" ||
            item.templateKind === "monorepo_multiapp"
                ? item.templateKind
                : null,
        generatedAt: toDateOrNull(item.generatedAt)?.getTime() || (
            typeof item.generatedAt === "number" ? item.generatedAt : Date.now()
        ),
        fileCount: typeof item.fileCount === "number" && Number.isFinite(item.fileCount)
            ? Math.max(0, Math.round(item.fileCount))
            : files.length,
        files
    };
}

function normalizePreflightReport(value: unknown): PreflightReport | null {
    if (!value || typeof value !== "object") return null;

    const item = value as Record<string, unknown>;
    const issues = Array.isArray(item.issues)
        ? item.issues
            .filter((issue): issue is Record<string, unknown> => Boolean(issue && typeof issue === "object"))
            .map((issue) => {
                const code: PreflightIssue["code"] =
                    issue.code === "NEXT_CONFIG_CONTAMINATED" ||
                    issue.code === "MISSING_ENV_EXAMPLE" ||
                    issue.code === "MISSING_PROMPT_FILE" ||
                    issue.code === "MISSING_TASK_PROMPT" ||
                    issue.code === "INVALID_PROMPT_REFERENCE" ||
                    issue.code === "PLAN_COVERAGE_INCOMPLETE" ||
                    issue.code === "EMPTY_GENERATION_TASKS" ||
                    issue.code === "DUPLICATE_PATH_SEGMENT" ||
                    issue.code === "LANGUAGE_MISMATCH" ||
                    issue.code === "MISSING_STACK_DEPENDENCIES" ||
                    issue.code === "MISSING_REQUIRED_DEPENDENCIES" ||
                    issue.code === "MISSING_CSS_BASELINE" ||
                    issue.code === "MISSING_PAGE_UI_REQUIREMENTS" ||
                    issue.code === "RUNTIME_BASELINE_INCOMPLETE" ||
                    issue.code === "SPEC_CONTENT_CONTAMINATED" ||
                    issue.code === "INVALID_PLACEHOLDER_FORMAT" ||
                    issue.code === "INVALID_JSON_FILE" ||
                    issue.code === "ROUTE_MAP_REFERENCE_MISSING" ||
                    issue.code === "WORKSPACE_STRUCTURE_MISMATCH" ||
                    issue.code === "README_STACK_MISMATCH" ||
                    issue.code === "SPEC_DOC_RUNTIME_DRIFT"
                        ? issue.code
                        : "PLAN_COVERAGE_INCOMPLETE";

                return {
                    code,
                    severity: issue.severity === "warning" ? "warning" : "error",
                    message: typeof issue.message === "string" ? issue.message : "Preflight issue",
                    details: typeof issue.details === "string" ? issue.details : undefined
                } satisfies PreflightIssue;
            })
        : [];

    return {
        pass: item.pass === true,
        planCoveragePct: typeof item.planCoveragePct === "number" ? item.planCoveragePct : 0,
        placeholderCount: typeof item.placeholderCount === "number" ? item.placeholderCount : 0,
        nextConfigValid: item.nextConfigValid === true,
        envExamplePresent: item.envExamplePresent === true,
        pathNormalizationFixCount: typeof item.pathNormalizationFixCount === "number" ? item.pathNormalizationFixCount : 0,
        missingDepsCount: typeof item.missingDepsCount === "number" ? item.missingDepsCount : 0,
        manifestTaskCount: typeof item.manifestTaskCount === "number" ? item.manifestTaskCount : 0,
        issues
    };
}

function mapGenerationJob(id: string, data: Record<string, unknown>): GenerationJob {
    return {
        id,
        status:
            data.status === "running" || data.status === "succeeded" || data.status === "failed"
                ? data.status
                : "queued",
        workspaceSnapshotId: typeof data.workspaceSnapshotId === "string" ? data.workspaceSnapshotId : "",
        projectId: typeof data.projectId === "string" ? data.projectId : null,
        versionId: typeof data.versionId === "string" ? data.versionId : null,
        outputMode: typeof data.outputMode === "string" ? data.outputMode : "virtual_spec",
        templateKind: typeof data.templateKind === "string" ? data.templateKind : null,
        releaseIntent: typeof data.releaseIntent === "string" ? data.releaseIntent : null,
        artifactManifest: normalizeArtifactManifest(data.artifactManifest),
        preflightReport: normalizePreflightReport(data.preflightReport),
        remediationHints: normalizeRemediationHints(data.remediationHints),
        errorCode: typeof data.errorCode === "string" ? data.errorCode : null,
        errorMessage: typeof data.errorMessage === "string" ? data.errorMessage : null,
        createdAt: toDateOrNull(data.createdAt)?.getTime() || Date.now(),
        updatedAt: toDateOrNull(data.updatedAt)?.getTime() || Date.now()
    };
}

async function writeGenerationJob(
    id: string,
    input: GenerationJobInput & { status: GenerationJobStatus; createdAt: number; updatedAt: number }
) {
    await generationJobsCollection().doc(id).set({
        status: input.status,
        workspaceSnapshotId: input.workspaceSnapshotId,
        projectId: input.projectId ?? null,
        versionId: input.versionId ?? null,
        outputMode: input.outputMode,
        templateKind: input.templateKind ?? null,
        releaseIntent: input.releaseIntent ?? null,
        artifactManifest: input.artifactManifest ?? null,
        preflightReport: input.preflightReport ?? null,
        remediationHints: input.remediationHints ?? [],
        errorCode: input.errorCode ?? null,
        errorMessage: input.errorMessage ?? null,
        createdAt: new Date(input.createdAt),
        updatedAt: new Date(input.updatedAt)
    });

    return {
        id,
        status: input.status,
        workspaceSnapshotId: input.workspaceSnapshotId,
        projectId: input.projectId ?? null,
        versionId: input.versionId ?? null,
        outputMode: input.outputMode,
        templateKind: input.templateKind ?? null,
        releaseIntent: input.releaseIntent ?? null,
        artifactManifest: input.artifactManifest ?? null,
        preflightReport: input.preflightReport ?? null,
        remediationHints: input.remediationHints ?? [],
        errorCode: input.errorCode ?? null,
        errorMessage: input.errorMessage ?? null,
        createdAt: input.createdAt,
        updatedAt: input.updatedAt
    } satisfies GenerationJob;
}

export async function createGenerationJob(
    input: GenerationJobInput & {
        status?: GenerationJobStatus;
    }
): Promise<GenerationJob> {
    const id = randomId();
    const now = Date.now();
    const job = await writeGenerationJob(id, {
        ...input,
        status: input.status ?? "queued",
        createdAt: now,
        updatedAt: now
    });

    await recordAuditEvent({
        eventType: "generation.job_created",
        severity: "info",
        resourceType: "generationJob",
        resourceId: id,
        summary: `Generation job ${id} was created.`,
        metadata: {
            jobId: id,
            outputMode: job.outputMode,
            workspaceSnapshotId: job.workspaceSnapshotId,
            projectId: job.projectId || "",
            versionId: job.versionId || "",
            templateKind: job.templateKind || "",
            releaseIntent: job.releaseIntent || ""
        }
    });

    return job;
}

export async function updateGenerationJob(
    id: string,
    update: GenerationJobUpdate
): Promise<GenerationJob | null> {
    const docRef = generationJobsCollection().doc(id);
    const snap = await docRef.get();
    if (!snap.exists) return null;

    const current = mapGenerationJob(id, snap.data() || {});
    const next: GenerationJob = {
        ...current,
        status: update.status ?? current.status,
        templateKind: update.templateKind ?? current.templateKind ?? null,
        releaseIntent: update.releaseIntent ?? current.releaseIntent ?? null,
        artifactManifest: update.artifactManifest === undefined
            ? current.artifactManifest ?? null
            : update.artifactManifest,
        preflightReport: update.preflightReport === undefined
            ? current.preflightReport ?? null
            : update.preflightReport,
        remediationHints: update.remediationHints === undefined
            ? current.remediationHints ?? []
            : update.remediationHints,
        errorCode: update.errorCode === undefined ? current.errorCode ?? null : update.errorCode,
        errorMessage: update.errorMessage === undefined ? current.errorMessage ?? null : update.errorMessage,
        updatedAt: Date.now()
    };

    await docRef.set({
        status: next.status,
        workspaceSnapshotId: next.workspaceSnapshotId,
        projectId: next.projectId ?? null,
        versionId: next.versionId ?? null,
        outputMode: next.outputMode,
        templateKind: next.templateKind ?? null,
        releaseIntent: next.releaseIntent ?? null,
        artifactManifest: next.artifactManifest ?? null,
        preflightReport: next.preflightReport ?? null,
        remediationHints: next.remediationHints ?? [],
        errorCode: next.errorCode ?? null,
        errorMessage: next.errorMessage ?? null,
        createdAt: new Date(next.createdAt),
        updatedAt: new Date(next.updatedAt)
    }, { merge: false });

    await recordAuditEvent({
        eventType: `generation.job_${next.status}`,
        severity: next.status === "failed" ? "warning" : "info",
        resourceType: "generationJob",
        resourceId: id,
        summary: `Generation job ${id} is now ${next.status}.`,
        metadata: {
            jobId: id,
            status: next.status,
            outputMode: next.outputMode,
            errorCode: next.errorCode || "",
            workspaceSnapshotId: next.workspaceSnapshotId,
            projectId: next.projectId || "",
            versionId: next.versionId || "",
            templateKind: next.templateKind || "",
            releaseIntent: next.releaseIntent || ""
        }
    });

    return next;
}

export async function listGenerationJobs(limit = 30): Promise<GenerationJob[]> {
    const snap = await generationJobsCollection()
        .orderBy("updatedAt", "desc")
        .limit(limit)
        .get();
    return snap.docs.map((doc) => mapGenerationJob(doc.id, doc.data() || {}));
}

export async function getGenerationJobById(id: string): Promise<GenerationJob | null> {
    const normalizedId = id.trim();
    if (!normalizedId) return null;

    const snap = await generationJobsCollection().doc(normalizedId).get();
    if (!snap.exists) return null;
    return mapGenerationJob(snap.id, snap.data() || {});
}

export async function searchGenerationJobs(input?: {
    limit?: number;
    status?: GenerationJob["status"] | "";
    outputMode?: string;
    templateKind?: string;
    query?: string;
}): Promise<GenerationJob[]> {
    const status = input?.status || "";
    const outputMode = (input?.outputMode || "").trim().toLowerCase();
    const templateKind = (input?.templateKind || "").trim().toLowerCase();
    const query = (input?.query || "").trim().toLowerCase();
    const limit = Math.max(1, Math.min(100, input?.limit ?? 40));

    const snap = await generationJobsCollection()
        .orderBy("updatedAt", "desc")
        .limit(Math.max(limit, 80))
        .get();

    return snap.docs
        .map((doc) => mapGenerationJob(doc.id, doc.data() || {}))
        .filter((job) => {
            if (status && job.status !== status) return false;
            if (outputMode && job.outputMode.toLowerCase() !== outputMode) return false;
            if (templateKind && (job.templateKind || "").toLowerCase() !== templateKind) return false;
            if (query) {
                const haystack = [
                    job.id,
                    job.workspaceSnapshotId,
                    job.projectId || "",
                    job.versionId || "",
                    job.outputMode,
                    job.templateKind || "",
                    job.releaseIntent || "",
                    job.errorCode || "",
                    job.errorMessage || "",
                    JSON.stringify(job.remediationHints || []),
                    JSON.stringify(job.preflightReport?.issues || []),
                    JSON.stringify(job.artifactManifest?.files || [])
                ].join(" ").toLowerCase();
                if (!haystack.includes(query)) return false;
            }
            return true;
        })
        .slice(0, limit);
}
