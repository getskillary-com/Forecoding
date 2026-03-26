import { NextResponse } from "next/server";
import { getServerSessionIdentity } from "@/lib/server-auth";
import { getAdminCapabilitiesForRole, hasAdminRole, resolveAdminRole } from "@/lib/admin";
import { runRuntimePreflightCheck } from "@/lib/runtime-preflight";

export const runtime = "nodejs";

export async function GET() {
    const user = await getServerSessionIdentity();
    const role = resolveAdminRole({ email: user?.email });
    const capabilities = getAdminCapabilitiesForRole(role);
    const canViewAdminStatus = hasAdminRole({ email: user?.email }, "viewer");

    if (!canViewAdminStatus) {
        return NextResponse.json({
            ok: true,
            isAdmin: false,
            adminRole: role,
            capabilities: []
        });
    }

    const runtimePreflight = runRuntimePreflightCheck();
    return NextResponse.json({
        ok: true,
        isAdmin: role === "admin",
        adminRole: role,
        capabilities,
        runtimePreflight
    });
}
