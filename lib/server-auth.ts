import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { DecodedIdToken } from "firebase-admin/auth";
import { adminAuth } from "@/lib/firebase-admin";
import { getUserProfileByUid, upsertUserProfile } from "@/lib/data/users";

export const AUTH_SESSION_COOKIE_NAME = process.env.AUTH_SESSION_COOKIE_NAME || "__session";
const DEFAULT_SESSION_EXPIRES_MS = 1000 * 60 * 60 * 24 * 5;

export type ServerUser = {
    uid: string;
    email: string | null;
    name: string | null;
    sessionVersion: number;
    legacyPasswordResetRequired: boolean;
    token: DecodedIdToken;
};

function buildCookieOptions(maxAgeSeconds: number) {
    return {
        name: AUTH_SESSION_COOKIE_NAME,
        value: "",
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax" as const,
        path: "/",
        maxAge: maxAgeSeconds
    };
}

export async function attachSessionCookieFromIdToken(
    response: NextResponse,
    idToken: string,
    expiresInMs: number = DEFAULT_SESSION_EXPIRES_MS
) {
    const sessionCookie = await adminAuth.createSessionCookie(idToken, {
        expiresIn: expiresInMs
    });
    response.cookies.set({
        ...buildCookieOptions(Math.floor(expiresInMs / 1000)),
        value: sessionCookie
    });
}

export function clearSessionCookie(response: NextResponse) {
    response.cookies.set({
        ...buildCookieOptions(0),
        value: ""
    });
}

export async function getServerUser(): Promise<ServerUser | null> {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get(AUTH_SESSION_COOKIE_NAME)?.value || "";
    if (!sessionCookie) return null;

    let token: DecodedIdToken;
    try {
        token = await adminAuth.verifySessionCookie(sessionCookie, true);
    } catch {
        return null;
    }

    const uid = token.uid;
    if (!uid) return null;

    const email = token.email || null;
    const existing = await getUserProfileByUid(uid);
    if (!existing && email) {
        await upsertUserProfile({
            uid,
            email,
            name: typeof token.name === "string" ? token.name : null,
            emailVerified: token.email_verified ? new Date() : null,
            legacyPasswordResetRequired: false,
            sessionVersion: 0
        });
    }
    const profile = (await getUserProfileByUid(uid)) || null;

    return {
        uid,
        email: profile?.email || email,
        name: profile?.name || (typeof token.name === "string" ? token.name : null),
        sessionVersion: profile?.sessionVersion ?? 0,
        legacyPasswordResetRequired: profile?.legacyPasswordResetRequired === true,
        token
    };
}
