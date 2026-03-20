import { z } from "zod";
import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/admin-api";
import { recordAuditEvent } from "@/lib/data/audit-events";
import { recordBillingEvent } from "@/lib/data/billing-events";
import {
    getProjectPurchase,
    getProjectPurchaseByPaymentIntentId,
    markProjectPurchaseRefunded,
    markProjectPurchaseRefundedByPaymentIntentId
} from "@/lib/data/purchases";
import { createStripeRefund, getStripeSecretKey } from "@/lib/stripe";

export const runtime = "nodejs";

const RefundSchema = z.object({
    userId: z.string().trim().min(1).optional(),
    projectId: z.string().trim().min(1).optional(),
    paymentIntentId: z.string().trim().min(1).optional(),
    amountCents: z.number().int().positive().optional(),
    reason: z.enum(["duplicate", "fraudulent", "requested_by_customer"]).optional(),
    note: z.string().trim().max(240).optional(),
    manualOnly: z.boolean().optional()
}).superRefine((value, ctx) => {
    const byProject = Boolean(value.userId && value.projectId);
    const byPaymentIntent = Boolean(value.paymentIntentId);
    if (!byProject && !byPaymentIntent) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Provide (userId + projectId) or paymentIntentId."
        });
    }
    if (value.userId && !value.projectId) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "projectId is required when userId is provided."
        });
    }
});

export async function POST(req: Request) {
    const admin = await requireAdminRoute({ minimumCapability: "billing_manage" });
    if (admin.error) return admin.error;

    const payload = RefundSchema.parse(await req.json());
    const purchase = payload.userId && payload.projectId
        ? await getProjectPurchase(payload.userId, payload.projectId)
        : payload.paymentIntentId
        ? await getProjectPurchaseByPaymentIntentId(payload.paymentIntentId)
        : null;

    if (!purchase) {
        return NextResponse.json({ error: "Project purchase not found." }, { status: 404 });
    }
    if (purchase.status === "REFUNDED") {
        return NextResponse.json({
            ok: true,
            alreadyRefunded: true,
            purchase,
            role: admin.role
        });
    }

    let refundId: string | null = null;
    let refundProvider: "stripe" | "manual" = payload.manualOnly ? "manual" : purchase.provider;
    let stripeRefundStatus = "";

    const shouldCallStripe =
        !payload.manualOnly &&
        purchase.provider === "stripe" &&
        Boolean(purchase.paymentIntentId);
    if (shouldCallStripe && purchase.paymentIntentId) {
        const stripeSecret = getStripeSecretKey();
        if (!stripeSecret) {
            return NextResponse.json(
                { error: "Stripe refund requires STRIPE_SECRET_KEY or set manualOnly=true." },
                { status: 500 }
            );
        }
        const refund = await createStripeRefund({
            secretKey: stripeSecret,
            paymentIntentId: purchase.paymentIntentId,
            amountCents: payload.amountCents,
            reason: payload.reason,
            metadata: {
                userId: purchase.userId,
                projectId: purchase.projectId,
                tenantId: purchase.tenantId || "",
                operatorEmail: admin.user?.email || "",
                note: payload.note || ""
            }
        });
        refundId = refund.id || null;
        stripeRefundStatus = refund.status || "";
        refundProvider = "stripe";
    }

    const refundedPurchase = purchase.paymentIntentId
        ? await markProjectPurchaseRefundedByPaymentIntentId({
            paymentIntentId: purchase.paymentIntentId,
            refundId: refundId || null,
            providerEventId: refundId || null,
            providerEventType: "admin.refund.requested",
            refundedAt: new Date()
        })
        : await markProjectPurchaseRefunded({
            userId: purchase.userId,
            projectId: purchase.projectId,
            refundId: refundId || null,
            providerEventId: refundId || null,
            providerEventType: "admin.refund.requested",
            refundedAt: new Date()
        });

    const finalPurchase = refundedPurchase || purchase;
    const amountCents = payload.amountCents || finalPurchase.amount;

    const billingEvent = await recordBillingEvent({
        provider: refundProvider,
        eventType: "admin.refund.requested",
        status: "refunded",
        amountCents,
        currency: finalPurchase.currency,
        relatedProjectId: finalPurchase.projectId,
        userId: finalPurchase.userId,
        tenantId: finalPurchase.tenantId || null,
        providerEventId: refundId || null,
        paymentIntentId: finalPurchase.paymentIntentId || null,
        refundId: refundId || null,
        merchantOrderId: finalPurchase.merchantOrderId,
        requestId: finalPurchase.requestId,
        workspaceSnapshotId: finalPurchase.workspaceSnapshotId || null,
        workspaceRevision: finalPurchase.workspaceRevision ?? null,
        metadata: {
            reason: payload.reason || "",
            note: payload.note || "",
            manualOnly: payload.manualOnly ? "true" : "false",
            stripeRefundStatus
        }
    });

    await recordAuditEvent({
        eventType: "billing.refund_created",
        severity: "warning",
        actorId: admin.user?.uid ?? null,
        actorEmail: admin.user?.email ?? null,
        resourceType: "purchase",
        resourceId: finalPurchase.id,
        summary: `Refund recorded for ${finalPurchase.userId}:${finalPurchase.projectId}.`,
        metadata: {
            purchaseId: finalPurchase.id,
            userId: finalPurchase.userId,
            projectId: finalPurchase.projectId,
            tenantId: finalPurchase.tenantId || "",
            paymentIntentId: finalPurchase.paymentIntentId || "",
            refundId: refundId || "",
            provider: refundProvider,
            reason: payload.reason || "",
            note: payload.note || "",
            stripeRefundStatus
        }
    });

    return NextResponse.json({
        ok: true,
        purchase: finalPurchase,
        billingEvent,
        refund: {
            provider: refundProvider,
            refundId,
            stripeRefundStatus: stripeRefundStatus || null
        },
        role: admin.role
    });
}
