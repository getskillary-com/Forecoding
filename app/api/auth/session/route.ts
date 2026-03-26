import { adminAuth } from "@/lib/firebase-admin";
import { attachSessionCookieFromIdToken, clearSessionCookie } from "@/lib/server-auth";
import { NextResponse } from "next/server";
import { getUserProfileByUid, upsertUserProfile } from "@/lib/data/users";
import { resolveEnterpriseAuthContext } from "@/lib/enterprise-auth";

const SESSION_EXPIRES_MS = 1000 * 60 * 60 * 24 * 5;

export const runtime = "nodejs";

function readSignInProvider(decoded: Awaited<ReturnType<typeof adminAuth.verifyIdToken>>) {
    return typeof decoded.firebase?.sign_in_provider === "string"
        ? decoded.firebase.sign_in_provider
        : "";
}

function readIdentityPlatformTenantId(decoded: Awaited<ReturnType<typeof adminAuth.verifyIdToken>>) {
    if (typeof decoded.firebase?.tenant === "string" && decoded.firebase.tenant.trim()) {
        return decoded.firebase.tenant.trim();
    }
    if (typeof decoded.tenant_id === "string" && decoded.tenant_id.trim()) {
        return decoded.tenant_id.trim();
    }
    return null;
}

export async function POST(req: Request) {
    try {
        const body = (await req.json()) as { idToken?: string };
        const idToken = (body.idToken || "").trim();
        if (!idToken) {
            return NextResponse.json({ error: "Missing idToken." }, { status: 400 });
        }

        const decoded = await adminAuth.verifyIdToken(idToken, true);
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

        const signInProvider = readSignInProvider(decoded);
        const identityPlatformTenantId = readIdentityPlatformTenantId(decoded);
        const authContext = await resolveEnterpriseAuthContext({
            email: decoded.email ?? null,
            tenantHint: profile?.tenantId ?? null,
            identityPlatformTenantId
        });
        const bootstrap = authContext.bootstrap;

        if (!bootstrap.ready) {
            return NextResponse.json(
                { error: bootstrap.message || "Enterprise sign-in is not fully configured for this tenant." },
                { status: 403 }
            );
        }

        if (bootstrap.mode === "enterprise") {
            if (!decoded.email) {
                return NextResponse.json(
                    { error: "Enterprise sign-in requires a verified company email address." },
                    { status: 403 }
                );
            }
            if (!decoded.email_verified) {
                return NextResponse.json(
                    { error: "Enterprise sign-in requires a verified company email address." },
                    { status: 403 }
                );
            }
            const isPasswordSignIn = signInProvider === "password";
            const isCustomTokenSignIn = signInProvider === "custom";
            const isDirectGoogleSignIn = signInProvider === "google.com";

            if (isPasswordSignIn && !bootstrap.allowPasswordLogin) {
                return NextResponse.json(
                    { error: "Password sign-in is disabled for this company. Use company SSO instead." },
                    { status: 403 }
                );
            }
            if (isCustomTokenSignIn && !bootstrap.allowCodeLogin) {
                return NextResponse.json(
                    { error: "Verification-code and custom-token sign-in are disabled for this company." },
                    { status: 403 }
                );
            }
            if (isDirectGoogleSignIn && !bootstrap.allowGoogleLogin) {
                return NextResponse.json(
                    { error: "Direct Google sign-in is disabled for this company. Use the configured enterprise provider." },
                    { status: 403 }
                );
            }

            const usesAllowedFallbackMethod =
                (isPasswordSignIn && bootstrap.allowPasswordLogin) ||
                (isCustomTokenSignIn && bootstrap.allowCodeLogin) ||
                (isDirectGoogleSignIn && bootstrap.allowGoogleLogin);

            if (
                bootstrap.identityPlatformTenantId &&
                identityPlatformTenantId !== bootstrap.identityPlatformTenantId
            ) {
                return NextResponse.json(
                    { error: "This sign-in was issued for a different enterprise tenant." },
                    { status: 403 }
                );
            }
            if (
                bootstrap.providerId &&
                signInProvider &&
                signInProvider !== bootstrap.providerId &&
                !usesAllowedFallbackMethod
            ) {
                return NextResponse.json(
                    { error: "This company requires signing in with its configured enterprise identity provider." },
                    { status: 403 }
                );
            }
        }

        const resolvedTenantId = bootstrap.tenantId ?? profile?.tenantId ?? null;

        if (!profile && decoded.email) {
            await upsertUserProfile({
                uid: decoded.uid,
                email: decoded.email,
                tenantId: resolvedTenantId,
                name: typeof decoded.name === "string" ? decoded.name : null,
                image: typeof decoded.picture === "string" ? decoded.picture : null,
                emailVerified: decoded.email_verified ? new Date() : null,
                legacyPasswordResetRequired: false,
                sessionVersion: 0
            });
        } else if (profile && resolvedTenantId && profile.tenantId !== resolvedTenantId && decoded.email) {
            await upsertUserProfile({
                uid: decoded.uid,
                email: profile.email || decoded.email,
                tenantId: resolvedTenantId,
                name: profile.name ?? (typeof decoded.name === "string" ? decoded.name : null),
                image: profile.image ?? (typeof decoded.picture === "string" ? decoded.picture : null),
                emailVerified: profile.emailVerified ?? (decoded.email_verified ? new Date() : null),
                legacyPasswordResetRequired: profile.legacyPasswordResetRequired,
                sessionVersion: profile.sessionVersion
            });
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
