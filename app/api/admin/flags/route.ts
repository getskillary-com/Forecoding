import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminRoute } from "@/lib/admin-api";
import { listFeatureFlags, upsertFeatureFlag } from "@/lib/data/feature-flags";
import { getTenantById } from "@/lib/data/tenants";
import { getWorkspaceEnvelopeByUserId } from "@/lib/data/workspaces";

export const runtime = "nodejs";

const FeatureFlagSchema = z.object({
    key: z.string().trim().min(1),
    description: z.string().trim().max(240).default(""),
    enabled: z.boolean(),
    scope: z.enum(["global", "tenant", "workspace"]).default("global"),
    scopeId: z.string().trim().max(120).optional(),
    value: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional()
}).superRefine((value, ctx) => {
    if (value.scope !== "global" && !value.scopeId?.trim()) {
        ctx.addIssue({
            code: "custom",
            path: ["scopeId"],
            message: "scopeId is required for tenant/workspace scoped flags."
        });
    }
});

export async function GET() {
    const admin = await requireAdminRoute();
    if (admin.error) return admin.error;

    const flags = await listFeatureFlags(50);
    return NextResponse.json({ flags });
}

export async function POST(req: Request) {
    const admin = await requireAdminRoute({ minimumCapability: "feature_flags_write" });
    if (admin.error) return admin.error;

    const flag = FeatureFlagSchema.parse(await req.json());
    if (flag.scope === "tenant") {
        const tenant = await getTenantById(flag.scopeId || "");
        if (!tenant) {
            return NextResponse.json(
                { error: "Tenant scopeId not found." },
                { status: 404 }
            );
        }
    }
    if (flag.scope === "workspace") {
        const workspace = await getWorkspaceEnvelopeByUserId(flag.scopeId || "");
        if (!workspace) {
            return NextResponse.json(
                { error: "Workspace scopeId not found." },
                { status: 404 }
            );
        }
    }

    const now = Date.now();
    const saved = await upsertFeatureFlag({
        ...flag,
        scopeId: flag.scope === "global" ? null : (flag.scopeId || "").trim(),
        updatedAt: now,
        updatedBy: admin.user?.email || admin.user?.uid || null
    });

    return NextResponse.json({ ok: true, flag: saved, role: admin.role });
}
