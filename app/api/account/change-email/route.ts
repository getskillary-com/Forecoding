import { NextResponse } from "next/server";
import { AuthCodePurposes, consumeAuthCode } from "@/lib/auth-code";
import { isValidEmail, sanitizeEmail } from "@/lib/security";
import { getServerUser } from "@/lib/server-auth";
import { adminAuth, findAuthUserByEmail } from "@/lib/firebase-admin";
import { getUserProfileByUid, upsertUserProfile } from "@/lib/data/users";

export async function POST(req: Request) {
    try {
        const sessionUser = await getServerUser();
        const userId = sessionUser?.uid;
        if (!userId) {
            return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
        }

        const body = (await req.json()) as { email?: string; code?: string };
        const email = sanitizeEmail(body.email ?? "");
        const code = (body.code ?? "").trim();

        if (!isValidEmail(email) || code.length !== 6) {
            return NextResponse.json({ error: "Invalid request payload." }, { status: 400 });
        }

        const currentAuthUser = await adminAuth.getUser(userId);
        if (!currentAuthUser.email) {
            return NextResponse.json({ error: "Account not found." }, { status: 404 });
        }

        if (sanitizeEmail(currentAuthUser.email) === email) {
            return NextResponse.json({ error: "New email must be different from current email." }, { status: 400 });
        }

        const existingUser = await findAuthUserByEmail(email);
        if (existingUser && existingUser.uid !== userId) {
            return NextResponse.json({ error: "This email is already registered." }, { status: 409 });
        }

        const codeResult = await consumeAuthCode({
            email,
            code,
            purpose: AuthCodePurposes.changeEmail
        });
        if (!codeResult.ok) {
            return NextResponse.json({ error: codeResult.error }, { status: 400 });
        }

        await adminAuth.updateUser(userId, {
            email,
            emailVerified: true
        });
        const profile = await getUserProfileByUid(userId);
        await upsertUserProfile({
            uid: userId,
            email,
            name: profile?.name ?? currentAuthUser.displayName ?? null,
            image: profile?.image ?? currentAuthUser.photoURL ?? null,
            emailVerified: new Date(),
            legacyPasswordResetRequired: false,
            sessionVersion: profile?.sessionVersion ?? 0
        });

        return NextResponse.json({ ok: true, email });
    } catch {
        return NextResponse.json({ error: "Failed to change email." }, { status: 500 });
    }
}
