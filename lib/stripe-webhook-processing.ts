import { sendProjectOrderEmail } from "@/lib/mailer";
import { recordBillingEvent } from "@/lib/data/billing-events";
import {
    getProjectPurchaseByPaymentIntentId,
    markProjectPurchaseRefundedByPaymentIntentId,
    upsertProjectPurchase
} from "@/lib/data/purchases";
import { markProjectPaidInWorkspace } from "@/lib/data/workspaces";
import { getUserProfileByUid } from "@/lib/data/users";
import type { StripeEvent } from "@/lib/stripe-webhook";

type ReplayMode = "live" | "replay";

export type ProcessedStripeWebhookResult = {
    mode: ReplayMode;
    eventId: string;
    type: string;
    status: "processed" | "ignored";
    reason?: string;
    userId?: string;
    projectId?: string;
    sessionId?: string;
    paymentStatus?: string;
    emailSent?: boolean;
};

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

function parseWorkspaceRevision(value: unknown): number | null {
    if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
        return value;
    }
    if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) return null;
        const parsed = Number.parseInt(trimmed, 10);
        if (Number.isInteger(parsed) && parsed >= 0) {
            return parsed;
        }
    }
    return null;
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
        projectId: metadataProjectId || clientRefProjectId,
        tenantId: getString(input.metadata.tenantId).trim() || "",
        workspaceSnapshotId: getString(input.metadata.workspaceSnapshotId).trim() || "",
        workspaceRevision:
            parseWorkspaceRevision(input.metadata.workspaceRevision)
            ?? parseWorkspaceRevision(input.metadata.expectedRevision)
    };
}

async function resolvePurchaseContextFromPaymentIntent(input: {
    metadata: Record<string, unknown>;
    clientReferenceId: string;
    paymentIntentId: string;
}) {
    const context = resolvePurchaseContext({
        metadata: input.metadata,
        clientReferenceId: input.clientReferenceId
    });

    let linkedPurchase = null as Awaited<ReturnType<typeof getProjectPurchaseByPaymentIntentId>> | null;
    if (input.paymentIntentId) {
        linkedPurchase = await getProjectPurchaseByPaymentIntentId(input.paymentIntentId);
    }

    return {
        userId: context.userId || linkedPurchase?.userId || "",
        projectId: context.projectId || linkedPurchase?.projectId || "",
        tenantId: context.tenantId || linkedPurchase?.tenantId || "",
        workspaceSnapshotId: context.workspaceSnapshotId || linkedPurchase?.workspaceSnapshotId || "",
        workspaceRevision:
            context.workspaceRevision !== null
                ? context.workspaceRevision
                : linkedPurchase?.workspaceRevision ?? null,
        linkedPurchase
    };
}

export async function processStripeWebhookEvent(
    event: StripeEvent,
    options?: { mode?: ReplayMode }
): Promise<ProcessedStripeWebhookResult> {
    const mode = options?.mode ?? "live";
    const type = getString(event.type);
    const object = event.data?.object || {};
    const eventId = getString(event.id);

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

        const {
            userId,
            projectId,
            tenantId,
            workspaceSnapshotId,
            workspaceRevision
        } = resolvePurchaseContext({
            metadata,
            clientReferenceId
        });

        if (!userId || !projectId) {
            console.warn("[stripe] Missing userId/projectId in completed checkout session.", {
                eventId,
                sessionId,
                clientReferenceId,
                metadata,
                mode
            });
            return {
                mode,
                eventId,
                type,
                status: "ignored",
                reason: "missing_purchase_context",
                sessionId,
                paymentStatus
            };
        }

        const paid = paymentStatus === "paid";

        const purchaseWrite = await upsertProjectPurchase({
            userId,
            projectId,
            tenantId: tenantId || null,
            provider: "stripe",
            status: paid ? "SUCCEEDED" : "PENDING",
            amount: amountTotal,
            currency,
            requestId: sessionId || `${userId}:${projectId}`,
            merchantOrderId: sessionId || `${userId}:${projectId}`,
            paymentIntentId: paymentIntentId || null,
            sessionId: sessionId || null,
            customerEmail: customerEmail || null,
            providerEventId: eventId || null,
            providerEventType: type,
            workspaceSnapshotId: workspaceSnapshotId || null,
            workspaceRevision: workspaceRevision ?? null,
            paidAt: paid ? new Date() : null
        });

        await recordBillingEvent({
            provider: "stripe",
            eventType: type,
            status: paid ? "succeeded" : "pending",
            amountCents: amountTotal,
            currency,
            relatedProjectId: projectId,
            userId,
            tenantId: tenantId || null,
            providerEventId: eventId || null,
            paymentIntentId: paymentIntentId || null,
            merchantOrderId: sessionId || `${userId}:${projectId}`,
            requestId: purchaseWrite.purchase?.requestId || null,
            workspaceSnapshotId: workspaceSnapshotId || null,
            workspaceRevision: workspaceRevision ?? null,
            metadata: {
                mode,
                paymentStatus: paymentStatus || "unknown",
                sessionId: sessionId || "",
                emailSent: "false"
            }
        });

        let emailSent = false;
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
                    emailSent = true;
                } catch (error) {
                    console.error("[stripe] Failed to send order email:", error);
                }
            } else if (emailToSend) {
                console.log("[stripe] Order email skipped because purchase was already marked succeeded.", {
                    eventId,
                    sessionId,
                    userId,
                    projectId,
                    mode
                });
            } else {
                console.warn("[stripe] Paid session has no resolvable email. Skipping order email.", {
                    eventId,
                    sessionId,
                    userId,
                    projectId,
                    mode
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
            email: customerEmail || null,
            mode
        });

        return {
            mode,
            eventId,
            type,
            status: "processed",
            sessionId,
            paymentStatus,
            userId,
            projectId,
            emailSent
        };
    }

    if (type === "payment_intent.payment_failed") {
        const paymentIntent = getObject(object);
        const paymentIntentId = getString(paymentIntent.id);
        const amount = getNumber(paymentIntent.amount);
        const currency = getString(paymentIntent.currency).toLowerCase() || "usd";
        const metadata = getObject(paymentIntent.metadata);

        const {
            userId,
            projectId,
            tenantId,
            workspaceSnapshotId,
            workspaceRevision,
            linkedPurchase
        } = await resolvePurchaseContextFromPaymentIntent({
            metadata,
            clientReferenceId: "",
            paymentIntentId
        });

        if (userId && projectId) {
            await upsertProjectPurchase({
                userId,
                projectId,
                tenantId: tenantId || null,
                provider: "stripe",
                status: "FAILED",
                amount: amount || linkedPurchase?.amount || 0,
                currency: currency || linkedPurchase?.currency || "usd",
                requestId: linkedPurchase?.requestId || paymentIntentId || `${userId}:${projectId}`,
                merchantOrderId: linkedPurchase?.merchantOrderId || paymentIntentId || `${userId}:${projectId}`,
                paymentIntentId: paymentIntentId || linkedPurchase?.paymentIntentId || null,
                sessionId: linkedPurchase?.sessionId || null,
                invoiceId: linkedPurchase?.invoiceId || null,
                providerEventId: eventId || null,
                providerEventType: type,
                workspaceSnapshotId: workspaceSnapshotId || null,
                workspaceRevision: workspaceRevision ?? null
            });
        }

        await recordBillingEvent({
            provider: "stripe",
            eventType: type,
            status: "failed",
            amountCents: amount || linkedPurchase?.amount || 0,
            currency: currency || linkedPurchase?.currency || "usd",
            relatedProjectId: projectId || linkedPurchase?.projectId || null,
            userId: userId || linkedPurchase?.userId || null,
            tenantId: tenantId || linkedPurchase?.tenantId || null,
            providerEventId: eventId || null,
            paymentIntentId: paymentIntentId || linkedPurchase?.paymentIntentId || null,
            merchantOrderId: linkedPurchase?.merchantOrderId || null,
            requestId: linkedPurchase?.requestId || null,
            workspaceSnapshotId: workspaceSnapshotId || linkedPurchase?.workspaceSnapshotId || null,
            workspaceRevision:
                workspaceRevision !== null
                    ? workspaceRevision
                    : linkedPurchase?.workspaceRevision ?? null,
            metadata: {
                mode
            }
        });

        return {
            mode,
            eventId,
            type,
            status: "processed",
            userId: userId || linkedPurchase?.userId || undefined,
            projectId: projectId || linkedPurchase?.projectId || undefined
        };
    }

    if (type === "charge.refunded") {
        const charge = getObject(object);
        const paymentIntentId = getString(charge.payment_intent);
        const amountRefunded = getNumber(charge.amount_refunded) || getNumber(charge.amount);
        const currency = getString(charge.currency).toLowerCase() || "usd";
        const refundId = getString(charge.refunded ? charge.id : "");

        const refundedPurchase = paymentIntentId
            ? await markProjectPurchaseRefundedByPaymentIntentId({
                paymentIntentId,
                refundId: refundId || null,
                providerEventId: eventId || null,
                providerEventType: type,
                refundedAt: new Date()
            })
            : null;

        await recordBillingEvent({
            provider: "stripe",
            eventType: type,
            status: "refunded",
            amountCents: amountRefunded || refundedPurchase?.amount || 0,
            currency: currency || refundedPurchase?.currency || "usd",
            relatedProjectId: refundedPurchase?.projectId || null,
            userId: refundedPurchase?.userId || null,
            tenantId: refundedPurchase?.tenantId || null,
            providerEventId: eventId || null,
            paymentIntentId: paymentIntentId || refundedPurchase?.paymentIntentId || null,
            refundId: refundId || refundedPurchase?.refundId || null,
            merchantOrderId: refundedPurchase?.merchantOrderId || null,
            requestId: refundedPurchase?.requestId || null,
            workspaceSnapshotId: refundedPurchase?.workspaceSnapshotId || null,
            workspaceRevision: refundedPurchase?.workspaceRevision ?? null,
            metadata: {
                mode
            }
        });

        return {
            mode,
            eventId,
            type,
            status: "processed",
            userId: refundedPurchase?.userId || undefined,
            projectId: refundedPurchase?.projectId || undefined,
            paymentStatus: "refunded"
        };
    }

    if (type === "invoice.paid" || type === "invoice.payment_failed") {
        const invoice = getObject(object);
        const invoiceId = getString(invoice.id);
        const paymentIntentId = getString(invoice.payment_intent);
        const amount = getNumber(invoice.amount_paid) || getNumber(invoice.amount_due);
        const currency = getString(invoice.currency).toLowerCase() || "usd";
        const metadata = getObject(invoice.metadata);

        const {
            userId,
            projectId,
            tenantId,
            workspaceSnapshotId,
            workspaceRevision,
            linkedPurchase
        } = await resolvePurchaseContextFromPaymentIntent({
            metadata,
            clientReferenceId: "",
            paymentIntentId
        });

        const status = type === "invoice.paid" ? "SUCCEEDED" : "FAILED";
        if (userId && projectId) {
            await upsertProjectPurchase({
                userId,
                projectId,
                tenantId: tenantId || null,
                provider: "stripe",
                status,
                amount: amount || linkedPurchase?.amount || 0,
                currency: currency || linkedPurchase?.currency || "usd",
                requestId: linkedPurchase?.requestId || invoiceId || `${userId}:${projectId}`,
                merchantOrderId: linkedPurchase?.merchantOrderId || invoiceId || `${userId}:${projectId}`,
                paymentIntentId: paymentIntentId || linkedPurchase?.paymentIntentId || null,
                sessionId: linkedPurchase?.sessionId || null,
                invoiceId: invoiceId || null,
                customerEmail: linkedPurchase?.customerEmail || null,
                providerEventId: eventId || null,
                providerEventType: type,
                workspaceSnapshotId: workspaceSnapshotId || null,
                workspaceRevision: workspaceRevision ?? null,
                paidAt: type === "invoice.paid" ? new Date() : null
            });

            if (type === "invoice.paid") {
                await markProjectPaidInWorkspace(userId, projectId);
            }
        }

        await recordBillingEvent({
            provider: "stripe",
            eventType: type,
            status: type === "invoice.paid" ? "succeeded" : "failed",
            amountCents: amount || linkedPurchase?.amount || 0,
            currency: currency || linkedPurchase?.currency || "usd",
            relatedProjectId: projectId || linkedPurchase?.projectId || null,
            userId: userId || linkedPurchase?.userId || null,
            tenantId: tenantId || linkedPurchase?.tenantId || null,
            providerEventId: eventId || null,
            paymentIntentId: paymentIntentId || linkedPurchase?.paymentIntentId || null,
            invoiceId: invoiceId || null,
            merchantOrderId: linkedPurchase?.merchantOrderId || null,
            requestId: linkedPurchase?.requestId || null,
            workspaceSnapshotId: workspaceSnapshotId || linkedPurchase?.workspaceSnapshotId || null,
            workspaceRevision:
                workspaceRevision !== null
                    ? workspaceRevision
                    : linkedPurchase?.workspaceRevision ?? null,
            metadata: {
                mode
            }
        });

        return {
            mode,
            eventId,
            type,
            status: "processed",
            userId: userId || linkedPurchase?.userId || undefined,
            projectId: projectId || linkedPurchase?.projectId || undefined
        };
    }

    if (type) {
        console.log("[stripe] webhook received", { eventId, type, mode });
    }

    return {
        mode,
        eventId,
        type: type || "unknown",
        status: "processed"
    };
}
