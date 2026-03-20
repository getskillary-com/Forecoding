import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/admin-api";
import { runRuntimePreflightCheck } from "@/lib/runtime-preflight";

export const runtime = "nodejs";

export async function GET() {
    const admin = await requireAdminRoute();
    if (admin.error) return admin.error;

    const runtimePreflight = runRuntimePreflightCheck();
    return NextResponse.json({
        ok: true,
        isAdmin: admin.role === "admin",
        adminRole: admin.role,
        capabilities: admin.capabilities,
        runtimePreflight
    });
}
