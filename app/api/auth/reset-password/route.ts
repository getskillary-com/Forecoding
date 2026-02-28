import { NextResponse } from "next/server";
import { AuthCodePurposes, consumeAuthCode } from "@/lib/auth-code";
import { isValidEmail, isValidPassword, sanitizeEmail } from "@/lib/security";
import { adminAuth, findAuthUserByEmail } from "@/lib/firebase-admin";
import { getUserProfileByUid, upsertUserProfile } from "@/lib/data/users";

export async function POST(req: Request) {
    try {
        const body = (await req.json()) as {
            email?: string;
            newPassword?: string;
            code?: string;
        };

        const email = sanitizeEmail(body.email ?? "");
        const newPassword = body.newPassword ?? "";
        const code = (body.code ?? "").trim();

        if (!isValidEmail(email) || !isValidPassword(newPassword) || code.length !== 6) {
            return NextResponse.json({ error: "Invalid request payload." }, { status: 400 });
        }

        const authUser = await findAuthUserByEmail(email);
        if (!authUser) {
            return NextResponse.json({ error: "Account not found." }, { status: 404 });
        }

        const codeResult = await consumeAuthCode({
            email,
            code,
            purpose: AuthCodePurposes.resetPassword
        });

        if (!codeResult.ok) {
            return NextResponse.json({ error: codeResult.error }, { status: 400 });
        }

        await adminAuth.updateUser(authUser.uid, {
            password: newPassword,
            emailVerified: true
        });
        await adminAuth.revokeRefreshTokens(authUser.uid);

        const existing = await getUserProfileByUid(authUser.uid);
        await upsertUserProfile({
            uid: authUser.uid,
            email,
            name: existing?.name ?? authUser.displayName ?? null,
            image: existing?.image ?? authUser.photoURL ?? null,
            emailVerified: existing?.emailVerified ?? new Date(),
            legacyPasswordResetRequired: false,
            sessionVersion: (existing?.sessionVersion ?? 0) + 1
        });

        return NextResponse.json({ ok: true });
    } catch {
        return NextResponse.json({ error: "Failed to reset password." }, { status: 500 });
    }
}
