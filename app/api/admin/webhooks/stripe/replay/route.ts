import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminRoute } from "@/lib/admin-api";
import { recordAuditEvent } from "@/lib/data/audit-events";
import { isFeatureFlagEnabled } from "@/lib/data/feature-flags";
import { getWebhookEvent, recordWebhookReplay } from "@/lib/data/webhook-events";
import { processStripeWebhookEvent } from "@/lib/stripe-webhook-processing";
import type { StripeEvent } from "@/lib/stripe-webhook";

export const runtime = "nodejs";

const ReplaySchema = z.object({
    eventId: z.string().trim().min(1)
});

export async function POST(req: Request) {
    const admin = await requireAdminRoute({ minimumRole: "operator" });
    if (admin.error) return admin.error;

    const replayEnabled = await isFeatureFlagEnabled("stripe.webhook_replay.enabled", true);
    if (!replayEnabled) {
        return NextResponse.json(
            {
                error: "Webhook replay is currently disabled by feature flag.",
                code: "WEBHOOK_REPLAY_DISABLED"
            },
            { status: 423 }
        );
    }

    const payload = ReplaySchema.parse(await req.json());
    const storedEvent = await getWebhookEvent("stripe", payload.eventId);
    if (!storedEvent) {
        return NextResponse.json(
            { error: "Stored Stripe webhook event not found." },
            { status: 404 }
        );
    }

    try {
        const event = JSON.parse(storedEvent.payload) as StripeEvent;
        const result = await processStripeWebhookEvent(event, { mode: "replay" });
        await recordWebhookReplay({
            provider: "stripe",
            eventId: storedEvent.eventId,
            status: "succeeded"
        });
        await recordAuditEvent({
            eventType: "stripe.webhook_replayed",
            severity: "warning",
            actorId: admin.user?.uid ?? null,
            actorEmail: admin.user?.email ?? null,
            resourceType: "webhookEvent",
            resourceId: storedEvent.eventId,
            summary: `Stripe webhook ${storedEvent.eventId} was replayed from the admin console.`,
            metadata: {
                provider: "stripe",
                eventId: storedEvent.eventId,
                eventName: storedEvent.eventName,
                role: admin.role
            }
        });

        return NextResponse.json({
            ok: true,
            result,
            event: {
                eventId: storedEvent.eventId,
                eventName: storedEvent.eventName
            }
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to replay webhook.";
        await recordWebhookReplay({
            provider: "stripe",
            eventId: storedEvent.eventId,
            status: "failed",
            errorMessage: message
        });
        await recordAuditEvent({
            eventType: "stripe.webhook_replay_failed",
            severity: "critical",
            actorId: admin.user?.uid ?? null,
            actorEmail: admin.user?.email ?? null,
            resourceType: "webhookEvent",
            resourceId: storedEvent.eventId,
            summary: `Stripe webhook ${storedEvent.eventId} replay failed.`,
            metadata: {
                provider: "stripe",
                eventId: storedEvent.eventId,
                eventName: storedEvent.eventName,
                error: message
            }
        });

        return NextResponse.json(
            {
                error: message,
                code: "WEBHOOK_REPLAY_FAILED"
            },
            { status: 500 }
        );
    }
}
