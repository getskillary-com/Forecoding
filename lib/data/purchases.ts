import { adminDb } from "@/lib/firebase-admin";
import { toDateOrNull } from "./firestore-utils";
import type { ProjectPurchase } from "@/types";

export type ProjectPurchaseStatus = ProjectPurchase["status"];

type UpsertPurchaseInput = {
    userId: string;
    projectId: string;
    tenantId?: string | null;
    provider: ProjectPurchase["provider"];
    status: ProjectPurchaseStatus;
    amount: number;
    currency: string;
    requestId: string;
    merchantOrderId: string;
    paymentIntentId?: string | null;
    sessionId?: string | null;
    invoiceId?: string | null;
    refundId?: string | null;
    customerEmail?: string | null;
    providerEventId?: string | null;
    providerEventType?: string | null;
    workspaceSnapshotId?: string | null;
    workspaceRevision?: number | null;
    paidAt?: Date | null;
    refundedAt?: Date | null;
};

function docId(userId: string, projectId: string) {
    return `${userId}_${projectId}`;
}

function purchasesCollection() {
    return adminDb.collection("projectPurchases");
}

function normalizeStatus(value: unknown): ProjectPurchaseStatus {
    if (
        value === "SUCCEEDED" ||
        value === "CANCELLED" ||
        value === "FAILED" ||
        value === "REFUNDED"
    ) {
        return value;
    }
    return "PENDING";
}

function mapProjectPurchase(id: string, data: Record<string, unknown>): ProjectPurchase {
    return {
        id,
        userId: typeof data.userId === "string" ? data.userId : "",
        projectId: typeof data.projectId === "string" ? data.projectId : "",
        tenantId: typeof data.tenantId === "string" ? data.tenantId : null,
        provider: data.provider === "manual" ? "manual" : "stripe",
        status: normalizeStatus(data.status),
        amount: typeof data.amount === "number" ? Math.max(0, Math.round(data.amount)) : 0,
        currency: typeof data.currency === "string" ? data.currency : "usd",
        requestId: typeof data.requestId === "string" ? data.requestId : "",
        merchantOrderId: typeof data.merchantOrderId === "string" ? data.merchantOrderId : "",
        paymentIntentId: typeof data.paymentIntentId === "string" ? data.paymentIntentId : null,
        sessionId: typeof data.sessionId === "string" ? data.sessionId : null,
        invoiceId: typeof data.invoiceId === "string" ? data.invoiceId : null,
        refundId: typeof data.refundId === "string" ? data.refundId : null,
        customerEmail: typeof data.customerEmail === "string" ? data.customerEmail : null,
        providerEventId: typeof data.providerEventId === "string" ? data.providerEventId : null,
        providerEventType: typeof data.providerEventType === "string" ? data.providerEventType : null,
        workspaceSnapshotId: typeof data.workspaceSnapshotId === "string" ? data.workspaceSnapshotId : null,
        workspaceRevision:
            typeof data.workspaceRevision === "number" && Number.isInteger(data.workspaceRevision) && data.workspaceRevision >= 0
                ? data.workspaceRevision
                : null,
        paidAt: toDateOrNull(data.paidAt)?.getTime() || null,
        refundedAt: toDateOrNull(data.refundedAt)?.getTime() || null,
        createdAt: toDateOrNull(data.createdAt)?.getTime() || Date.now(),
        updatedAt: toDateOrNull(data.updatedAt)?.getTime() || Date.now()
    };
}

async function readProjectPurchaseByDocId(id: string): Promise<ProjectPurchase | null> {
    const ref = purchasesCollection().doc(id);
    const snap = await ref.get();
    if (!snap.exists) return null;
    return mapProjectPurchase(snap.id, snap.data() || {});
}

export async function upsertProjectPurchase(input: UpsertPurchaseInput) {
    const now = new Date();
    const id = docId(input.userId, input.projectId);
    const ref = purchasesCollection().doc(id);
    const existing = await ref.get();
    const existingData = existing.data() || {};
    const alreadySucceeded = existingData.status === "SUCCEEDED";

    await ref.set(
        {
            userId: input.userId,
            projectId: input.projectId,
            tenantId:
                input.tenantId !== undefined
                    ? (input.tenantId || null)
                    : (typeof existingData.tenantId === "string" ? existingData.tenantId : null),
            provider: input.provider,
            status: input.status,
            amount: Math.max(0, Math.round(input.amount)),
            currency: (input.currency || "usd").toLowerCase(),
            requestId: input.requestId,
            merchantOrderId: input.merchantOrderId,
            paymentIntentId: input.paymentIntentId || existingData.paymentIntentId || null,
            sessionId: input.sessionId || existingData.sessionId || null,
            invoiceId: input.invoiceId || existingData.invoiceId || null,
            refundId: input.refundId || existingData.refundId || null,
            customerEmail: input.customerEmail || existingData.customerEmail || null,
            providerEventId: input.providerEventId || existingData.providerEventId || null,
            providerEventType: input.providerEventType || existingData.providerEventType || null,
            workspaceSnapshotId:
                input.workspaceSnapshotId !== undefined
                    ? (input.workspaceSnapshotId || null)
                    : (typeof existingData.workspaceSnapshotId === "string" ? existingData.workspaceSnapshotId : null),
            workspaceRevision:
                typeof input.workspaceRevision === "number" && Number.isInteger(input.workspaceRevision) && input.workspaceRevision >= 0
                    ? input.workspaceRevision
                    : (
                        typeof existingData.workspaceRevision === "number"
                        && Number.isInteger(existingData.workspaceRevision)
                        && existingData.workspaceRevision >= 0
                    )
                    ? existingData.workspaceRevision
                    : null,
            paidAt: input.paidAt || existingData.paidAt || null,
            refundedAt: input.refundedAt || existingData.refundedAt || null,
            updatedAt: now,
            ...(existing.exists ? {} : { createdAt: now })
        },
        { merge: true }
    );

    const purchase = await readProjectPurchaseByDocId(id);
    return {
        alreadySucceeded,
        purchase
    };
}

export async function getProjectPurchase(userId: string, projectId: string): Promise<ProjectPurchase | null> {
    return readProjectPurchaseByDocId(docId(userId, projectId));
}

export async function getProjectPurchaseByPaymentIntentId(paymentIntentId: string): Promise<ProjectPurchase | null> {
    const normalized = paymentIntentId.trim();
    if (!normalized) return null;

    const snap = await purchasesCollection()
        .where("paymentIntentId", "==", normalized)
        .limit(1)
        .get();
    if (snap.empty) return null;
    const doc = snap.docs[0];
    return mapProjectPurchase(doc.id, doc.data() || {});
}

export async function getProjectPurchaseByMerchantOrderId(merchantOrderId: string): Promise<ProjectPurchase | null> {
    const normalized = merchantOrderId.trim();
    if (!normalized) return null;

    const snap = await purchasesCollection()
        .where("merchantOrderId", "==", normalized)
        .limit(1)
        .get();
    if (snap.empty) return null;
    const doc = snap.docs[0];
    return mapProjectPurchase(doc.id, doc.data() || {});
}

export async function markProjectPurchaseRefunded(input: {
    userId: string;
    projectId: string;
    refundId?: string | null;
    providerEventId?: string | null;
    providerEventType?: string | null;
    refundedAt?: Date | null;
}) {
    const id = docId(input.userId, input.projectId);
    const ref = purchasesCollection().doc(id);
    const current = await ref.get();
    if (!current.exists) return null;

    const now = input.refundedAt || new Date();
    await ref.set({
        status: "REFUNDED",
        refundId: input.refundId ?? null,
        providerEventId: input.providerEventId ?? null,
        providerEventType: input.providerEventType ?? null,
        refundedAt: now,
        updatedAt: new Date()
    }, { merge: true });

    return readProjectPurchaseByDocId(id);
}

export async function markProjectPurchaseRefundedByPaymentIntentId(input: {
    paymentIntentId: string;
    refundId?: string | null;
    providerEventId?: string | null;
    providerEventType?: string | null;
    refundedAt?: Date | null;
}) {
    const purchase = await getProjectPurchaseByPaymentIntentId(input.paymentIntentId);
    if (!purchase) return null;

    return markProjectPurchaseRefunded({
        userId: purchase.userId,
        projectId: purchase.projectId,
        refundId: input.refundId ?? null,
        providerEventId: input.providerEventId ?? null,
        providerEventType: input.providerEventType ?? null,
        refundedAt: input.refundedAt ?? null
    });
}

export async function listProjectPurchases(input?: {
    limit?: number;
    status?: ProjectPurchaseStatus | "";
    provider?: ProjectPurchase["provider"] | "";
    userId?: string;
    tenantId?: string;
    projectId?: string;
    workspaceSnapshotId?: string;
    workspaceRevision?: number;
    query?: string;
}) {
    const status = (input?.status || "").trim().toUpperCase();
    const provider = (input?.provider || "").trim().toLowerCase();
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

    const snap = await purchasesCollection()
        .orderBy("updatedAt", "desc")
        .limit(Math.max(limit, 120))
        .get();

    return snap.docs
        .map((doc) => mapProjectPurchase(doc.id, doc.data() || {}))
        .filter((purchase) => {
            if (status && purchase.status !== status) return false;
            if (provider && purchase.provider.toLowerCase() !== provider) return false;
            if (userId && purchase.userId !== userId) return false;
            if (tenantId && (purchase.tenantId || "") !== tenantId) return false;
            if (projectId && purchase.projectId !== projectId) return false;
            if (workspaceSnapshotId && (purchase.workspaceSnapshotId || "") !== workspaceSnapshotId) return false;
            if (workspaceRevision !== null && purchase.workspaceRevision !== workspaceRevision) return false;
            if (query) {
                const haystack = [
                    purchase.id,
                    purchase.userId,
                    purchase.projectId,
                    purchase.tenantId || "",
                    purchase.provider,
                    purchase.status,
                    purchase.requestId,
                    purchase.merchantOrderId,
                    purchase.paymentIntentId || "",
                    purchase.sessionId || "",
                    purchase.invoiceId || "",
                    purchase.refundId || "",
                    purchase.customerEmail || "",
                    purchase.providerEventId || "",
                    purchase.providerEventType || "",
                    purchase.workspaceSnapshotId || "",
                    typeof purchase.workspaceRevision === "number" ? String(purchase.workspaceRevision) : ""
                ].join(" ").toLowerCase();
                if (!haystack.includes(query)) return false;
            }
            return true;
        })
        .slice(0, limit);
}
