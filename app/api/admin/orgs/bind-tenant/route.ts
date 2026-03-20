import { z } from "zod";
import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/admin-api";
import { getOrgById, syncOrgTenantCount } from "@/lib/data/orgs";
import { getTenantById, updateTenantOrgBinding } from "@/lib/data/tenants";

export const runtime = "nodejs";

const BindTenantOrgSchema = z.object({
    tenantId: z.string().trim().min(1),
    orgId: z.string().trim().max(120).nullable().optional(),
    reason: z.string().trim().max(240).optional()
});

export async function POST(req: Request) {
    const admin = await requireAdminRoute({ minimumCapability: "orgs_manage" });
    if (admin.error) return admin.error;

    const payload = BindTenantOrgSchema.parse(await req.json());
    const tenant = await getTenantById(payload.tenantId);
    if (!tenant) {
        return NextResponse.json({ error: "Tenant not found." }, { status: 404 });
    }

    const normalizedOrgId = (payload.orgId || "").trim() || null;
    if (normalizedOrgId) {
        const org = await getOrgById(normalizedOrgId);
        if (!org) {
            return NextResponse.json({ error: "Organization not found." }, { status: 404 });
        }
    }

    const updated = await updateTenantOrgBinding({
        tenantId: tenant.id,
        orgId: normalizedOrgId,
        reason: payload.reason ?? null,
        actorId: admin.user?.uid ?? null,
        actorEmail: admin.user?.email ?? null
    });

    const impactedOrgs = [];
    if (updated.previousOrgId && updated.previousOrgId !== updated.nextOrgId) {
        const previousOrg = await syncOrgTenantCount(updated.previousOrgId);
        if (previousOrg) impactedOrgs.push(previousOrg);
    }
    if (updated.nextOrgId) {
        const nextOrg = await syncOrgTenantCount(updated.nextOrgId);
        if (nextOrg) impactedOrgs.push(nextOrg);
    }

    return NextResponse.json({
        ok: true,
        tenant: updated.tenant,
        previousOrgId: updated.previousOrgId,
        nextOrgId: updated.nextOrgId,
        changed: updated.changed,
        impactedOrgs,
        role: admin.role
    });
}
