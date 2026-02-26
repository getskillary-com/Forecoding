import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
    createStripeCheckoutSession,
    getStripeCurrency,
    getStripePriceId,
    getStripeSecretKey,
    getStripeUnitAmountCents
} from "@/lib/stripe";

export const runtime = "nodejs";

type CheckoutRequestBody = {
    projectId?: string;
    projectName?: string;
    successPath?: string;
    cancelPath?: string;
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
        const projectName = sanitizeText(body.projectName, "Project Credit");

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
                unitAmountCents: getStripeUnitAmountCents(),
                currency: getStripeCurrency(),
                quantity: 1
            },
            customerEmail: user.email || undefined,
            clientReferenceId: `${user.id}:${projectId}`,
            metadata: {
                userId: user.id,
                projectId,
                projectName
            }
        });

        if (!checkout.url) {
            return NextResponse.json({ error: "Stripe checkout URL is missing." }, { status: 502 });
        }

        return NextResponse.json({
            ok: true,
            checkoutUrl: checkout.url,
            sessionId: checkout.id || null
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to create checkout session.";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
