import { NextResponse } from "next/server";
import { getStripeWebhookSecret } from "@/lib/stripe";
import { StripeEvent, verifyStripeWebhookSignature } from "@/lib/stripe-webhook";
import { sendProjectOrderEmail } from "@/lib/mailer";
import { recordWebhookEventIfNew } from "@/lib/data/webhook-events";
import { upsertProjectPurchase } from "@/lib/data/purchases";
import { markProjectPaidInWorkspace } from "@/lib/data/workspaces";
import { getUserProfileByUid } from "@/lib/data/users";

export const runtime = "nodejs";

function getString(value: unknown) {
    return typeof value === "string" ? value : "";
}

function getNumber(value: unknown) {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function getObject(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object") return {};
    return value as Record<string, unknown>;
}

function resolvePurchaseContext(input: {
    metadata: Record<string, unknown>;
    clientReferenceId: string;
}) {
    const metadataUserId = getString(input.metadata.userId);
    const metadataProjectId = getString(input.metadata.projectId);

    let clientRefUserId = "";
    let clientRefProjectId = "";
    if (input.clientReferenceId.includes(":")) {
        const [left, ...rest] = input.clientReferenceId.split(":");
        clientRefUserId = left?.trim() || "";
        clientRefProjectId = rest.join(":").trim();
    }

    return {
        userId: metadataUserId || clientRefUserId,
        projectId: metadataProjectId || clientRefProjectId
    };
}

export async function POST(req: Request) {
    const signature = req.headers.get("stripe-signature") || "";
    const webhookSecret = getStripeWebhookSecret();

    if (!webhookSecret) {
        return NextResponse.json(
            { error: "Stripe webhook is not configured. Missing STRIPE_WEBHOOK_SECRET." },
            { status: 500 }
        );
    }

    if (!signature) {
        return NextResponse.json({ error: "Missing stripe-signature header." }, { status: 400 });
    }

    const payload = await req.text();
    const isValid = verifyStripeWebhookSignature(payload, signature, webhookSecret);
    if (!isValid) {
        return NextResponse.json({ error: "Invalid Stripe signature." }, { status: 400 });
    }

    let event: StripeEvent;
    try {
        event = JSON.parse(payload) as StripeEvent;
    } catch {
        return NextResponse.json({ error: "Invalid webhook payload JSON." }, { status: 400 });
    }

    const type = getString(event.type);
    const object = event.data?.object || {};
    const eventId = getString(event.id);
    const payloadText = JSON.stringify(event);

    const shouldProcess = await recordWebhookEventIfNew({
        provider: "stripe",
        eventId,
        eventName: type || "unknown",
        payload: payloadText
    });
    if (!shouldProcess) {
        return NextResponse.json({ received: true, duplicate: true });
    }

    if (type === "checkout.session.completed") {
        const session = getObject(object);
        const sessionId = getString(session.id);
        const paymentStatus = getString(session.payment_status);
        const paymentIntentId = getString(session.payment_intent);
        const amountTotal = getNumber(session.amount_total);
        const currency = getString(session.currency).toLowerCase() || "usd";
        const clientReferenceId = getString(session.client_reference_id);
        const metadata = getObject(session.metadata);
        const customerDetails = getObject(session.customer_details);
        const customerEmail =
            getString(customerDetails.email) ||
            getString(session.customer_email) ||
            getString(metadata.email);
        const projectName = getString(metadata.projectName) || "Project Credit";

        const { userId, projectId } = resolvePurchaseContext({
            metadata,
            clientReferenceId
        });

        if (!userId || !projectId) {
            console.warn("[stripe] Missing userId/projectId in completed checkout session.", {
                eventId,
                sessionId,
                clientReferenceId,
                metadata
            });
            return NextResponse.json({ received: true, ignored: "missing_purchase_context" });
        }

        const paid = paymentStatus === "paid";

        const purchaseWrite = await upsertProjectPurchase({
            userId,
            projectId,
            provider: "stripe",
            status: paid ? "SUCCEEDED" : "PENDING",
            amount: amountTotal,
            currency,
            requestId: sessionId || `${userId}:${projectId}`,
            merchantOrderId: sessionId || `${userId}:${projectId}`,
            paymentIntentId: paymentIntentId || null,
            paidAt: paid ? new Date() : null
        });

        if (paid) {
            await markProjectPaidInWorkspace(userId, projectId);

            let emailToSend = customerEmail;
            if (!emailToSend) {
                const profile = await getUserProfileByUid(userId);
                emailToSend = profile?.email || "";
            }

            if (emailToSend && !purchaseWrite.alreadySucceeded) {
                try {
                    await sendProjectOrderEmail({
                        email: emailToSend,
                        projectName,
                        orderId: sessionId || `${userId}:${projectId}`,
                        amountCents: amountTotal,
                        currency,
                        paidAt: new Date()
                    });
                } catch (error) {
                    console.error("[stripe] Failed to send order email:", error);
                }
            } else if (emailToSend) {
                console.log("[stripe] Order email skipped because purchase was already marked succeeded.", {
                    eventId,
                    sessionId,
                    userId,
                    projectId
                });
            } else {
                console.warn("[stripe] Paid session has no resolvable email. Skipping order email.", {
                    eventId,
                    sessionId,
                    userId,
                    projectId
                });
            }
        }

        console.log("[stripe] checkout.session.completed processed", {
            eventId,
            sessionId,
            paymentStatus,
            clientReferenceId,
            userId,
            projectId,
            email: customerEmail || null
        });
    } else if (type) {
        console.log("[stripe] webhook received", { eventId, type });
    }

    return NextResponse.json({ received: true });
}

