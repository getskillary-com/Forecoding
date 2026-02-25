import { AuthCodePurpose } from "@prisma/client";
import { prisma } from "@/lib/prisma";
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

    const recentCode = await prisma.authCode.findFirst({
        where: {
            email,
            purpose: input.purpose,
            usedAt: null,
            expiresAt: { gt: now },
            createdAt: { gt: addSeconds(-RESEND_COOLDOWN_SECONDS) }
        },
        orderBy: { createdAt: "desc" }
    });

    if (recentCode) {
        const elapsedSeconds = Math.floor((Date.now() - recentCode.createdAt.getTime()) / 1000);
        return {
            ok: true as const,
            throttled: true as const,
            retryAfterSeconds: Math.max(1, RESEND_COOLDOWN_SECONDS - elapsedSeconds)
        };
    }

    const code = generateVerificationCode();
    const codeHash = hashVerificationCode({
        email,
        purpose: input.purpose,
        code
    });

    await prisma.authCode.create({
        data: {
            email,
            purpose: input.purpose,
            codeHash,
            expiresAt: addSeconds(AUTH_CODE_TTL_SECONDS)
        }
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
    const record = await prisma.authCode.findFirst({
        where: {
            email,
            purpose: input.purpose,
            usedAt: null,
            expiresAt: { gt: now }
        },
        orderBy: { createdAt: "desc" }
    });

    if (!record) {
        return { ok: false as const, error: "Verification code is invalid or expired." };
    }

    if (record.attempts >= MAX_ATTEMPTS) {
        return { ok: false as const, error: "Too many attempts. Request a new verification code." };
    }

    const inputHash = hashVerificationCode({
        email,
        purpose: input.purpose,
        code: input.code
    });

    if (inputHash !== record.codeHash) {
        await prisma.authCode.update({
            where: { id: record.id },
            data: { attempts: { increment: 1 } }
        });
        return { ok: false as const, error: "Verification code is incorrect." };
    }

    await prisma.authCode.update({
        where: { id: record.id },
        data: { usedAt: now }
    });

    return { ok: true as const };
}

export const AuthCodePurposes = {
    register: AuthCodePurpose.REGISTER,
    login: AuthCodePurpose.LOGIN,
    resetPassword: AuthCodePurpose.RESET_PASSWORD,
    changeEmail: AuthCodePurpose.CHANGE_EMAIL
} as const;
