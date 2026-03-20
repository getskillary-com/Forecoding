import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminRoute } from "@/lib/admin-api";
import { recordAuditEvent } from "@/lib/data/audit-events";
import { isFeatureFlagEnabledForContext } from "@/lib/data/feature-flags";
import { getUserProfileByUid } from "@/lib/data/users";
import { getWorkspaceEnvelopeByUserId } from "@/lib/data/workspaces";
import { getWebhookEvent, recordWebhookReplay } from "@/lib/data/webhook-events";
import { processStripeWebhookEvent } from "@/lib/stripe-webhook-processing";
import type { StripeEvent } from "@/lib/stripe-webhook";

export const runtime = "nodejs";

const ReplaySchema = z.object({
    eventId: z.string().trim().min(1)
});

function getString(value: unknown) {
    return typeof value === "string" ? value : "";
}

function getObject(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object") return {};
    return value as Record<string, unknown>;
}

function resolveWebhookUserId(event: StripeEvent) {
    const object = getObject(event.data?.object);
    const metadata = getObject(object.metadata);
    const metadataUserId = getString(metadata.userId).trim();
    if (metadataUserId) return metadataUserId;

    const clientReferenceId = getString(object.client_reference_id).trim();
    if (clientReferenceId.includes(":")) {
        const [left] = clientReferenceId.split(":");
        const fromReference = left?.trim() || "";
        if (fromReference) return fromReference;
    }

    return "";
}

export async function POST(req: Request) {
    const admin = await requireAdminRoute({ minimumCapability: "webhooks_replay" });
    if (admin.error) return admin.error;

    const payload = ReplaySchema.parse(await req.json());
    const storedEvent = await getWebhookEvent("stripe", payload.eventId);
    if (!storedEvent) {
        return NextResponse.json(
            { error: "Stored Stripe webhook event not found." },
            { status: 404 }
        );
    }

    let parsedEvent: StripeEvent;
    try {
        parsedEvent = JSON.parse(storedEvent.payload) as StripeEvent;
    } catch {
        return NextResponse.json(
            {
                error: "Stored webhook payload is invalid JSON and cannot be replayed.",
                code: "WEBHOOK_PAYLOAD_INVALID"
            },
            { status: 422 }
        );
    }

    const workspaceId = resolveWebhookUserId(parsedEvent) || null;
    const profile = workspaceId ? await getUserProfileByUid(workspaceId) : null;
    const workspaceEnvelope = workspaceId ? await getWorkspaceEnvelopeByUserId(workspaceId) : null;
    const replayEnabled = await isFeatureFlagEnabledForContext({
        key: "stripe.webhook_replay.enabled",
        fallback: true,
        tenantId: profile?.tenantId ?? workspaceEnvelope?.tenantId ?? null,
        workspaceId
    });
    if (!replayEnabled) {
        return NextResponse.json(
            {
                error: "Webhook replay is currently disabled by feature flag.",
                code: "WEBHOOK_REPLAY_DISABLED"
            },
            { status: 423 }
        );
    }

    try {
        const result = await processStripeWebhookEvent(parsedEvent, { mode: "replay" });
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
                role: admin.role,
                workspaceId: workspaceId || "",
                tenantId: profile?.tenantId ?? workspaceEnvelope?.tenantId ?? ""
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
                error: message,
                workspaceId: workspaceId || "",
                tenantId: profile?.tenantId ?? workspaceEnvelope?.tenantId ?? ""
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
