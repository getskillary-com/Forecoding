import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/admin-api";
import { listProjectPurchases } from "@/lib/data/purchases";

export const runtime = "nodejs";

export async function GET(req: Request) {
    const admin = await requireAdminRoute();
    if (admin.error) return admin.error;

    const url = new URL(req.url);
    const provider = (url.searchParams.get("provider") || "") as "" | "stripe" | "manual";
    const status = (url.searchParams.get("status") || "") as "" | "PENDING" | "SUCCEEDED" | "CANCELLED" | "FAILED" | "REFUNDED";
    const userId = url.searchParams.get("userId") || "";
    const tenantId = url.searchParams.get("tenantId") || "";
    const projectId = url.searchParams.get("projectId") || "";
    const workspaceSnapshotId = url.searchParams.get("workspaceSnapshotId") || "";
    const workspaceRevisionRaw = url.searchParams.get("workspaceRevision") || "";
    const workspaceRevisionParsed = Number.parseInt(workspaceRevisionRaw, 10);
    const workspaceRevision =
        Number.isInteger(workspaceRevisionParsed) && workspaceRevisionParsed >= 0
            ? workspaceRevisionParsed
            : undefined;
    const query = url.searchParams.get("query") || "";
    const limit = Number.parseInt(url.searchParams.get("limit") || "40", 10);

    const purchases = await listProjectPurchases({
        provider,
        status,
        userId,
        tenantId,
        projectId,
        workspaceSnapshotId,
        workspaceRevision,
        query,
        limit: Number.isFinite(limit) ? limit : 40
    });

    return NextResponse.json({ purchases, role: admin.role });
}
