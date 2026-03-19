import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/admin-api";
import { listTenants } from "@/lib/data/tenants";

export const runtime = "nodejs";

export async function GET() {
    const admin = await requireAdminRoute();
    if (admin.error) return admin.error;

    const tenants = await listTenants(40);
    return NextResponse.json({ tenants });
}
