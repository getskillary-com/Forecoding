import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/admin-api";
import { searchAdminTaskRuns } from "@/lib/data/task-runs";

export const runtime = "nodejs";

export async function GET(req: Request) {
    const admin = await requireAdminRoute();
    if (admin.error) return admin.error;

    const url = new URL(req.url);
    const status = (url.searchParams.get("status") || "") as "" | "queued" | "running" | "succeeded" | "failed" | "blocked";
    const ownerUserId = url.searchParams.get("ownerUserId") || "";
    const tenantId = url.searchParams.get("tenantId") || "";
    const query = url.searchParams.get("query") || "";
    const limit = Number.parseInt(url.searchParams.get("limit") || "40", 10);

    const taskRuns = await searchAdminTaskRuns({
        status,
        ownerUserId,
        tenantId,
        query,
        limit: Number.isFinite(limit) ? limit : 40
    });

    return NextResponse.json({
        taskRuns,
        role: admin.role
    });
}
