import { NextResponse } from "next/server";
import { adminAuth, findAuthUserByEmail } from "@/lib/firebase-admin";
import { sanitizeEmail } from "@/lib/security";
import { getUserProfileByUid, upsertUserProfile } from "@/lib/data/users";
import { isDevAuthBypassEnabled } from "@/lib/env";

export const runtime = "nodejs";

export async function POST(req: Request) {
    if (!isDevAuthBypassEnabled()) {
        return NextResponse.json({ error: "Dev login is disabled." }, { status: 403 });
    }

    try {
        const body = (await req.json()) as { email?: string };
        const email = sanitizeEmail(body.email || "dev@local");
        let user = await findAuthUserByEmail(email);
        if (!user) {
            user = await adminAuth.createUser({
                email,
                emailVerified: true,
                displayName: "Dev User"
            });
        }

        const existing = await getUserProfileByUid(user.uid);
        if (existing?.status === "suspended") {
            return NextResponse.json(
                { error: "This account is suspended. Contact support for reactivation." },
                { status: 403 }
            );
        }

        await upsertUserProfile({
            uid: user.uid,
            email,
            name: user.displayName || "Dev User",
            image: user.photoURL || null,
            emailVerified: new Date(),
            legacyPasswordResetRequired: false
        });

        const customToken = await adminAuth.createCustomToken(user.uid, {
            method: "dev_login"
        });

        return NextResponse.json({ ok: true, customToken });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to run dev login.";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
