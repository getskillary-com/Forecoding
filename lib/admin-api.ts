import { NextResponse } from "next/server";
import { getServerSessionIdentity } from "@/lib/server-auth";
import {
    getAdminCapabilitiesForRole,
    hasAdminRole,
    resolveAdminRole,
    type AdminCapability,
    type AdminRole
} from "@/lib/admin";

export async function requireAdminRoute(options?: {
    minimumRole?: Exclude<AdminRole, "none">;
    minimumCapability?: AdminCapability;
}) {
    const user = await getServerSessionIdentity();
    if (!user?.uid) {
        return {
            user: null,
            role: "none" as const,
            capabilities: [] as AdminCapability[],
            error: NextResponse.json({ error: "Unauthorized" }, { status: 401 })
        };
    }

    const role = resolveAdminRole({ email: user.email });
    const capabilities = getAdminCapabilitiesForRole(role);
    const minimumCapability = options?.minimumCapability;
    if (minimumCapability && !capabilities.includes(minimumCapability)) {
        return {
            user: null,
            role,
            capabilities,
            error: NextResponse.json({ error: "Forbidden" }, { status: 403 })
        };
    }

    const minimumRole = options?.minimumRole ?? "viewer";
    if (!hasAdminRole({ email: user.email }, minimumRole)) {
        return {
            user: null,
            role,
            capabilities,
            error: NextResponse.json({ error: "Forbidden" }, { status: 403 })
        };
    }

    return {
        user,
        role,
        capabilities,
        error: null
    };
}
