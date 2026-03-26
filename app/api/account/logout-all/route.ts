import { NextResponse } from "next/server";
import { revokeAuthRefreshTokens } from "@/lib/firebase-admin";
import { getServerUser, clearSessionCookie, getIdentityPlatformTenantIdFromToken } from "@/lib/server-auth";
import { invalidateUserSessions } from "@/lib/data/users";

export const runtime = "nodejs";

export async function POST() {
    try {
        const user = await getServerUser();
        if (!user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const identityPlatformTenantId = getIdentityPlatformTenantIdFromToken(user.token);
        await revokeAuthRefreshTokens({
            uid: user.uid,
            email: user.email,
            identityPlatformTenantId
        });
        await invalidateUserSessions(user.uid);

        const res = NextResponse.json({ ok: true });
        clearSessionCookie(res);
        return res;
    } catch (error) {
        console.error("[account/logout-all] failed to revoke sessions", error);
        return NextResponse.json({ error: "Failed to sign out all devices." }, { status: 500 });
    }
}
