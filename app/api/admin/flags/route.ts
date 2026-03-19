import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminRoute } from "@/lib/admin-api";
import { listFeatureFlags, upsertFeatureFlag } from "@/lib/data/feature-flags";

export const runtime = "nodejs";

const FeatureFlagSchema = z.object({
    key: z.string().trim().min(1),
    description: z.string().trim().max(240).default(""),
    enabled: z.boolean(),
    scope: z.enum(["global", "tenant", "workspace"]).default("global"),
    value: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional()
});

export async function GET() {
    const admin = await requireAdminRoute();
    if (admin.error) return admin.error;

    const flags = await listFeatureFlags(50);
    return NextResponse.json({ flags });
}

export async function POST(req: Request) {
    const admin = await requireAdminRoute({ minimumRole: "operator" });
    if (admin.error) return admin.error;

    const flag = FeatureFlagSchema.parse(await req.json());
    const now = Date.now();
    const saved = await upsertFeatureFlag({
        ...flag,
        updatedAt: now,
        updatedBy: admin.user?.email || admin.user?.uid || null
    });

    return NextResponse.json({ ok: true, flag: saved, role: admin.role });
}
