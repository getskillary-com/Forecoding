import { NextResponse } from "next/server";
import { getStripeWebhookSecret } from "@/lib/stripe";
import { StripeEvent, verifyStripeWebhookSignature } from "@/lib/stripe-webhook";
import type { Project } from "@/types";
import type { Prisma } from "@prisma/client";
import { prisma, withPrismaRetry } from "@/lib/prisma";
import { sendProjectOrderEmail } from "@/lib/mailer";

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

function parseWorkspaceProjects(raw: unknown): Project[] {
    if (!Array.isArray(raw)) return [];
    return raw as Project[];
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

async function markProjectPaidInWorkspace(userId: string, projectId: string) {
    const workspace = await withPrismaRetry(() =>
        prisma.workspaceState.findUnique({
            where: { userId },
            select: { data: true }
        })
    );

    if (!workspace) return false;

    const projects = parseWorkspaceProjects(workspace.data);
    let touched = false;

    const updatedProjects = projects.map((project) => {
        if (project.id !== projectId) return project;
        touched = true;
        return {
            ...project,
            updatedAt: Date.now(),
            versions: project.versions.map((version) => ({
                ...version,
                data: {
                    ...version.data,
                    paymentStatus: "paid"
                }
            }))
        };
    });

    if (!touched) return false;

    await withPrismaRetry(() =>
        prisma.workspaceState.update({
            where: { userId },
            data: {
                data: updatedProjects as unknown as Prisma.InputJsonValue
            }
        })
    );

    return true;
}

async function recordStripeWebhookEvent(eventId: string, eventName: string, payload: string) {
    if (!eventId) return true;

    try {
        const inserted = await withPrismaRetry(() =>
            prisma.$executeRaw`
                INSERT INTO "WebhookEventLog" ("id", "provider", "eventId", "eventName", "payload")
                VALUES (${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`}, ${"stripe"}, ${eventId}, ${eventName}, (${payload}::jsonb))
                ON CONFLICT ("provider", "eventId") DO NOTHING
            `
        );

        return inserted > 0;
    } catch (error) {
        console.warn("[stripe] Failed to persist webhook event log. Continuing without dedupe.", error);
        return true;
    }
}

async function upsertProjectPurchase(input: {
    userId: string;
    projectId: string;
    sessionId: string;
    paymentIntentId: string;
    amountCents: number;
    currency: string;
    paid: boolean;
}) {
    const now = new Date();
    const status = input.paid ? "SUCCEEDED" : "PENDING";
    const paidAt = input.paid ? now : null;
    let alreadySucceeded = false;

    try {
        const existing = await withPrismaRetry(() =>
            prisma.$queryRaw<Array<{ status: string }>>`
                SELECT "status"
                FROM "ProjectPurchase"
                WHERE "userId" = ${input.userId}
                  AND "projectId" = ${input.projectId}
                LIMIT 1
            `
        );
        alreadySucceeded = existing[0]?.status === "SUCCEEDED";

        await withPrismaRetry(() =>
            prisma.$executeRaw`
                INSERT INTO "ProjectPurchase" (
                    "id",
                    "userId",
                    "projectId",
                    "provider",
                    "status",
                    "amount",
                    "currency",
                    "requestId",
                    "merchantOrderId",
                    "paymentIntentId",
                    "paidAt",
                    "createdAt",
                    "updatedAt"
                )
                VALUES (
                    ${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`},
                    ${input.userId},
                    ${input.projectId},
                    ${"stripe"},
                    ${status},
                    ${Math.max(0, Math.round(input.amountCents))},
                    ${input.currency || "usd"},
                    ${input.sessionId || `${input.userId}:${input.projectId}`},
                    ${input.sessionId || `${input.userId}:${input.projectId}`},
                    ${input.paymentIntentId || null},
                    ${paidAt},
                    ${now},
                    ${now}
                )
                ON CONFLICT ("userId", "projectId")
                DO UPDATE SET
                    "provider" = EXCLUDED."provider",
                    "status" = EXCLUDED."status",
                    "amount" = EXCLUDED."amount",
                    "currency" = EXCLUDED."currency",
                    "requestId" = EXCLUDED."requestId",
                    "merchantOrderId" = EXCLUDED."merchantOrderId",
                    "paymentIntentId" = COALESCE(EXCLUDED."paymentIntentId", "ProjectPurchase"."paymentIntentId"),
                    "paidAt" = EXCLUDED."paidAt",
                    "updatedAt" = EXCLUDED."updatedAt"
            `
        );

        return {
            alreadySucceeded
        };
    } catch (error) {
        console.warn("[stripe] Failed to upsert ProjectPurchase. Continuing.", error);
        return {
            alreadySucceeded: false
        };
    }
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

    const shouldProcess = await recordStripeWebhookEvent(eventId, type || "unknown", payloadText);
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
            sessionId,
            paymentIntentId,
            amountCents: amountTotal,
            currency,
            paid
        });

        if (paid) {
            await markProjectPaidInWorkspace(userId, projectId);

            let emailToSend = customerEmail;
            if (!emailToSend) {
                try {
                    const user = await withPrismaRetry(() =>
                        prisma.user.findUnique({
                            where: { id: userId },
                            select: { email: true }
                        })
                    );
                    emailToSend = getString(user?.email);
                } catch {
                    emailToSend = "";
                }
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
