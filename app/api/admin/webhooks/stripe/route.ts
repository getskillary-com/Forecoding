import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/admin-api";
import { listWebhookEvents } from "@/lib/data/webhook-events";

export const runtime = "nodejs";

export async function GET(req: Request) {
    const admin = await requireAdminRoute();
    if (admin.error) return admin.error;

    const url = new URL(req.url);
    const eventName = url.searchParams.get("eventName") || "";
    const query = url.searchParams.get("query") || "";
    const limit = Number.parseInt(url.searchParams.get("limit") || "30", 10);

    const events = await listWebhookEvents({
        provider: "stripe",
        eventName,
        query,
        limit: Number.isFinite(limit) ? limit : 30
    });

    return NextResponse.json({ events, role: admin.role });
}
