import { z } from "zod";
import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/admin-api";
import {
    ensureOrgRecord,
    listOrgs,
    syncOrgTenantCount,
    updateOrgStatus
} from "@/lib/data/orgs";

export const runtime = "nodejs";

const UpsertOrgSchema = z.object({
    orgId: z.string().trim().min(1),
    name: z.string().trim().min(1).max(120).optional(),
    slug: z.string().trim().max(120).optional(),
    status: z.enum(["active", "suspended"]).optional()
});

const UpdateOrgStatusSchema = z.object({
    orgId: z.string().trim().min(1),
    status: z.enum(["active", "suspended"]),
    reason: z.string().trim().max(240).optional()
});

export async function GET() {
    const admin = await requireAdminRoute();
    if (admin.error) return admin.error;

    const orgs = await listOrgs(40);
    return NextResponse.json({ orgs, role: admin.role });
}

export async function POST(req: Request) {
    const admin = await requireAdminRoute({ minimumCapability: "orgs_manage" });
    if (admin.error) return admin.error;

    const payload = UpsertOrgSchema.parse(await req.json());
    const org = await ensureOrgRecord({
        orgId: payload.orgId,
        name: payload.name ?? null,
        slug: payload.slug ?? null,
        status: payload.status
    });
    if (!org) {
        return NextResponse.json({ error: "Failed to create or update organization." }, { status: 500 });
    }
    const synced = await syncOrgTenantCount(org.id);
    return NextResponse.json({ ok: true, org: synced ?? org, role: admin.role });
}

export async function PATCH(req: Request) {
    const admin = await requireAdminRoute({ minimumCapability: "orgs_manage" });
    if (admin.error) return admin.error;

    const payload = UpdateOrgStatusSchema.parse(await req.json());
    const org = await updateOrgStatus({
        orgId: payload.orgId,
        status: payload.status,
        reason: payload.reason ?? null,
        actorId: admin.user?.uid ?? null,
        actorEmail: admin.user?.email ?? null
    });
    if (!org) {
        return NextResponse.json({ error: "Organization not found." }, { status: 404 });
    }

    const synced = await syncOrgTenantCount(org.id);
    return NextResponse.json({ ok: true, org: synced ?? org, role: admin.role });
}
