import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import type { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { prisma, withPrismaRetry } from "@/lib/prisma";
import type { Project } from "@/types";

function parseProjects(raw: unknown): Project[] {
    if (!Array.isArray(raw)) return [];
    return raw as Project[];
}

async function requireUserId() {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as { id?: string } | undefined)?.id;
    return userId ?? null;
}

export async function GET(req: Request) {
    try {
        const userId = await requireUserId();
        if (!userId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const workspace = await withPrismaRetry(() =>
            prisma.workspaceState.findUnique({
                where: { userId },
                select: { data: true, updatedAt: true }
            })
        );

        const url = new URL(req.url);
        const projectId = url.searchParams.get("projectId");
        const parsed = parseProjects(workspace?.data);
        const projects = projectId ? parsed.filter((p) => p.id === projectId) : parsed;

        return NextResponse.json({
            projects,
            updatedAt: workspace?.updatedAt ?? null
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

        await withPrismaRetry(() =>
            prisma.workspaceState.upsert({
                where: { userId },
                create: {
                    userId,
                    data: projects as unknown as Prisma.InputJsonValue
                },
                update: {
                    data: projects as unknown as Prisma.InputJsonValue
                }
            })
        );

        return NextResponse.json({ ok: true });
    } catch {
        return NextResponse.json({ error: "Failed to save workspace." }, { status: 500 });
    }
}
