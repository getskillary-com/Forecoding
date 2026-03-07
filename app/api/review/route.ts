import { NextResponse } from "next/server";
import {
    buildArchitectureReview,
    normalizeArchitecturePack,
    normalizeGuardrailChecklist
} from "@/lib/architecture";

export const runtime = "nodejs";

type ReviewRequestBody = {
    architecturePack?: unknown;
    guardrailChecklist?: unknown;
    materials?: unknown;
};

function normalizeMaterials(value: unknown) {
    if (typeof value === "string") return value.trim();
    if (Array.isArray(value)) {
        return value
            .map((item) => (typeof item === "string" ? item.trim() : ""))
            .filter(Boolean)
            .join("\n\n");
    }
    return "";
}

export async function POST(req: Request) {
    try {
        const body = (await req.json()) as ReviewRequestBody;
        if (!body.architecturePack || typeof body.architecturePack !== "object") {
            return NextResponse.json(
                { error: "Architecture pack is required for review." },
                { status: 400 }
            );
        }

        const materials = normalizeMaterials(body.materials);
        if (!materials) {
            return NextResponse.json(
                { error: "Implementation notes or code snippets are required for review." },
                { status: 400 }
            );
        }

        const architecturePack = normalizeArchitecturePack(body.architecturePack);
        const guardrailChecklist = normalizeGuardrailChecklist(body.guardrailChecklist);
        const result = buildArchitectureReview(architecturePack, guardrailChecklist, materials);

        return NextResponse.json({
            ok: true,
            summary: result.summary,
            verdict: result.verdict,
            findings: result.findings,
            reviewedAt: result.reviewedAt
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to review implementation.";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
