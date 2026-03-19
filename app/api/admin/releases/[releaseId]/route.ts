import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/admin-api";
import { getWorkspaceReleaseTagById } from "@/lib/data/workspaces";

export const runtime = "nodejs";

export async function GET(
    _req: Request,
    context: { params: Promise<{ releaseId: string }> }
) {
    const admin = await requireAdminRoute();
    if (admin.error) return admin.error;

    const params = await context.params;
    const release = await getWorkspaceReleaseTagById(params.releaseId);
    if (!release) {
        return NextResponse.json(
            { error: "Release tag not found." },
            { status: 404 }
        );
    }

    return NextResponse.json({ release, role: admin.role });
}
