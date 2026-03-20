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
import { formatCurrencyCents, quoteProjectCreditPrice } from "@/lib/pricing";
import { getWorkspaceByUserId } from "@/lib/data/workspaces";
import {
    buildScaffoldEligibilityErrorMessage,
    computeProjectScaffoldEligibility
} from "@/lib/scaffold-eligibility";

export const runtime = "nodejs";

type CheckoutRequestBody = {
    projectId?: string;
    projectName?: string;
    successPath?: string;
    cancelPath?: string;
    projectSnapshot?: unknown;
    workspaceSnapshotId?: unknown;
    expectedRevision?: unknown;
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

function parseExpectedRevision(value: unknown): number | null {
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

function loadProjectFromWorkspace(rawProjects: unknown, projectId: string) {
    const projects = parseProjects(rawProjects);
    return projects.find((project) => project.id === projectId) || null;
}

export async function POST(req: Request) {
    try {
        const user = await getServerUser();
        if (!user?.uid) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const isAdmin = isAdminUser({ email: user.email });
        if (user.tenantStatus === "suspended" && !isAdmin) {
            return NextResponse.json(
                {
                    error: "Checkout is unavailable because this tenant is suspended.",
                    code: "TENANT_SUSPENDED"
                },
                { status: 423 }
            );
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
        if (isAdmin) {
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
        const workspaceSnapshotId = sanitizeText(
            typeof body.workspaceSnapshotId === "string" ? body.workspaceSnapshotId : "",
            ""
        );
        if (!workspaceSnapshotId) {
            return NextResponse.json(
                {
                    error: "Missing workspaceSnapshotId.",
                    code: "WORKSPACE_SNAPSHOT_REQUIRED"
                },
                { status: 400 }
            );
        }
        const expectedRevision = parseExpectedRevision(body.expectedRevision);
        if (expectedRevision === null) {
            return NextResponse.json(
                {
                    error: "Missing expectedRevision.",
                    code: "WORKSPACE_REVISION_REQUIRED"
                },
                { status: 400 }
            );
        }

        const workspace = await getWorkspaceByUserId(user.uid);
        if (!workspace) {
            return NextResponse.json(
                { error: "Workspace context not found for checkout." },
                { status: 404 }
            );
        }
        if (workspace.revision !== expectedRevision) {
            return NextResponse.json(
                {
                    error: "Workspace revision conflict.",
                    code: "WORKSPACE_REVISION_CONFLICT",
                    revision: workspace.revision
                },
                { status: 409 }
            );
        }

        const selectedSnapshot = workspace.envelope.snapshots.find(
            (snapshot) => snapshot.id === workspaceSnapshotId
        ) || null;
        if (!selectedSnapshot) {
            return NextResponse.json(
                {
                    error: "Workspace snapshot mismatch.",
                    code: "WORKSPACE_SNAPSHOT_MISMATCH",
                    workspaceSnapshotId
                },
                { status: 409 }
            );
        }
        if (
            Array.isArray(selectedSnapshot.projectIds)
            && selectedSnapshot.projectIds.length > 0
            && !selectedSnapshot.projectIds.includes(projectId)
        ) {
            return NextResponse.json(
                {
                    error: "Workspace snapshot does not include this project.",
                    code: "WORKSPACE_SNAPSHOT_MISMATCH",
                    workspaceSnapshotId
                },
                { status: 409 }
            );
        }

        const project = loadProjectFromWorkspace(workspace.projects, projectId);
        if (!project) {
            return NextResponse.json(
                { error: "Project context not found for checkout." },
                { status: 404 }
            );
        }
        const eligibility = computeProjectScaffoldEligibility(project, "virtual_spec");
        if (!eligibility?.canCheckout) {
            return NextResponse.json(
                {
                    error: buildScaffoldEligibilityErrorMessage(
                        eligibility || { code: "ARCHITECTURE_NOT_READY", targetOutputMode: "virtual_spec" }
                    ),
                    code: eligibility?.code || "ARCHITECTURE_NOT_READY",
                    blockingReasons: eligibility?.blockingReasons || ["Architecture pack is not ready for scaffold generation."],
                    designStage: eligibility?.designStage || "functional_architecture"
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
                tenantId: user.tenantId || "",
                projectId,
                projectName,
                complexityScore: String(quote.complexityScore),
                complexityTier: quote.complexityTier,
                uiDesignScore: String(quote.uiDesignScore),
                workspaceSnapshotId,
                workspaceRevision: String(workspace.revision),
                expectedRevision: String(expectedRevision)
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
            },
            workspaceSnapshotId,
            revision: workspace.revision
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to create checkout session.";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
