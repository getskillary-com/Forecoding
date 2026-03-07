import { NextResponse } from "next/server";
import type { Project } from "@/types";
import { isAdminUser } from "@/lib/admin";
import { getServerUser } from "@/lib/server-auth";
import {
    createStripeCheckoutSession,
    getStripeMaxUnitAmountCents,
    getStripeCurrency,
    getStripePriceId,
    getStripeSecretKey,
    getStripeUnitAmountCents,
    isStripeDynamicPricingEnabled,
    isStripePaymentsPaused
} from "@/lib/stripe";
import { formatCurrencyCents, inferProjectDesignStage, quoteProjectCreditPrice } from "@/lib/pricing";
import { getWorkspaceByUserId } from "@/lib/data/workspaces";

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

    const appBaseUrl = (process.env.APP_BASE_URL || "").trim();
    if (appBaseUrl) return appBaseUrl;

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
    const workspace = await getWorkspaceByUserId(userId);
    const projects = parseProjects(workspace?.projects);
    return projects.find((project) => project.id === projectId) || null;
}

export async function POST(req: Request) {
    try {
        const user = await getServerUser();
        if (!user?.uid) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        if (isStripePaymentsPaused()) {
            return NextResponse.json(
                {
                    error: "Stripe payments are temporarily paused for all accounts. Please contact support@forecoding.com.",
                    paymentsPaused: true
                },
                { status: 503 }
            );
        }
        if (isAdminUser({ email: user.email })) {
            return NextResponse.json(
                {
                    error: "Admin users bypass Stripe checkout. Generate directly in wizard.",
                    adminBypass: true
                },
                { status: 403 }
            );
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
        const projectFromWorkspace = await loadProjectForUser(user.uid, projectId);
        const project = projectFromWorkspace || projectFromSnapshot;
        if (!project) {
            return NextResponse.json(
                { error: "Project context not found for checkout." },
                { status: 404 }
            );
        }
        const designStage = inferProjectDesignStage(project);
        if (designStage !== "ready_to_generate") {
            return NextResponse.json(
                {
                    error: "Architecture pack is not ready. Resolve blockers and complete review before checkout.",
                    designStage
                },
                { status: 409 }
            );
        }
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
            clientReferenceId: `${user.uid}:${projectId}`,
            metadata: {
                userId: user.uid,
                projectId,
                projectName,
                complexityScore: String(quote.complexityScore),
                complexityTier: quote.complexityTier,
                uiDesignScore: String(quote.uiDesignScore)
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
                complexityTier: quote.complexityTier,
                uiDesignScore: quote.uiDesignScore,
                pricingBreakdown: quote.pricingBreakdown
            }
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to create checkout session.";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
