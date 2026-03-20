import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/admin-api";
import { diffWorkspaceRevisionsByUserId } from "@/lib/data/workspaces";

export const runtime = "nodejs";

export async function GET(
    req: Request,
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

    const url = new URL(req.url);
    const fromRevisionId = url.searchParams.get("fromRevisionId");
    const toRevisionId = url.searchParams.get("toRevisionId");
    const result = await diffWorkspaceRevisionsByUserId({
        userId: ownerUserId,
        fromRevisionId,
        toRevisionId
    });

    if (!result.ok) {
        const status = result.code === "WORKSPACE_NOT_FOUND"
            ? 404
            : result.code === "INSUFFICIENT_REVISION_HISTORY"
            ? 409
            : result.code === "REVISION_NOT_FOUND"
            ? 404
            : result.code === "SNAPSHOT_NOT_FOUND"
            ? 404
            : result.code === "SNAPSHOT_PAYLOAD_UNAVAILABLE"
            ? 409
            : 400;
        return NextResponse.json(
            {
                error: result.message,
                code: result.code,
                availableRevisionIds: result.availableRevisionIds || []
            },
            { status }
        );
    }

    return NextResponse.json({
        diff: result.diff,
        role: admin.role
    });
}
