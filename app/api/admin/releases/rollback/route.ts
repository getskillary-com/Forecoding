import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminRoute } from "@/lib/admin-api";
import { isFeatureFlagEnabled } from "@/lib/data/feature-flags";
import { rollbackWorkspaceReleaseTagByUserId } from "@/lib/data/workspaces";

export const runtime = "nodejs";

const ReleaseRollbackSchema = z.object({
    ownerUserId: z.string().trim().min(1),
    releaseTagId: z.string().trim().min(1)
});

export async function POST(req: Request) {
    const admin = await requireAdminRoute({ minimumRole: "operator" });
    if (admin.error) return admin.error;

    const rollbackEnabled = await isFeatureFlagEnabled("releases.rollback.enabled", true);
    if (!rollbackEnabled) {
        return NextResponse.json(
            {
                error: "Release rollback is currently disabled by feature flag.",
                code: "RELEASE_ROLLBACK_DISABLED"
            },
            { status: 423 }
        );
    }

    const payload = ReleaseRollbackSchema.parse(await req.json());
    const result = await rollbackWorkspaceReleaseTagByUserId({
        userId: payload.ownerUserId,
        releaseTagId: payload.releaseTagId,
        actorId: admin.user?.uid ?? null,
        actorEmail: admin.user?.email ?? null
    });

    if (!result.ok) {
        const status = result.code === "SNAPSHOT_PAYLOAD_UNAVAILABLE"
            ? 409
            : result.code === "WORKSPACE_NOT_FOUND" || result.code === "RELEASE_NOT_FOUND" || result.code === "SNAPSHOT_NOT_FOUND"
            ? 404
            : 400;
        return NextResponse.json(
            {
                error: result.message,
                code: result.code
            },
            { status }
        );
    }

    return NextResponse.json({
        ok: true,
        result: {
            release: result.release,
            restoredRevision: result.restoredRevision,
            restoredSnapshotId: result.restoredSnapshotId,
            projectCount: result.projectCount
        },
        role: admin.role
    });
}
