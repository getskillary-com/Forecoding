import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import type { Project } from "@/types";
import { authOptions } from "@/lib/auth";
import {
    createStripeCheckoutSession,
    getStripeMaxUnitAmountCents,
    getStripeCurrency,
    getStripePriceId,
    getStripeSecretKey,
    getStripeUnitAmountCents,
    isStripeDynamicPricingEnabled
} from "@/lib/stripe";
import { formatCurrencyCents, quoteProjectCreditPrice } from "@/lib/pricing";
import { prisma, withPrismaRetry } from "@/lib/prisma";

export const runtime = "nodejs";

type CheckoutRequestBody = {
    projectId?: string;
    projectName?: string;
    successPath?: string;
    cancelPath?: string;
    projectSnapshot?: unknown;
};

function resolveBaseUrl(req: Request) {
    const origin = req.headers.get("origin") || "";
    if (origin) return origin;

    const nextAuthUrl = (process.env.NEXTAUTH_URL || "").trim();
    if (nextAuthUrl) return nextAuthUrl;

    return "";
}

function sanitizeText(value: string | undefined, fallback: string) {
    const cleaned = (value || "").trim().slice(0, 120);
    return cleaned || fallback;
}

function sanitizePath(value: string | undefined) {
    const cleaned = (value || "").trim();
    if (!cleaned) return null;
    if (!cleaned.startsWith("/")) return null;
    if (cleaned.startsWith("//")) return null;
    return cleaned;
}

function parseProjects(raw: unknown): Project[] {
    if (!Array.isArray(raw)) return [];

    return raw.filter((item): item is Project => {
        if (!item || typeof item !== "object") return false;
        const id = (item as { id?: unknown }).id;
        return typeof id === "string" && id.length > 0;
    });
}

function parseProjectSnapshot(raw: unknown, projectId: string): Project | null {
    if (!raw || typeof raw !== "object") return null;
    const candidate = raw as Project;
    if (typeof candidate.id !== "string" || candidate.id !== projectId) return null;
    if (!Array.isArray(candidate.versions)) return null;
    return candidate;
}

async function loadProjectForUser(userId: string, projectId: string) {
    const workspace = await withPrismaRetry(() =>
        prisma.workspaceState.findUnique({
            where: { userId },
            select: { data: true }
        })
    );

    const projects = parseProjects(workspace?.data);
    return projects.find((project) => project.id === projectId) || null;
}

export async function POST(req: Request) {
    try {
        const session = await getServerSession(authOptions);
        const user = session?.user as { id?: string; email?: string | null } | undefined;
        if (!user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const secretKey = getStripeSecretKey();
        if (!secretKey) {
            return NextResponse.json(
                { error: "Stripe is not configured. Missing STRIPE_SECRET_KEY." },
                { status: 500 }
            );
        }

        const body = (await req.json()) as CheckoutRequestBody;
        const projectId = sanitizeText(body.projectId, "project-credit");
        const projectFromSnapshot = parseProjectSnapshot(body.projectSnapshot, projectId);
        const projectFromWorkspace = await loadProjectForUser(user.id, projectId);
        const project = projectFromSnapshot || projectFromWorkspace;
        const projectName = sanitizeText(project?.name || body.projectName, "Project Credit");
        const currency = getStripeCurrency();
        const quote = quoteProjectCreditPrice(project, {
            baseAmountCents: getStripeUnitAmountCents(),
            maxAmountCents: getStripeMaxUnitAmountCents(),
            currency,
            dynamicEnabled: isStripeDynamicPricingEnabled()
        });

        const baseUrl = resolveBaseUrl(req);
        if (!baseUrl) {
            return NextResponse.json(
                { error: "Cannot resolve app base URL for checkout redirect." },
                { status: 500 }
            );
        }

        const fallbackSuccessPath = `/dashboard?payment=success&projectId=${encodeURIComponent(projectId)}`;
        const fallbackCancelPath = `/dashboard?payment=cancelled&projectId=${encodeURIComponent(projectId)}`;
        const successPath = sanitizePath(body.successPath) || fallbackSuccessPath;
        const cancelPath = sanitizePath(body.cancelPath) || fallbackCancelPath;
        const successUrl = `${baseUrl}${successPath}`;
        const cancelUrl = `${baseUrl}${cancelPath}`;
        const priceId = getStripePriceId();

        const checkout = await createStripeCheckoutSession({
            secretKey,
            successUrl,
            cancelUrl,
            lineItem: {
                priceId: priceId || undefined,
                productName: `Forecoding - ${projectName}`,
                unitAmountCents: quote.unitAmountCents,
                currency: quote.currency,
                quantity: 1
            },
            customerEmail: user.email || undefined,
            clientReferenceId: `${user.id}:${projectId}`,
            metadata: {
                userId: user.id,
                projectId,
                projectName,
                complexityScore: String(quote.complexityScore),
                complexityTier: quote.complexityTier
            }
        });

        if (!checkout.url) {
            return NextResponse.json({ error: "Stripe checkout URL is missing." }, { status: 502 });
        }

        return NextResponse.json({
            ok: true,
            checkoutUrl: checkout.url,
            sessionId: checkout.id || null,
            pricing: {
                unitAmountCents: quote.unitAmountCents,
                currency: quote.currency,
                displayAmount: formatCurrencyCents(quote.unitAmountCents, quote.currency),
                complexityScore: quote.complexityScore,
                complexityTier: quote.complexityTier
            }
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to create checkout session.";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
