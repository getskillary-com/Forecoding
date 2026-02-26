import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import type { Project } from "@/types";
import { authOptions } from "@/lib/auth";
import { prisma, withPrismaRetry } from "@/lib/prisma";
import {
    getStripeCurrency,
    getStripeMaxUnitAmountCents,
    getStripeUnitAmountCents,
    isStripeDynamicPricingEnabled
} from "@/lib/stripe";
import { formatCurrencyCents, quoteProjectCreditPrice } from "@/lib/pricing";

export const runtime = "nodejs";

type QuoteRequestBody = {
    projectId?: string;
};

function sanitizeText(value: string | undefined) {
    return (value || "").trim().slice(0, 120);
}

function parseProjects(raw: unknown): Project[] {
    if (!Array.isArray(raw)) return [];

    return raw.filter((item): item is Project => {
        if (!item || typeof item !== "object") return false;
        const id = (item as { id?: unknown }).id;
        return typeof id === "string" && id.length > 0;
    });
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
        const user = session?.user as { id?: string } | undefined;
        if (!user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = (await req.json()) as QuoteRequestBody;
        const projectId = sanitizeText(body.projectId);
        if (!projectId) {
            return NextResponse.json({ error: "Missing projectId." }, { status: 400 });
        }

        const project = await loadProjectForUser(user.id, projectId);
        const currency = getStripeCurrency();
        const quote = quoteProjectCreditPrice(project, {
            baseAmountCents: getStripeUnitAmountCents(),
            maxAmountCents: getStripeMaxUnitAmountCents(),
            currency,
            dynamicEnabled: isStripeDynamicPricingEnabled()
        });

        return NextResponse.json({
            ok: true,
            quote: {
                unitAmountCents: quote.unitAmountCents,
                currency: quote.currency,
                displayAmount: formatCurrencyCents(quote.unitAmountCents, quote.currency),
                complexityScore: quote.complexityScore,
                complexityTier: quote.complexityTier,
                factors: quote.factors
            }
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to calculate quote.";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
