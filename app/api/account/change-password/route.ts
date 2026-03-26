import { NextResponse } from "next/server";
import { getAuthClientForIdentityTenant } from "@/lib/firebase-admin";
import { clearSessionCookie, getServerUser, getIdentityPlatformTenantIdFromToken } from "@/lib/server-auth";
import { isValidPassword } from "@/lib/security";
import { getUserProfileByUid, invalidateUserSessions, upsertUserProfile } from "@/lib/data/users";

export async function POST(req: Request) {
    try {
        const user = await getServerUser();
        if (!user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const userId = user.uid;
        const identityPlatformTenantId = getIdentityPlatformTenantIdFromToken(user.token);
        const authClient = getAuthClientForIdentityTenant(identityPlatformTenantId);

        const body = (await req.json()) as {
            newPassword?: string;
            confirmNewPassword?: string;
        };
        const newPassword = body.newPassword ?? "";
        const confirmNewPassword = body.confirmNewPassword ?? "";

        if (!isValidPassword(newPassword)) {
            return NextResponse.json({ error: "New password must be at least 8 characters." }, { status: 400 });
        }

        if (confirmNewPassword && newPassword !== confirmNewPassword) {
            return NextResponse.json({ error: "Two passwords do not match." }, { status: 400 });
        }

        const authUser = await authClient.getUser(userId);
        if (!authUser.email) {
            return NextResponse.json({ error: "User not found." }, { status: 404 });
        }

        await authClient.updateUser(userId, {
            password: newPassword,
            emailVerified: true
        });
        await authClient.revokeRefreshTokens(userId);

        const existing = await getUserProfileByUid(userId);
        const invalidatedProfile = await invalidateUserSessions(userId);
        await upsertUserProfile({
            uid: userId,
            email: authUser.email,
            name: existing?.name ?? authUser.displayName ?? null,
            image: existing?.image ?? authUser.photoURL ?? null,
            emailVerified: existing?.emailVerified ?? new Date(),
            legacyPasswordResetRequired: false,
            sessionVersion: invalidatedProfile?.sessionVersion ?? ((existing?.sessionVersion ?? 0) + 1),
            sessionInvalidAfter: invalidatedProfile?.sessionInvalidAfter ?? new Date()
        });

        const res = NextResponse.json({ ok: true, reauthRequired: true });
        clearSessionCookie(res);
        return res;
    } catch {
        return NextResponse.json({ error: "Failed to change password." }, { status: 500 });
    }
}
