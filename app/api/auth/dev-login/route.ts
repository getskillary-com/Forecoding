import { NextResponse } from "next/server";
import { adminAuth, findAuthUserByEmail } from "@/lib/firebase-admin";
import { sanitizeEmail } from "@/lib/security";
import { upsertUserProfile } from "@/lib/data/users";

export const runtime = "nodejs";

function isDevBypassEnabled() {
    return process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS === "1";
}

export async function POST(req: Request) {
    if (!isDevBypassEnabled()) {
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

