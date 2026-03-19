import { NextResponse } from "next/server";
import { getServerSessionIdentity } from "@/lib/server-auth";
import { hasAdminRole, resolveAdminRole, type AdminRole } from "@/lib/admin";

export async function requireAdminRoute(options?: {
    minimumRole?: Exclude<AdminRole, "none">;
}) {
    const user = await getServerSessionIdentity();
    if (!user?.uid) {
        return {
            user: null,
            role: "none" as const,
            error: NextResponse.json({ error: "Unauthorized" }, { status: 401 })
        };
    }

    const minimumRole = options?.minimumRole ?? "viewer";
    const role = resolveAdminRole({ email: user.email });
    if (!hasAdminRole({ email: user.email }, minimumRole)) {
        return {
            user: null,
            role,
            error: NextResponse.json({ error: "Forbidden" }, { status: 403 })
        };
    }

    return {
        user,
        role,
        error: null
    };
}
