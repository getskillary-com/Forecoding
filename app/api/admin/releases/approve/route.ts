import { z } from "zod";
import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/admin-api";
import { isFeatureFlagEnabledForContext } from "@/lib/data/feature-flags";
import {
    getWorkspaceEnvelopeByUserId,
    getWorkspaceReleaseTagById,
    updateWorkspaceReleaseApprovalByUserId
} from "@/lib/data/workspaces";

export const runtime = "nodejs";

const ReleaseApprovalSchema = z.object({
    ownerUserId: z.string().trim().min(1),
    releaseTagId: z.string().trim().min(1),
    decision: z.enum(["approved", "rejected"]),
    note: z.string().trim().max(240).optional()
});

export async function POST(req: Request) {
    const admin = await requireAdminRoute({ minimumCapability: "releases_approve" });
    if (admin.error) return admin.error;

    const payload = ReleaseApprovalSchema.parse(await req.json());
    const workspaceEnvelope = await getWorkspaceEnvelopeByUserId(payload.ownerUserId);
    const approvalEnabled = await isFeatureFlagEnabledForContext({
        key: "releases.approval.enabled",
        fallback: true,
        tenantId: workspaceEnvelope?.tenantId ?? null,
        workspaceId: payload.ownerUserId
    });
    if (!approvalEnabled) {
        return NextResponse.json(
            {
                error: "Release approval is currently disabled by feature flag.",
                code: "RELEASE_APPROVAL_DISABLED"
            },
            { status: 423 }
        );
    }

    const updated = await updateWorkspaceReleaseApprovalByUserId({
        userId: payload.ownerUserId,
        releaseTagId: payload.releaseTagId,
        decision: payload.decision,
        note: payload.note ?? null,
        actorId: admin.user?.uid ?? null,
        actorEmail: admin.user?.email ?? null
    });

    if (!updated) {
        return NextResponse.json(
            { error: "Release tag not found for this workspace." },
            { status: 404 }
        );
    }

    const detail = await getWorkspaceReleaseTagById(payload.releaseTagId);
    return NextResponse.json({
        ok: true,
        release: detail ?? updated.release,
        role: admin.role
    });
}
