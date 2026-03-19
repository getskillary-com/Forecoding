import { adminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { toDateOrNull } from "./firestore-utils";
import type { WebhookEventRecord } from "@/types";

type ReplayStatus = "succeeded" | "failed";

function webhookEventsCollection() {
    return adminDb.collection("webhookEvents");
}

function docId(provider: string, eventId: string) {
    return `${provider}_${eventId}`;
}

function mapWebhookEvent(data: Record<string, unknown>): WebhookEventRecord {
    return {
        provider: typeof data.provider === "string" ? data.provider : "unknown",
        eventId: typeof data.eventId === "string" ? data.eventId : "",
        eventName: typeof data.eventName === "string" ? data.eventName : "unknown",
        payload: typeof data.payload === "string" ? data.payload : "",
        processedAt: toDateOrNull(data.processedAt)?.getTime() || Date.now(),
        replayCount: typeof data.replayCount === "number" ? Math.max(0, Math.round(data.replayCount)) : 0,
        lastReplayedAt: toDateOrNull(data.lastReplayedAt)?.getTime() || null,
        lastReplayStatus:
            data.lastReplayStatus === "succeeded" || data.lastReplayStatus === "failed"
                ? data.lastReplayStatus
                : null,
        lastReplayError: typeof data.lastReplayError === "string" ? data.lastReplayError : null
    };
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
            processedAt: new Date(),
            replayCount: 0,
            lastReplayedAt: null,
            lastReplayStatus: null,
            lastReplayError: null
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

export async function getWebhookEvent(provider: string, eventId: string): Promise<WebhookEventRecord | null> {
    const normalizedEventId = eventId.trim();
    if (!normalizedEventId) return null;

    const snap = await webhookEventsCollection().doc(docId(provider, normalizedEventId)).get();
    if (!snap.exists) return null;
    return mapWebhookEvent(snap.data() || {});
}

export async function listWebhookEvents(input?: {
    provider?: string;
    eventName?: string;
    query?: string;
    limit?: number;
}): Promise<WebhookEventRecord[]> {
    const provider = (input?.provider || "").trim().toLowerCase();
    const eventName = (input?.eventName || "").trim().toLowerCase();
    const query = (input?.query || "").trim().toLowerCase();
    const limit = Math.max(1, Math.min(100, input?.limit ?? 40));

    const snap = await webhookEventsCollection()
        .orderBy("processedAt", "desc")
        .limit(Math.max(limit, 60))
        .get();

    return snap.docs
        .map((doc) => mapWebhookEvent(doc.data() || {}))
        .filter((event) => {
            if (provider && event.provider.toLowerCase() !== provider) return false;
            if (eventName && event.eventName.toLowerCase() !== eventName) return false;
            if (query) {
                const haystack = [
                    event.eventId,
                    event.eventName,
                    event.provider,
                    event.payload
                ].join(" ").toLowerCase();
                if (!haystack.includes(query)) return false;
            }
            return true;
        })
        .slice(0, limit);
}

export async function recordWebhookReplay(input: {
    provider: string;
    eventId: string;
    status: ReplayStatus;
    errorMessage?: string | null;
}) {
    const ref = webhookEventsCollection().doc(docId(input.provider, input.eventId));
    await ref.set({
        replayCount: FieldValue.increment(1),
        lastReplayedAt: new Date(),
        lastReplayStatus: input.status,
        lastReplayError: input.errorMessage ?? null
    }, { merge: true });
}
