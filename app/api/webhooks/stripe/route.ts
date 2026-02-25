import { NextResponse } from "next/server";
import { getStripeWebhookSecret } from "@/lib/stripe";
import { StripeEvent, verifyStripeWebhookSignature } from "@/lib/stripe-webhook";

export const runtime = "nodejs";

function getString(value: unknown) {
    return typeof value === "string" ? value : "";
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

    if (type === "checkout.session.completed") {
        const sessionId = getString(object.id);
        const paymentStatus = getString(object.payment_status);
        const clientReferenceId = getString(object.client_reference_id);
        const metadata = (object.metadata as Record<string, unknown> | undefined) || {};
        const userId = getString(metadata.userId);
        const projectId = getString(metadata.projectId);

        // TODO: Persist the purchase and unlock project usage for userId/projectId.
        console.log("[stripe] checkout.session.completed", {
            eventId,
            sessionId,
            paymentStatus,
            clientReferenceId,
            userId,
            projectId
        });
    } else if (type) {
        console.log("[stripe] webhook received", { eventId, type });
    }

    return NextResponse.json({ received: true });
}
