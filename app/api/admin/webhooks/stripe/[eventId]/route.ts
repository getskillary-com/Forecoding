import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/admin-api";
import { getWebhookEvent } from "@/lib/data/webhook-events";

export const runtime = "nodejs";

export async function GET(
    _req: Request,
    context: { params: Promise<{ eventId: string }> }
) {
    const admin = await requireAdminRoute();
    if (admin.error) return admin.error;

    const params = await context.params;
    const event = await getWebhookEvent("stripe", params.eventId);
    if (!event) {
        return NextResponse.json(
            { error: "Webhook event not found." },
            { status: 404 }
        );
    }

    return NextResponse.json({ event, role: admin.role });
}
