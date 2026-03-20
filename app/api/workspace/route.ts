import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerUser } from "@/lib/server-auth";
import {
    getWorkspaceByUserId,
    saveWorkspaceEnvelopeByUserId,
    WorkspaceDocumentTooLargeError
} from "@/lib/data/workspaces";
import { normalizeProjects } from "@/lib/project-language";
import type { Project, WorkspaceEnvelope } from "@/types";

const WorkspacePutBodySchema = z.object({
    projects: z.array(z.unknown()),
    expectedRevision: z.number().int().min(0),
    changeSummary: z.string().trim().min(1).max(160).optional()
});

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
                    workspace: conflictWorkspace
                },
                { status: 409 }
            );
        }

        const successWorkspace = stripSnapshotProjects(result.envelope);
        return NextResponse.json({
            ok: true,
            revision: successWorkspace.revision,
            workspace: successWorkspace,
            projects: successWorkspace.projects
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
