import { NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { getServerUser, clearSessionCookie } from "@/lib/server-auth";
import { bumpUserSessionVersion } from "@/lib/data/users";

async function getUserId() {
    const user = await getServerUser();
    return user?.uid ?? null;
}

export async function POST() {
    try {
        const userId = await getUserId();
        if (!userId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        await adminAuth.revokeRefreshTokens(userId);
        await bumpUserSessionVersion(userId);

        const res = NextResponse.json({ ok: true });
        clearSessionCookie(res);
        return res;
    } catch {
        return NextResponse.json({ error: "Failed to sign out all devices." }, { status: 500 });
    }
}
