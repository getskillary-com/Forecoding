import { NextResponse } from "next/server";
import { getStripeWebhookSecret } from "@/lib/stripe";
import { StripeEvent, verifyStripeWebhookSignature } from "@/lib/stripe-webhook";
import { recordWebhookEventIfNew } from "@/lib/data/webhook-events";
import { processStripeWebhookEvent } from "@/lib/stripe-webhook-processing";

export const runtime = "nodejs";

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

    const type = typeof event.type === "string" ? event.type : "";
    const eventId = typeof event.id === "string" ? event.id : "";
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

    const result = await processStripeWebhookEvent(event, { mode: "live" });
    return NextResponse.json({ received: true, result });
}
