import { NextResponse } from "next/server";
import { getServerUser } from "@/lib/server-auth";
import { adminAuth } from "@/lib/firebase-admin";
import { getUserProfileByUid, upsertUserProfile } from "@/lib/data/users";

async function getUserId() {
    const user = await getServerUser();
    return user?.uid ?? null;
}

export async function GET() {
    try {
        const serverUser = await getServerUser();
        const userId = serverUser?.uid ?? null;
        if (!userId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const profile = await getUserProfileByUid(userId);
        const authUser = await adminAuth.getUser(userId);

        if (!profile && !authUser) {
            return NextResponse.json({ error: "User not found." }, { status: 404 });
        }

        if (!profile && authUser.email) {
            await upsertUserProfile({
                uid: userId,
                email: authUser.email,
                name: authUser.displayName ?? null,
                image: authUser.photoURL ?? null,
                emailVerified: authUser.emailVerified ? new Date() : null,
                legacyPasswordResetRequired: false
            });
        }

        const mergedProfile = (await getUserProfileByUid(userId)) || profile;

        return NextResponse.json({
            user: {
                email: mergedProfile?.email || authUser.email || "",
                name: mergedProfile?.name || authUser.displayName || "",
                image: mergedProfile?.image || authUser.photoURL || null,
                emailVerified: mergedProfile?.emailVerified?.toISOString() || null
            }
        });
    } catch {
        return NextResponse.json({ error: "Failed to load profile." }, { status: 500 });
    }
}

export async function PATCH(req: Request) {
    try {
        const userId = await getUserId();
        if (!userId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = (await req.json()) as { name?: string };
        const name = (body.name ?? "").trim();

        if (name.length > 80) {
            return NextResponse.json({ error: "Name is too long." }, { status: 400 });
        }

        const authUser = await adminAuth.getUser(userId);
        if (!authUser.email) {
            return NextResponse.json({ error: "User email missing." }, { status: 400 });
        }

        await adminAuth.updateUser(userId, {
            displayName: name || null
        });
        const updated = await upsertUserProfile({
            uid: userId,
            email: authUser.email,
            name: name || null,
            image: authUser.photoURL || null,
            emailVerified: authUser.emailVerified ? new Date() : null,
            legacyPasswordResetRequired: false
        });

        return NextResponse.json({
            ok: true,
            user: {
                email: updated.email,
                name: updated.name,
                image: updated.image,
                emailVerified: updated.emailVerified?.toISOString() || null
            }
        });
    } catch {
        return NextResponse.json({ error: "Failed to update profile." }, { status: 500 });
    }
}
