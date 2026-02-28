import { NextResponse } from "next/server";
import type { Project } from "@/types";
import { isAdminUser } from "@/lib/admin";
import { getServerUser } from "@/lib/server-auth";
import {
    getStripeCurrency,
    getStripeMaxUnitAmountCents,
    getStripeUnitAmountCents,
    isStripeDynamicPricingEnabled
} from "@/lib/stripe";
import { formatCurrencyCents, quoteProjectCreditPrice } from "@/lib/pricing";
import { getWorkspaceByUserId } from "@/lib/data/workspaces";

export const runtime = "nodejs";

type QuoteRequestBody = {
    projectId?: string;
    projectSnapshot?: unknown;
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
        if (isAdminUser({ email: user.email })) {
            const currency = getStripeCurrency();
            return NextResponse.json({
                ok: true,
                adminBypass: true,
                quote: {
                    unitAmountCents: 0,
                    currency,
                    displayAmount: formatCurrencyCents(0, currency),
                    complexityScore: 0,
                    complexityTier: "simple",
                    factors: ["Admin bypass enabled."]
                }
            });
        }

        const body = (await req.json()) as QuoteRequestBody;
        const projectId = sanitizeText(body.projectId);
        if (!projectId) {
            return NextResponse.json({ error: "Missing projectId." }, { status: 400 });
        }

        const projectFromSnapshot = parseProjectSnapshot(body.projectSnapshot, projectId);
        const projectFromWorkspace = await loadProjectForUser(user.uid, projectId);
        const project = projectFromSnapshot || projectFromWorkspace;
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
