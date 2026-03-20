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
    workspaceSnapshotId?: unknown;
    expectedRevision?: unknown;
};

function sanitizeText(value: string | undefined) {
    return (value || "").trim().slice(0, 120);
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
                    error: "Pricing quote is unavailable because this tenant is suspended.",
                    code: "TENANT_SUSPENDED"
                },
                { status: 423 }
            );
        }

        if (isAdmin) {
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
                    uiDesignScore: 0,
                    pricingBreakdown: {
                        conversationScore: 0,
                        detailScore: 0,
                        requirementScore: 0,
                        architectureScore: 0,
                        maturityScore: 0,
                        keywordScore: 0,
                        uiDesignScore: 0,
                        totalScore: 0
                    },
                    factors: ["Admin bypass enabled."]
                }
            });
        }

        const body = (await req.json()) as QuoteRequestBody;
        const projectId = sanitizeText(body.projectId);
        if (!projectId) {
            return NextResponse.json({ error: "Missing projectId." }, { status: 400 });
        }
        const workspaceSnapshotId = sanitizeText(
            typeof body.workspaceSnapshotId === "string" ? body.workspaceSnapshotId : ""
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
                { error: "Workspace not found for pricing quote." },
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

        const projectFromSnapshot = parseProjectSnapshot(body.projectSnapshot, projectId);
        const projectFromWorkspace = loadProjectFromWorkspace(workspace.projects, projectId);
        const project = projectFromWorkspace || projectFromSnapshot;
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
                uiDesignScore: quote.uiDesignScore,
                pricingBreakdown: quote.pricingBreakdown,
                factors: quote.factors
            },
            workspaceSnapshotId,
            revision: workspace.revision
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to calculate quote.";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
