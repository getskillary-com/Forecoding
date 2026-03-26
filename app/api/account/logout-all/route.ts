import { NextResponse } from "next/server";
import { getAuthClientForIdentityTenant } from "@/lib/firebase-admin";
import { getServerUser, clearSessionCookie, getIdentityPlatformTenantIdFromToken } from "@/lib/server-auth";
import { invalidateUserSessions } from "@/lib/data/users";

export async function POST() {
    try {
        const user = await getServerUser();
        if (!user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const identityPlatformTenantId = getIdentityPlatformTenantIdFromToken(user.token);
        const authClient = getAuthClientForIdentityTenant(identityPlatformTenantId);
        await authClient.revokeRefreshTokens(user.uid);
        await invalidateUserSessions(user.uid);

        const res = NextResponse.json({ ok: true });
        clearSessionCookie(res);
        return res;
    } catch {
        return NextResponse.json({ error: "Failed to sign out all devices." }, { status: 500 });
    }
}
