import { adminDb } from "@/lib/firebase-admin";

function webhookEventsCollection() {
    return adminDb.collection("webhookEvents");
}

function docId(provider: string, eventId: string) {
    return `${provider}_${eventId}`;
}

export async function recordWebhookEventIfNew(input: {
    provider: string;
    eventId: string;
    eventName: string;
    payload: string;
}) {
    if (!input.eventId) return true;

    const ref = webhookEventsCollection().doc(docId(input.provider, input.eventId));
    try {
        await ref.create({
            provider: input.provider,
            eventId: input.eventId,
            eventName: input.eventName,
            payload: input.payload,
            processedAt: new Date()
        });
        return true;
    } catch (error) {
        const code = (error as { code?: number | string } | null)?.code;
        if (code === 6 || code === "already-exists") {
            return false;
        }
        throw error;
    }
}
