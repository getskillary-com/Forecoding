import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminRoute } from "@/lib/admin-api";
import { isFeatureFlagEnabledForContext } from "@/lib/data/feature-flags";
import { getWorkspaceEnvelopeByUserId, rollbackWorkspaceReleaseTagByUserId } from "@/lib/data/workspaces";

export const runtime = "nodejs";

const ReleaseRollbackSchema = z.object({
    ownerUserId: z.string().trim().min(1),
    releaseTagId: z.string().trim().min(1)
});

export async function POST(req: Request) {
    const admin = await requireAdminRoute({ minimumCapability: "releases_rollback" });
    if (admin.error) return admin.error;

    const payload = ReleaseRollbackSchema.parse(await req.json());
    const workspaceEnvelope = await getWorkspaceEnvelopeByUserId(payload.ownerUserId);
    const rollbackEnabled = await isFeatureFlagEnabledForContext({
        key: "releases.rollback.enabled",
        fallback: true,
        tenantId: workspaceEnvelope?.tenantId ?? null,
        workspaceId: payload.ownerUserId
    });
    if (!rollbackEnabled) {
        return NextResponse.json(
            {
                error: "Release rollback is currently disabled by feature flag.",
                code: "RELEASE_ROLLBACK_DISABLED"
            },
            { status: 423 }
        );
    }

    const result = await rollbackWorkspaceReleaseTagByUserId({
        userId: payload.ownerUserId,
        releaseTagId: payload.releaseTagId,
        actorId: admin.user?.uid ?? null,
        actorEmail: admin.user?.email ?? null
    });

    if (!result.ok) {
        const status = result.code === "SNAPSHOT_PAYLOAD_UNAVAILABLE"
            ? 409
            : result.code === "RELEASE_NOT_APPROVED"
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
