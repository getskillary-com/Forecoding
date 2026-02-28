import { NextResponse } from "next/server";
import { AuthCodePurposes, AUTH_CODE_TTL_SECONDS, issueAuthCode } from "@/lib/auth-code";
import { findAuthUserByEmail } from "@/lib/firebase-admin";
import { getServerUser } from "@/lib/server-auth";
import { isValidEmail, sanitizeEmail } from "@/lib/security";

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

        const user = await findAuthUserByEmail(email);

        if (purpose === "register" && user) {
            return NextResponse.json({ error: "This email is already registered." }, { status: 409 });
        }

        if ((purpose === "login" || purpose === "reset_password") && !user) {
            return NextResponse.json({ error: "Account not found." }, { status: 404 });
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
