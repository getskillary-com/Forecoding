import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/admin-api";
import { getWorkspaceRevisionOverviewByUserId } from "@/lib/data/workspaces";

export const runtime = "nodejs";

export async function GET(
    _req: Request,
    context: { params: Promise<{ ownerUserId: string }> }
) {
    const admin = await requireAdminRoute();
    if (admin.error) return admin.error;

    const params = await context.params;
    const ownerUserId = params.ownerUserId.trim();
    if (!ownerUserId) {
        return NextResponse.json(
            { error: "ownerUserId is required." },
            { status: 400 }
        );
    }

    const workspace = await getWorkspaceRevisionOverviewByUserId(ownerUserId);
    if (!workspace) {
        return NextResponse.json(
            { error: "Workspace not found." },
            { status: 404 }
        );
    }

    return NextResponse.json({
        workspace,
        role: admin.role
    });
}
