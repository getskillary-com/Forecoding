import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/admin-api";
import { getGenerationJobById } from "@/lib/data/generation-jobs";

export const runtime = "nodejs";

export async function GET(
    _req: Request,
    context: { params: Promise<{ jobId: string }> }
) {
    const admin = await requireAdminRoute();
    if (admin.error) return admin.error;

    const params = await context.params;
    const job = await getGenerationJobById(params.jobId);
    if (!job) {
        return NextResponse.json(
            { error: "Generation job not found." },
            { status: 404 }
        );
    }

    return NextResponse.json({ job, role: admin.role });
}
