import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminRoute } from "@/lib/admin-api";
import { createWorkspaceReleaseTagByUserId, listWorkspaceReleaseTags } from "@/lib/data/workspaces";
import { isFeatureFlagEnabled } from "@/lib/data/feature-flags";

export const runtime = "nodejs";

const ReleaseTagSchema = z.object({
    ownerUserId: z.string().trim().min(1),
    label: z.string().trim().min(1).max(80),
    note: z.string().trim().max(240).optional()
});

export async function GET() {
    const admin = await requireAdminRoute();
    if (admin.error) return admin.error;

    const releases = await listWorkspaceReleaseTags(40);
    return NextResponse.json({ releases, role: admin.role });
}

export async function POST(req: Request) {
    const admin = await requireAdminRoute({ minimumRole: "operator" });
    if (admin.error) return admin.error;

    const releasesEnabled = await isFeatureFlagEnabled("releases.publish.enabled", true);
    if (!releasesEnabled) {
        return NextResponse.json(
            {
                error: "Release publishing is currently disabled by feature flag.",
                code: "RELEASE_PUBLISHING_DISABLED"
            },
            { status: 423 }
        );
    }

    const payload = ReleaseTagSchema.parse(await req.json());
    const release = await createWorkspaceReleaseTagByUserId({
        userId: payload.ownerUserId,
        label: payload.label,
        note: payload.note ?? null,
        actorId: admin.user?.uid ?? null,
        actorEmail: admin.user?.email ?? null
    });

    if (!release) {
        return NextResponse.json(
            { error: "Workspace snapshot not found for release tagging." },
            { status: 404 }
        );
    }

    return NextResponse.json({
        ok: true,
        release,
        role: admin.role
    });
}
