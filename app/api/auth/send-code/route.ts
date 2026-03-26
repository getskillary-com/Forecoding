import { NextResponse } from "next/server";
import { AuthCodePurposes, AUTH_CODE_TTL_SECONDS, issueAuthCode } from "@/lib/auth-code";
import { findAuthUserByEmail } from "@/lib/firebase-admin";
import { getUserProfileByUid } from "@/lib/data/users";
import { getServerUser } from "@/lib/server-auth";
import { isValidEmail, sanitizeEmail } from "@/lib/security";
import { resolveEnterpriseAuthContext } from "@/lib/enterprise-auth";

type SendCodePurpose = "register" | "login" | "reset_password" | "change_email";

function parsePurpose(value: string): SendCodePurpose | null {
    if (
        value === "register" ||
        value === "login" ||
        value === "reset_password" ||
        value === "change_email"
    ) {
        return value;
    }
    return null;
}

export async function POST(req: Request) {
    try {
        const body = (await req.json()) as { email?: string; purpose?: string };
        const rawEmail = body.email ?? "";
        const email = sanitizeEmail(rawEmail);
        const purpose = parsePurpose(body.purpose ?? "");

        if (!purpose || !isValidEmail(email)) {
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
            if (purpose === "register" && !bootstrap.allowRegistration) {
                return NextResponse.json(
                    { error: "Self-service registration is disabled for this company. Use company SSO instead." },
                    { status: 403 }
                );
            }
            if (purpose === "login" && !bootstrap.allowCodeLogin) {
                return NextResponse.json(
                    { error: "Verification-code sign-in is disabled for this company. Use company SSO instead." },
                    { status: 403 }
                );
            }
            if (purpose === "reset_password" && !bootstrap.allowPasswordLogin) {
                return NextResponse.json(
                    { error: "Password reset is disabled for this company because password sign-in is not enabled." },
                    { status: 403 }
                );
            }
        }

        let sessionUserId: string | null = null;
        let sessionUserEmail: string | null = null;
        if (purpose === "change_email") {
            const sessionUser = await getServerUser();
            sessionUserId = sessionUser?.uid ?? null;
            sessionUserEmail = sessionUser?.email ?? null;
            if (!sessionUserId) {
                return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
            }
        }

        const user = await findAuthUserByEmail(email, identityPlatformTenantId);

        if (purpose === "register" && user) {
            return NextResponse.json({ error: "This email is already registered." }, { status: 409 });
        }

        if ((purpose === "login" || purpose === "reset_password") && !user) {
            return NextResponse.json({ error: "Account not found." }, { status: 404 });
        }

        if ((purpose === "login" || purpose === "reset_password") && user?.uid) {
            const profile = await getUserProfileByUid(user.uid);
            if (profile?.status === "suspended") {
                return NextResponse.json(
                    { error: "This account is suspended. Contact support for reactivation." },
                    { status: 403 }
                );
            }
        }

        if (purpose === "change_email") {
            if (sessionUserEmail && sanitizeEmail(sessionUserEmail) === email) {
                return NextResponse.json({ error: "New email must be different from current email." }, { status: 400 });
            }

            if (user && user.uid !== sessionUserId) {
                return NextResponse.json({ error: "This email is already registered." }, { status: 409 });
            }
        }

        const purposeMap = {
            register: AuthCodePurposes.register,
            login: AuthCodePurposes.login,
            reset_password: AuthCodePurposes.resetPassword,
            change_email: AuthCodePurposes.changeEmail
        } as const;

        const issueResult = await issueAuthCode({
            email,
            purpose: purposeMap[purpose]
        });

        return NextResponse.json({
            ok: true,
            throttled: issueResult.throttled,
            retryAfterSeconds: issueResult.retryAfterSeconds,
            expiresInSeconds: AUTH_CODE_TTL_SECONDS
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to send verification code.";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
