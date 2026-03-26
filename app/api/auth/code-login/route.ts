import { NextResponse } from "next/server";
import { AuthCodePurposes, consumeAuthCode } from "@/lib/auth-code";
import { findAuthUserByEmail, getAuthClientForIdentityTenant } from "@/lib/firebase-admin";
import { isValidEmail, sanitizeEmail } from "@/lib/security";
import { getUserProfileByUid, upsertUserProfile } from "@/lib/data/users";
import { resolveEnterpriseAuthContext } from "@/lib/enterprise-auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
    try {
        const body = (await req.json()) as { email?: string; code?: string };
        const email = sanitizeEmail(body.email ?? "");
        const code = (body.code ?? "").trim();

        if (!isValidEmail(email) || code.length !== 6) {
            return NextResponse.json({ error: "Invalid request payload." }, { status: 400 });
        }

        const authContext = await resolveEnterpriseAuthContext({ email });
        const bootstrap = authContext.bootstrap;
        const identityPlatformTenantId =
            bootstrap.mode === "enterprise" ? bootstrap.identityPlatformTenantId : null;
        if (bootstrap.mode === "enterprise") {
            if (!bootstrap.ready) {
                return NextResponse.json(
                    { error: bootstrap.message || "Enterprise sign-in is not fully configured for this tenant." },
                    { status: 403 }
                );
            }
            if (!bootstrap.allowCodeLogin) {
                return NextResponse.json(
                    { error: "Verification-code sign-in is disabled for this company. Use company SSO instead." },
                    { status: 403 }
                );
            }
        }

        const authClient = getAuthClientForIdentityTenant(identityPlatformTenantId);

        const codeResult = await consumeAuthCode({
            email,
            code,
            purpose: AuthCodePurposes.login
        });
        if (!codeResult.ok) {
            return NextResponse.json({ error: codeResult.error }, { status: 400 });
        }

        const authUser = await findAuthUserByEmail(email, identityPlatformTenantId);
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
            await authClient.updateUser(authUser.uid, { emailVerified: true });
        }

        await upsertUserProfile({
            uid: authUser.uid,
            email,
            tenantId: bootstrap.tenantId ?? existing?.tenantId ?? null,
            name: existing?.name ?? authUser.displayName ?? null,
            image: existing?.image ?? authUser.photoURL ?? null,
            emailVerified: new Date(),
            legacyPasswordResetRequired: false
        });

        const customToken = await authClient.createCustomToken(authUser.uid, {
            method: "code_login"
        });

        return NextResponse.json({ ok: true, customToken });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to sign in with verification code.";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
