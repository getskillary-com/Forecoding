import { NextResponse } from "next/server";
import { AuthCodePurposes, consumeAuthCode } from "@/lib/auth-code";
import { findAuthUserByEmail, adminAuth } from "@/lib/firebase-admin";
import { isValidEmail, sanitizeEmail } from "@/lib/security";
import { getUserProfileByUid, upsertUserProfile } from "@/lib/data/users";

export const runtime = "nodejs";

export async function POST(req: Request) {
    try {
        const body = (await req.json()) as { email?: string; code?: string };
        const email = sanitizeEmail(body.email ?? "");
        const code = (body.code ?? "").trim();

        if (!isValidEmail(email) || code.length !== 6) {
            return NextResponse.json({ error: "Invalid request payload." }, { status: 400 });
        }

        const codeResult = await consumeAuthCode({
            email,
            code,
            purpose: AuthCodePurposes.login
        });
        if (!codeResult.ok) {
            return NextResponse.json({ error: codeResult.error }, { status: 400 });
        }

        const authUser = await findAuthUserByEmail(email);
        if (!authUser) {
            return NextResponse.json({ error: "Account not found." }, { status: 404 });
        }

        const existing = await getUserProfileByUid(authUser.uid);
        if (existing?.status === "suspended") {
            return NextResponse.json(
                { error: "This account is suspended. Contact support for reactivation." },
                { status: 403 }
            );
        }
        if (existing?.legacyPasswordResetRequired) {
            return NextResponse.json(
                { error: "This account requires password reset before sign in." },
                { status: 403 }
            );
        }

        if (!authUser.emailVerified) {
            await adminAuth.updateUser(authUser.uid, { emailVerified: true });
        }

        await upsertUserProfile({
            uid: authUser.uid,
            email,
            name: existing?.name ?? authUser.displayName ?? null,
            image: existing?.image ?? authUser.photoURL ?? null,
            emailVerified: new Date(),
            legacyPasswordResetRequired: false
        });

        const customToken = await adminAuth.createCustomToken(authUser.uid, {
            method: "code_login"
        });

        return NextResponse.json({ ok: true, customToken });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to sign in with verification code.";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
