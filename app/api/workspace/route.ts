import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerUser } from "@/lib/server-auth";
import {
    getWorkspaceByUserId,
    saveWorkspaceEnvelopeByUserId,
    saveWorkspacePatchByUserId,
    WorkspaceDocumentTooLargeError
} from "@/lib/data/workspaces";
import { normalizeProjects } from "@/lib/project-language";
import { normalizeUnifiedProgressState } from "@/lib/progress-template";
import type { Project, WorkspaceEnvelope, WorkspacePatchOperation } from "@/types";

const WorkspaceSnapshotPutBodySchema = z.object({
    saveMode: z.literal("snapshot").optional(),
    projects: z.array(z.unknown()),
    expectedRevision: z.number().int().min(0),
    changeSummary: z.string().trim().min(1).max(160).optional()
});

const WorkspacePatchOperationSchema = z.discriminatedUnion("type", [
    z.object({
        type: z.literal("replace_projects"),
        projects: z.array(z.unknown())
    }),
    z.object({
        type: z.literal("upsert_project"),
        project: z.unknown()
    }),
    z.object({
        type: z.literal("remove_project"),
        projectId: z.string().trim().min(1)
    }),
    z.object({
        type: z.literal("append_progress_events"),
        projectId: z.string().trim().min(1),
        versionId: z.string().trim().min(1),
        events: z.array(z.unknown()),
        progressState: z.unknown().optional()
    }),
    z.object({
        type: z.literal("migrate.progress_template_v2"),
        projectId: z.string().trim().min(1).optional(),
        versionId: z.string().trim().min(1).optional()
    })
]);

const WorkspacePatchPutBodySchema = z.object({
    saveMode: z.literal("patch"),
    idempotencyKey: z.string().trim().min(8).max(220),
    expectedRevision: z.number().int().min(0),
    projectId: z.string().trim().min(1).optional(),
    versionId: z.string().trim().min(1).optional(),
    operations: z.array(WorkspacePatchOperationSchema).min(1),
    changeSummary: z.string().trim().min(1).max(160).optional()
});

const WorkspacePutBodySchema = z.union([
    WorkspaceSnapshotPutBodySchema,
    WorkspacePatchPutBodySchema
]);

function parseProjects(raw: unknown): Project[] {
    return normalizeProjects(raw);
}

function parseBooleanSearchParam(value: string | null, defaultValue: boolean) {
    if (value === null) return defaultValue;
    const normalized = value.trim().toLowerCase();
    if (!normalized) return defaultValue;
    if (normalized === "1" || normalized === "true" || normalized === "yes") return true;
    if (normalized === "0" || normalized === "false" || normalized === "no") return false;
    return defaultValue;
}

function stripSnapshotProjects(envelope: WorkspaceEnvelope): WorkspaceEnvelope {
    return {
        ...envelope,
        snapshots: envelope.snapshots.map((snapshot) => {
            const nextSnapshot = { ...snapshot };
            delete nextSnapshot.projects;
            return nextSnapshot;
        })
    };
}

function resolveUnifiedProgressFromWorkspace(
    envelope: WorkspaceEnvelope,
    projectId?: string | null,
    versionId?: string | null
) {
    const attachWorkspaceTrace = (state: ReturnType<typeof normalizeUnifiedProgressState>) => {
        if (!state) return null;
        const latestSnapshotId = envelope.snapshots[0]?.id || null;
        return {
            ...state,
            nextAction: {
                ...state.nextAction,
                workspaceSnapshotId: state.nextAction.workspaceSnapshotId ?? latestSnapshotId,
                revision: typeof state.nextAction.revision === "number"
                    ? state.nextAction.revision
                    : envelope.revision
            }
        };
    };
    const scopedProjectId = (projectId || "").trim();
    const scopedVersionId = (versionId || "").trim();
    const preferredProject = scopedProjectId
        ? envelope.projects.find((project) => project.id === scopedProjectId) || null
        : null;

    if (preferredProject) {
        const preferredVersion = scopedVersionId
            ? preferredProject.versions.find((version) => version.id === scopedVersionId) || null
            : preferredProject.versions[preferredProject.versions.length - 1] || null;
        const preferredUnified = normalizeUnifiedProgressState(preferredVersion?.data?.unifiedProgressState);
        if (preferredUnified) {
            return attachWorkspaceTrace(preferredUnified);
        }
    }

    for (const project of envelope.projects) {
        const latestVersion = project.versions[project.versions.length - 1];
        const unified = normalizeUnifiedProgressState(latestVersion?.data?.unifiedProgressState);
        if (unified) {
            return attachWorkspaceTrace(unified);
        }
    }
    return null;
}

async function requireUser() {
    const user = await getServerUser();
    return user?.uid ? user : null;
}

export async function GET(req: Request) {
    try {
        const user = await requireUser();
        if (!user?.uid) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const workspace = await getWorkspaceByUserId(user.uid);

        const url = new URL(req.url);
        const projectId = url.searchParams.get("projectId");
        const includeWorkspace = parseBooleanSearchParam(url.searchParams.get("includeWorkspace"), true);
        const includeSnapshotProjects = parseBooleanSearchParam(url.searchParams.get("includeSnapshotProjects"), true);
        const parsed = parseProjects(workspace?.projects);
        const projects = projectId ? parsed.filter((p) => p.id === projectId) : parsed;
        const workspacePayload = includeWorkspace
            ? workspace?.envelope
                ? includeSnapshotProjects
                    ? workspace.envelope
                    : stripSnapshotProjects(workspace.envelope)
                : null
            : null;

        return NextResponse.json({
            workspace: workspacePayload,
            projects,
            projectScoped: Boolean(projectId),
            revision: workspace?.revision ?? 0,
            updatedAt: workspace?.updatedAt?.toISOString() ?? null
        });
    } catch {
        return NextResponse.json({ error: "Failed to load workspace." }, { status: 500 });
    }
}

export async function PUT(req: Request) {
    try {
        const user = await requireUser();
        if (!user?.uid) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const parsedBody = WorkspacePutBodySchema.parse(await req.json());
        if (parsedBody.saveMode === "patch") {
            const result = await saveWorkspacePatchByUserId({
                userId: user.uid,
                tenantId: user.tenantId ?? null,
                expectedRevision: parsedBody.expectedRevision,
                idempotencyKey: parsedBody.idempotencyKey,
                operations: parsedBody.operations as WorkspacePatchOperation[],
                projectId: parsedBody.projectId,
                versionId: parsedBody.versionId,
                actorId: user.uid,
                actorEmail: user.email ?? null,
                changeSummary: parsedBody.changeSummary
            });

            if (!result.ok) {
                const conflictWorkspace = stripSnapshotProjects(result.currentEnvelope);
                return NextResponse.json(
                    {
                        error: result.message,
                        code: result.code,
                        revision: conflictWorkspace.revision,
                        workspace: conflictWorkspace,
                        saveMode: "patch",
                        idempotent: false,
                        rebaseCount: 0,
                        appliedOperations: 0,
                        progressCursor: null,
                        unifiedProgress: resolveUnifiedProgressFromWorkspace(
                            conflictWorkspace,
                            parsedBody.projectId,
                            parsedBody.versionId
                        )
                    },
                    { status: 409 }
                );
            }

            const successWorkspace = stripSnapshotProjects(result.envelope);
            return NextResponse.json(
                {
                    ok: true,
                    revision: successWorkspace.revision,
                    workspace: successWorkspace,
                    projects: successWorkspace.projects,
                    saveMode: "patch",
                    idempotent: result.idempotent,
                    rebaseCount: result.rebaseCount,
                    appliedOperations: result.appliedOperations,
                    progressCursor: result.progressCursor,
                    unifiedProgress: result.unifiedProgress
                },
                { status: 200 }
            );
        }

        const projects = parseProjects(parsedBody.projects);
        const result = await saveWorkspaceEnvelopeByUserId({
            userId: user.uid,
            tenantId: user.tenantId ?? null,
            projects,
            expectedRevision: parsedBody.expectedRevision,
            actorId: user.uid,
            actorEmail: user.email ?? null,
            changeSummary: parsedBody.changeSummary
        });

        if (!result.ok) {
            const conflictWorkspace = stripSnapshotProjects(result.currentEnvelope);
            return NextResponse.json(
                {
                    error: "Workspace revision conflict.",
                    code: "WORKSPACE_REVISION_CONFLICT",
                    revision: conflictWorkspace.revision,
                    workspace: conflictWorkspace,
                    saveMode: "snapshot",
                    idempotent: false,
                    rebaseCount: 0,
                    appliedOperations: 0,
                    progressCursor: null,
                    unifiedProgress: resolveUnifiedProgressFromWorkspace(conflictWorkspace)
                },
                { status: 409 }
            );
        }

        const successWorkspace = stripSnapshotProjects(result.envelope);
        return NextResponse.json({
            ok: true,
            revision: successWorkspace.revision,
            workspace: successWorkspace,
            projects: successWorkspace.projects,
            saveMode: "snapshot",
            idempotent: false,
            rebaseCount: 0,
            appliedOperations: 1,
            progressCursor: null,
            unifiedProgress: resolveUnifiedProgressFromWorkspace(successWorkspace)
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json(
                {
                    error: "Invalid workspace save payload.",
                    code: "WORKSPACE_PAYLOAD_INVALID"
                },
                { status: 400 }
            );
        }
        if (error instanceof WorkspaceDocumentTooLargeError) {
            return NextResponse.json(
                {
                    error: "Workspace payload too large to persist.",
                    code: "WORKSPACE_PAYLOAD_TOO_LARGE",
                    details: `Estimated workspace document size ${error.estimatedBytes} bytes exceeds write limit ${error.limitBytes} bytes.`
                },
                { status: 413 }
            );
        }
        return NextResponse.json({ error: "Failed to save workspace." }, { status: 500 });
    }
}
