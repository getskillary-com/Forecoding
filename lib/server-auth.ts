import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { DecodedIdToken } from "firebase-admin/auth";
import { adminAuth } from "@/lib/firebase-admin";
import { getUserProfileByUid, upsertUserProfile } from "@/lib/data/users";
import { resolveTenantForUser } from "@/lib/data/tenants";
import { getAuthSessionCookieName } from "@/lib/env";

export const AUTH_SESSION_COOKIE_NAME = getAuthSessionCookieName();
const DEFAULT_SESSION_EXPIRES_MS = 1000 * 60 * 60 * 24 * 5;

export type ServerUser = {
    uid: string;
    email: string | null;
    name: string | null;
    tenantId: string | null;
    tenantStatus: "active" | "trial" | "suspended" | null;
    sessionVersion: number;
    legacyPasswordResetRequired: boolean;
    token: DecodedIdToken;
};

export type ServerSessionIdentity = {
    uid: string;
    email: string | null;
    name: string | null;
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

export async function getServerSessionIdentity(): Promise<ServerSessionIdentity | null> {
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

    const profile = await getUserProfileByUid(uid);
    if (profile?.status === "suspended") {
        return null;
    }

    return {
        uid,
        email: token.email || null,
        name: typeof token.name === "string" ? token.name : null,
        token
    };
}

export async function getServerUser(): Promise<ServerUser | null> {
    const session = await getServerSessionIdentity();
    if (!session) return null;

    let profile = await getUserProfileByUid(session.uid);
    if (!profile && session.email) {
        profile = await upsertUserProfile({
            uid: session.uid,
            email: session.email,
            name: session.name,
            emailVerified: session.token.email_verified ? new Date() : null,
            legacyPasswordResetRequired: false,
            sessionVersion: 0
        });
    }
    const tenant = await resolveTenantForUser({
        userId: session.uid,
        email: profile?.email || session.email,
        tenantId: profile?.tenantId ?? null
    });
    if (tenant?.id && profile?.tenantId !== tenant.id && (profile?.email || session.email)) {
        profile = await upsertUserProfile({
            uid: session.uid,
            email: profile?.email || session.email || "",
            tenantId: tenant.id,
            name: profile?.name ?? session.name,
            image: profile?.image ?? null,
            emailVerified: profile?.emailVerified ?? (session.token.email_verified ? new Date() : null),
            legacyPasswordResetRequired: profile?.legacyPasswordResetRequired ?? false,
            sessionVersion: profile?.sessionVersion ?? 0
        });
    }

    return {
        uid: session.uid,
        email: profile?.email || session.email,
        name: profile?.name || session.name,
        tenantId: profile?.tenantId ?? tenant?.id ?? null,
        tenantStatus: tenant?.status ?? null,
        sessionVersion: profile?.sessionVersion ?? 0,
        legacyPasswordResetRequired: profile?.legacyPasswordResetRequired === true,
        token: session.token
    };
}
