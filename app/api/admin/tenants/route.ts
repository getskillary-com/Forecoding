import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminRoute } from "@/lib/admin-api";
import { listTenants, syncTenantWorkspaceCount, updateTenantStatus } from "@/lib/data/tenants";

export const runtime = "nodejs";

const UpdateTenantSchema = z.object({
    tenantId: z.string().trim().min(1),
    status: z.enum(["active", "trial", "suspended"]),
    reason: z.string().trim().max(240).optional()
});

export async function GET() {
    const admin = await requireAdminRoute();
    if (admin.error) return admin.error;

    const tenants = await listTenants(40);
    return NextResponse.json({ tenants });
}

export async function PATCH(req: Request) {
    const admin = await requireAdminRoute({ minimumCapability: "tenants_manage" });
    if (admin.error) return admin.error;

    const payload = UpdateTenantSchema.parse(await req.json());
    const tenant = await updateTenantStatus({
        tenantId: payload.tenantId,
        status: payload.status,
        reason: payload.reason ?? null,
        actorId: admin.user?.uid ?? null,
        actorEmail: admin.user?.email ?? null
    });

    if (!tenant) {
        return NextResponse.json(
            { error: "Tenant not found." },
            { status: 404 }
        );
    }
    const syncedTenant = await syncTenantWorkspaceCount(tenant.id);

    return NextResponse.json({ ok: true, tenant: syncedTenant ?? tenant, role: admin.role });
}
