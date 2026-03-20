import { NextResponse } from "next/server";
import { getServerSessionIdentity } from "@/lib/server-auth";
import { getAdminCapabilitiesForRole, isAdminUser, resolveAdminRole } from "@/lib/admin";

export const runtime = "nodejs";

export async function GET() {
    try {
        const user = await getServerSessionIdentity();

        if (!user?.uid) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const adminRole = resolveAdminRole({ email: user.email });

        return NextResponse.json({
            ok: true,
            isAdmin: isAdminUser({ email: user.email }),
            adminRole,
            capabilities: getAdminCapabilitiesForRole(adminRole)
        });
    } catch {
        return NextResponse.json({ error: "Failed to resolve admin status." }, { status: 500 });
    }
}
