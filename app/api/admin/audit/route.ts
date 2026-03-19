import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/admin-api";
import { searchAuditEvents } from "@/lib/data/audit-events";

export const runtime = "nodejs";

export async function GET(req: Request) {
    const admin = await requireAdminRoute();
    if (admin.error) return admin.error;

    const url = new URL(req.url);
    const severity = (url.searchParams.get("severity") || "") as "" | "info" | "warning" | "critical";
    const resourceType = url.searchParams.get("resourceType") || "";
    const eventType = url.searchParams.get("eventType") || "";
    const query = url.searchParams.get("query") || "";
    const limit = Number.parseInt(url.searchParams.get("limit") || "40", 10);

    const events = await searchAuditEvents({
        severity,
        resourceType,
        eventType,
        query,
        limit: Number.isFinite(limit) ? limit : 40
    });
    return NextResponse.json({ events });
}
