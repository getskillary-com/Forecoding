import { toDateOrNull } from "./firestore-utils";
import type { DocumentData, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import type { BillingEvent } from "@/types";

type BillingEventInput = Omit<BillingEvent, "id" | "createdAt"> & {
    id?: string;
    createdAt?: number;
};

function billingEventsCollection() {
    return adminDb.collection("billingEvents");
}

function randomId() {
    return `billing_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function mapBillingEvent(id: string, data: Record<string, unknown>): BillingEvent {
    const provider: BillingEvent["provider"] = data.provider === "manual" ? "manual" : "stripe";
    const status: BillingEvent["status"] =
        data.status === "pending" ||
        data.status === "failed" ||
        data.status === "refunded"
            ? data.status
            : "succeeded";

    return {
        id,
        provider,
        eventType: typeof data.eventType === "string" ? data.eventType : "unknown",
        status,
        amountCents: typeof data.amountCents === "number" ? Math.max(0, Math.round(data.amountCents)) : 0,
        currency: typeof data.currency === "string" ? data.currency : "usd",
        createdAt: toDateOrNull(data.createdAt)?.getTime() || Date.now(),
        relatedProjectId: typeof data.relatedProjectId === "string" ? data.relatedProjectId : null,
        userId: typeof data.userId === "string" ? data.userId : null,
        tenantId: typeof data.tenantId === "string" ? data.tenantId : null,
        providerEventId: typeof data.providerEventId === "string" ? data.providerEventId : null,
        paymentIntentId: typeof data.paymentIntentId === "string" ? data.paymentIntentId : null,
        invoiceId: typeof data.invoiceId === "string" ? data.invoiceId : null,
        refundId: typeof data.refundId === "string" ? data.refundId : null,
        merchantOrderId: typeof data.merchantOrderId === "string" ? data.merchantOrderId : null,
        requestId: typeof data.requestId === "string" ? data.requestId : null,
        workspaceSnapshotId: typeof data.workspaceSnapshotId === "string" ? data.workspaceSnapshotId : null,
        workspaceRevision:
            typeof data.workspaceRevision === "number" && Number.isInteger(data.workspaceRevision) && data.workspaceRevision >= 0
                ? data.workspaceRevision
                : null,
        metadata: typeof data.metadata === "object" && data.metadata
            ? Object.fromEntries(
                Object.entries(data.metadata as Record<string, unknown>)
                    .filter(([, value]) => ["string", "number", "boolean"].includes(typeof value))
                    .map(([key, value]) => [key, String(value)])
            )
            : undefined
    };
}

export async function recordBillingEvent(input: BillingEventInput): Promise<BillingEvent> {
    const id = input.id || randomId();
    const createdAt = input.createdAt ?? Date.now();
    const event: BillingEvent = {
        id,
        provider: input.provider,
        eventType: input.eventType,
        status: input.status,
        amountCents: Math.max(0, Math.round(input.amountCents)),
        currency: (input.currency || "usd").toLowerCase(),
        createdAt,
        relatedProjectId: input.relatedProjectId ?? null,
        userId: input.userId ?? null,
        tenantId: input.tenantId ?? null,
        providerEventId: input.providerEventId ?? null,
        paymentIntentId: input.paymentIntentId ?? null,
        invoiceId: input.invoiceId ?? null,
        refundId: input.refundId ?? null,
        merchantOrderId: input.merchantOrderId ?? null,
        requestId: input.requestId ?? null,
        workspaceSnapshotId: input.workspaceSnapshotId ?? null,
        workspaceRevision:
            typeof input.workspaceRevision === "number" && Number.isInteger(input.workspaceRevision) && input.workspaceRevision >= 0
                ? input.workspaceRevision
                : null,
        metadata: input.metadata ?? undefined
    };

    await billingEventsCollection().doc(id).set({
        provider: event.provider,
        eventType: event.eventType,
        status: event.status,
        amountCents: event.amountCents,
        currency: event.currency,
        relatedProjectId: event.relatedProjectId ?? null,
        userId: event.userId ?? null,
        tenantId: event.tenantId ?? null,
        providerEventId: event.providerEventId ?? null,
        paymentIntentId: event.paymentIntentId ?? null,
        invoiceId: event.invoiceId ?? null,
        refundId: event.refundId ?? null,
        merchantOrderId: event.merchantOrderId ?? null,
        requestId: event.requestId ?? null,
        workspaceSnapshotId: event.workspaceSnapshotId ?? null,
        workspaceRevision:
            typeof event.workspaceRevision === "number" && Number.isInteger(event.workspaceRevision) && event.workspaceRevision >= 0
                ? event.workspaceRevision
                : null,
        metadata: event.metadata ?? {},
        createdAt: new Date(event.createdAt)
    });

    return event;
}

export async function listBillingEvents(input?: {
    limit?: number;
    provider?: BillingEvent["provider"] | "";
    status?: BillingEvent["status"] | "";
    userId?: string;
    tenantId?: string;
    projectId?: string;
    workspaceSnapshotId?: string;
    workspaceRevision?: number;
    query?: string;
}): Promise<BillingEvent[]> {
    const provider = (input?.provider || "").trim().toLowerCase();
    const status = (input?.status || "").trim().toLowerCase();
    const userId = (input?.userId || "").trim();
    const tenantId = (input?.tenantId || "").trim();
    const projectId = (input?.projectId || "").trim();
    const workspaceSnapshotId = (input?.workspaceSnapshotId || "").trim();
    const workspaceRevision =
        typeof input?.workspaceRevision === "number" && Number.isInteger(input.workspaceRevision) && input.workspaceRevision >= 0
            ? input.workspaceRevision
            : null;
    const query = (input?.query || "").trim().toLowerCase();
    const limit = Math.max(1, Math.min(100, input?.limit ?? 40));

    const snap = await billingEventsCollection()
        .orderBy("createdAt", "desc")
        .limit(Math.max(limit, 100))
        .get();

    return snap.docs
        .map((doc: QueryDocumentSnapshot<DocumentData>) => mapBillingEvent(doc.id, doc.data() || {}))
        .filter((event: BillingEvent) => {
            if (provider && event.provider.toLowerCase() !== provider) return false;
            if (status && event.status.toLowerCase() !== status) return false;
            if (userId && (event.userId || "") !== userId) return false;
            if (tenantId && (event.tenantId || "") !== tenantId) return false;
            if (projectId && (event.relatedProjectId || "") !== projectId) return false;
            if (workspaceSnapshotId && (event.workspaceSnapshotId || "") !== workspaceSnapshotId) return false;
            if (workspaceRevision !== null && event.workspaceRevision !== workspaceRevision) return false;
            if (query) {
                const haystack = [
                    event.id,
                    event.eventType,
                    event.provider,
                    event.status,
                    event.userId || "",
                    event.tenantId || "",
                    event.relatedProjectId || "",
                    event.providerEventId || "",
                    event.paymentIntentId || "",
                    event.invoiceId || "",
                    event.refundId || "",
                    event.merchantOrderId || "",
                    event.requestId || "",
                    event.workspaceSnapshotId || "",
                    typeof event.workspaceRevision === "number" ? String(event.workspaceRevision) : "",
                    JSON.stringify(event.metadata || {})
                ].join(" ").toLowerCase();
                if (!haystack.includes(query)) return false;
            }
            return true;
        })
        .slice(0, limit);
}
