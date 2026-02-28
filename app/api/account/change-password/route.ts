import { NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { getServerUser } from "@/lib/server-auth";
import { isValidPassword } from "@/lib/security";
import { getUserProfileByUid, upsertUserProfile } from "@/lib/data/users";

async function getUserId() {
    const user = await getServerUser();
    return user?.uid ?? null;
}

export async function POST(req: Request) {
    try {
        const userId = await getUserId();
        if (!userId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

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

        const authUser = await adminAuth.getUser(userId);
        if (!authUser.email) {
            return NextResponse.json({ error: "User not found." }, { status: 404 });
        }

        await adminAuth.updateUser(userId, {
            password: newPassword,
            emailVerified: true
        });

        const existing = await getUserProfileByUid(userId);
        await upsertUserProfile({
            uid: userId,
            email: authUser.email,
            name: existing?.name ?? authUser.displayName ?? null,
            image: existing?.image ?? authUser.photoURL ?? null,
            emailVerified: existing?.emailVerified ?? new Date(),
            legacyPasswordResetRequired: false,
            sessionVersion: existing?.sessionVersion ?? 0
        });

        return NextResponse.json({ ok: true });
    } catch {
        return NextResponse.json({ error: "Failed to change password." }, { status: 500 });
    }
}
