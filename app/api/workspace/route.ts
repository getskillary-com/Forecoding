import { NextResponse } from "next/server";
import { getServerUser } from "@/lib/server-auth";
import { getWorkspaceByUserId, saveWorkspaceByUserId } from "@/lib/data/workspaces";
import type { Project } from "@/types";

function parseProjects(raw: unknown): Project[] {
    if (!Array.isArray(raw)) return [];
    return raw as Project[];
}

async function requireUserId() {
    const user = await getServerUser();
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
            projects,
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

        const body = (await req.json()) as { projects?: unknown };
        const projects = parseProjects(body.projects);

        await saveWorkspaceByUserId(userId, projects);

        return NextResponse.json({ ok: true });
    } catch {
        return NextResponse.json({ error: "Failed to save workspace." }, { status: 500 });
    }
}
