import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/admin-api";
import { buildObservabilitySnapshot } from "@/lib/data/observability";

export const runtime = "nodejs";

export async function GET() {
    const admin = await requireAdminRoute();
    if (admin.error) return admin.error;

    const snapshot = await buildObservabilitySnapshot({
        windowMs: 24 * 60 * 60 * 1000,
        maxAlerts: 16
    });
    return NextResponse.json({ snapshot, role: admin.role });
}
