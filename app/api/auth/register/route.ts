import { NextResponse } from "next/server";
import { AuthCodePurposes, consumeAuthCode } from "@/lib/auth-code";
import { isValidEmail, isValidPassword, sanitizeEmail } from "@/lib/security";
import { findAuthUserByEmail, getAuthClientForIdentityTenant } from "@/lib/firebase-admin";
import { upsertUserProfile } from "@/lib/data/users";
import { resolveEnterpriseAuthContext } from "@/lib/enterprise-auth";

export async function POST(req: Request) {
    try {
        const body = (await req.json()) as {
            email?: string;
            password?: string;
            code?: string;
        };

        const email = sanitizeEmail(body.email ?? "");
        const password = body.password ?? "";
        const code = (body.code ?? "").trim();

        if (!isValidEmail(email) || !isValidPassword(password) || code.length !== 6) {
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
            if (!bootstrap.allowRegistration) {
                return NextResponse.json(
                    { error: "Self-service registration is disabled for this company. Use company SSO instead." },
                    { status: 403 }
                );
            }
        }

        const authClient = getAuthClientForIdentityTenant(identityPlatformTenantId);

        const existingUser = await findAuthUserByEmail(email, identityPlatformTenantId);
        if (existingUser) {
            return NextResponse.json({ error: "This email is already registered." }, { status: 409 });
        }

        const codeResult = await consumeAuthCode({
            email,
            code,
            purpose: AuthCodePurposes.register
        });

        if (!codeResult.ok) {
            return NextResponse.json({ error: codeResult.error }, { status: 400 });
        }

        const authUser = await authClient.createUser({
            email,
            emailVerified: true,
            password
        });

        await upsertUserProfile({
            uid: authUser.uid,
            email,
            tenantId: bootstrap.tenantId ?? null,
            name: null,
            image: null,
            emailVerified: new Date(),
            legacyPasswordResetRequired: false,
            sessionVersion: 0
        });

        return NextResponse.json({ ok: true });
    } catch {
        return NextResponse.json({ error: "Failed to create account." }, { status: 500 });
    }
}
