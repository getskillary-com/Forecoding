import { adminDb } from "@/lib/firebase-admin";
import { toDateOrNull } from "./firestore-utils";

export type ProjectPurchaseStatus = "PENDING" | "SUCCEEDED" | "CANCELLED" | "FAILED" | "REFUNDED";

type UpsertPurchaseInput = {
    userId: string;
    projectId: string;
    provider: string;
    status: ProjectPurchaseStatus;
    amount: number;
    currency: string;
    requestId: string;
    merchantOrderId: string;
    paymentIntentId?: string | null;
    paidAt?: Date | null;
    refundedAt?: Date | null;
};

function docId(userId: string, projectId: string) {
    return `${userId}_${projectId}`;
}

function purchasesCollection() {
    return adminDb.collection("projectPurchases");
}

export async function upsertProjectPurchase(input: UpsertPurchaseInput) {
    const now = new Date();
    const ref = purchasesCollection().doc(docId(input.userId, input.projectId));
    const existing = await ref.get();
    const existingData = existing.data() || {};
    const alreadySucceeded = existingData.status === "SUCCEEDED";

    await ref.set(
        {
            userId: input.userId,
            projectId: input.projectId,
            provider: input.provider,
            status: input.status,
            amount: Math.max(0, Math.round(input.amount)),
            currency: (input.currency || "usd").toLowerCase(),
            requestId: input.requestId,
            merchantOrderId: input.merchantOrderId,
            paymentIntentId: input.paymentIntentId || existingData.paymentIntentId || null,
            paidAt: input.paidAt || null,
            refundedAt: input.refundedAt || null,
            updatedAt: now,
            ...(existing.exists ? {} : { createdAt: now })
        },
        { merge: true }
    );

    return { alreadySucceeded };
}

export async function getProjectPurchase(userId: string, projectId: string) {
    const ref = purchasesCollection().doc(docId(userId, projectId));
    const snap = await ref.get();
    if (!snap.exists) return null;
    const data = snap.data() || {};
    return {
        userId,
        projectId,
        status: typeof data.status === "string" ? data.status : "PENDING",
        amount: typeof data.amount === "number" ? data.amount : 0,
        currency: typeof data.currency === "string" ? data.currency : "usd",
        paidAt: toDateOrNull(data.paidAt)
    };
}

