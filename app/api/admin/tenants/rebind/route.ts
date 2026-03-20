import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminRoute } from "@/lib/admin-api";
import { recordAuditEvent } from "@/lib/data/audit-events";
import { getTenantById } from "@/lib/data/tenants";
import { getUserProfileByUid, setUserTenantByUid } from "@/lib/data/users";
import { setWorkspaceTenantByUserId } from "@/lib/data/workspaces";

export const runtime = "nodejs";

const RebindTenantSchema = z.object({
    ownerUserId: z.string().trim().min(1),
    tenantId: z.string().trim().min(1),
    reason: z.string().trim().max(240).optional()
});

export async function POST(req: Request) {
    const admin = await requireAdminRoute({ minimumCapability: "tenants_manage" });
    if (admin.error) return admin.error;

    const payload = RebindTenantSchema.parse(await req.json());
    const tenant = await getTenantById(payload.tenantId);
    if (!tenant) {
        return NextResponse.json({ error: "Tenant not found." }, { status: 404 });
    }

    const profile = await getUserProfileByUid(payload.ownerUserId);
    if (!profile) {
        return NextResponse.json({ error: "User profile not found." }, { status: 404 });
    }

    const previousTenantId = profile.tenantId ?? null;
    const updatedProfile = await setUserTenantByUid({
        uid: profile.uid,
        tenantId: tenant.id
    });
    if (!updatedProfile) {
        return NextResponse.json({ error: "Failed to update user tenant assignment." }, { status: 500 });
    }

    const reboundWorkspace = await setWorkspaceTenantByUserId({
        userId: profile.uid,
        tenantId: tenant.id,
        actorId: admin.user?.uid ?? null,
        actorEmail: admin.user?.email ?? null,
        reason: payload.reason ?? null
    });

    await recordAuditEvent({
        eventType: "tenant.user_reassigned",
        severity: previousTenantId === tenant.id ? "info" : "warning",
        actorId: admin.user?.uid ?? null,
        actorEmail: admin.user?.email ?? null,
        resourceType: "tenant",
        resourceId: tenant.id,
        summary: `User ${profile.uid} was reassigned to tenant ${tenant.id}.`,
        metadata: {
            userId: profile.uid,
            previousTenantId: previousTenantId || "",
            tenantId: tenant.id,
            reason: payload.reason || "",
            workspaceRebound: reboundWorkspace ? "true" : "false",
            workspaceRevision: reboundWorkspace ? String(reboundWorkspace.revision) : ""
        }
    });

    return NextResponse.json({
        ok: true,
        userId: profile.uid,
        previousTenantId,
        tenantId: tenant.id,
        workspaceRebound: Boolean(reboundWorkspace),
        workspaceRevision: reboundWorkspace?.revision ?? null,
        role: admin.role
    });
}
