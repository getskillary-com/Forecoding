import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSessionIdentity } from "@/lib/server-auth";
import { getWorkspaceByUserId, saveWorkspaceEnvelopeByUserId } from "@/lib/data/workspaces";
import { normalizeProjects } from "@/lib/project-language";
import type { Project } from "@/types";

const WorkspacePutBodySchema = z.object({
    projects: z.array(z.unknown()),
    expectedRevision: z.number().int().min(0),
    changeSummary: z.string().trim().min(1).max(160).optional()
});

function parseProjects(raw: unknown): Project[] {
    return normalizeProjects(raw);
}

async function requireUserId() {
    const user = await getServerSessionIdentity();
    return user?.uid ?? null;
}

export async function GET(req: Request) {
    try {
        const userId = await requireUserId();
        if (!userId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const workspace = await getWorkspaceByUserId(userId);

        const url = new URL(req.url);
        const projectId = url.searchParams.get("projectId");
        const parsed = parseProjects(workspace?.projects);
        const projects = projectId ? parsed.filter((p) => p.id === projectId) : parsed;

        return NextResponse.json({
            workspace: workspace?.envelope ?? null,
            projects,
            revision: workspace?.revision ?? 0,
            updatedAt: workspace?.updatedAt?.toISOString() ?? null
        });
    } catch {
        return NextResponse.json({ error: "Failed to load workspace." }, { status: 500 });
    }
}

export async function PUT(req: Request) {
    try {
        const userId = await requireUserId();
        if (!userId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const parsedBody = WorkspacePutBodySchema.parse(await req.json());
        const projects = parseProjects(parsedBody.projects);
        const user = await getServerSessionIdentity();
        const result = await saveWorkspaceEnvelopeByUserId({
            userId,
            projects,
            expectedRevision: parsedBody.expectedRevision,
            actorId: userId,
            actorEmail: user?.email ?? null,
            changeSummary: parsedBody.changeSummary
        });

        if (!result.ok) {
            return NextResponse.json(
                {
                    error: "Workspace revision conflict.",
                    code: "WORKSPACE_REVISION_CONFLICT",
                    revision: result.currentEnvelope.revision,
                    workspace: result.currentEnvelope,
                    projects: result.currentEnvelope.projects
                },
                { status: 409 }
            );
        }

        return NextResponse.json({
            ok: true,
            revision: result.envelope.revision,
            workspace: result.envelope,
            projects: result.envelope.projects
        });
    } catch {
        return NextResponse.json({ error: "Failed to save workspace." }, { status: 500 });
    }
}
