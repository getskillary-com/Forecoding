import { AuthCodePurpose, AuthCodePurposes } from "@/lib/auth-types";
import {
    consumeAuthCodeRecord,
    createAuthCodeRecord,
    findRecentAuthCode
} from "@/lib/data/auth-codes";
import { generateVerificationCode, hashVerificationCode, sanitizeEmail } from "@/lib/security";
import { sendVerificationCodeEmail } from "@/lib/mailer";

export const AUTH_CODE_TTL_SECONDS = 120;
const RESEND_COOLDOWN_SECONDS = 120;
const MAX_ATTEMPTS = 5;

function addSeconds(seconds: number): Date {
    return new Date(Date.now() + seconds * 1000);
}

export async function issueAuthCode(input: {
    email: string;
    purpose: AuthCodePurpose;
}) {
    const email = sanitizeEmail(input.email);
    const now = new Date();
    const recentCode = await findRecentAuthCode({
        email,
        purpose: input.purpose,
        now
    });

    if (recentCode) {
        const elapsedSeconds = Math.floor((Date.now() - recentCode.createdAt.getTime()) / 1000);
        if (elapsedSeconds < RESEND_COOLDOWN_SECONDS) {
            return {
                ok: true as const,
                throttled: true as const,
                retryAfterSeconds: Math.max(1, RESEND_COOLDOWN_SECONDS - elapsedSeconds)
            };
        }
    }

    const code = generateVerificationCode();
    const codeHash = hashVerificationCode({
        email,
        purpose: input.purpose,
        code
    });

    await createAuthCodeRecord({
        email,
        purpose: input.purpose,
        codeHash,
        expiresAt: addSeconds(AUTH_CODE_TTL_SECONDS)
    });

    await sendVerificationCodeEmail({
        email,
        code,
        purpose: input.purpose
    });

    return { ok: true as const, throttled: false as const, retryAfterSeconds: 0 };
}

export async function consumeAuthCode(input: {
    email: string;
    code: string;
    purpose: AuthCodePurpose;
}) {
    const email = sanitizeEmail(input.email);
    const now = new Date();
    const codeHash = hashVerificationCode({
        email,
        purpose: input.purpose,
        code: input.code
    });

    return consumeAuthCodeRecord({
        email,
        purpose: input.purpose,
        codeHash,
        maxAttempts: MAX_ATTEMPTS,
        now
    });
}

export { AuthCodePurposes };

