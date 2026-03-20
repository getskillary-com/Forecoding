import { adminAuth } from "@/lib/firebase-admin";
import { attachSessionCookieFromIdToken, clearSessionCookie } from "@/lib/server-auth";
import { NextResponse } from "next/server";
import { getUserProfileByUid } from "@/lib/data/users";

const SESSION_EXPIRES_MS = 1000 * 60 * 60 * 24 * 5;

export const runtime = "nodejs";

export async function POST(req: Request) {
    try {
        const body = (await req.json()) as { idToken?: string };
        const idToken = (body.idToken || "").trim();
        if (!idToken) {
            return NextResponse.json({ error: "Missing idToken." }, { status: 400 });
        }

        const decoded = await adminAuth.verifyIdToken(idToken);
        if (!decoded.uid) {
            return NextResponse.json({ error: "Invalid token." }, { status: 401 });
        }
        const profile = await getUserProfileByUid(decoded.uid);
        if (profile?.status === "suspended") {
            return NextResponse.json(
                { error: "This account is suspended. Contact support for reactivation." },
                { status: 403 }
            );
        }
        if (profile?.legacyPasswordResetRequired) {
            return NextResponse.json(
                { error: "Password reset required before creating a session." },
                { status: 403 }
            );
        }

        const res = NextResponse.json({ ok: true });
        await attachSessionCookieFromIdToken(res, idToken, SESSION_EXPIRES_MS);
        return res;
    } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to create session.";
        return NextResponse.json({ error: message }, { status: 401 });
    }
}

export async function DELETE() {
    const res = NextResponse.json({ ok: true });
    clearSessionCookie(res);
    return res;
}
