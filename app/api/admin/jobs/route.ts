import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/admin-api";
import { searchGenerationJobs } from "@/lib/data/generation-jobs";

export const runtime = "nodejs";

export async function GET(req: Request) {
    const admin = await requireAdminRoute();
    if (admin.error) return admin.error;

    const url = new URL(req.url);
    const status = (url.searchParams.get("status") || "") as "" | "queued" | "running" | "succeeded" | "failed";
    const outputMode = url.searchParams.get("outputMode") || "";
    const templateKind = url.searchParams.get("templateKind") || "";
    const query = url.searchParams.get("query") || "";
    const limit = Number.parseInt(url.searchParams.get("limit") || "40", 10);

    const jobs = await searchGenerationJobs({
        status,
        outputMode,
        templateKind,
        query,
        limit: Number.isFinite(limit) ? limit : 40
    });
    return NextResponse.json({ jobs });
}
