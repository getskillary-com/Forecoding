import { createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from "crypto";
import type { AuthCodePurpose } from "@prisma/client";

const PASSWORD_KEYLEN = 64;
const PASSWORD_SALT_BYTES = 16;
const PASSWORD_SCHEME = "scrypt";

function normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
}

function normalizeCode(code: string): string {
    return code.trim();
}

export function hashPassword(password: string): string {
    const salt = randomBytes(PASSWORD_SALT_BYTES).toString("hex");
    const digest = scryptSync(password, salt, PASSWORD_KEYLEN).toString("hex");
    return `${PASSWORD_SCHEME}$${salt}$${digest}`;
}

export function verifyPassword(password: string, passwordHash: string): boolean {
    try {
        const [scheme, salt, digest] = passwordHash.split("$");
        if (scheme !== PASSWORD_SCHEME || !salt || !digest) {
            return false;
        }
        const expected = Buffer.from(digest, "hex");
        const actual = scryptSync(password, salt, expected.length);
        return timingSafeEqual(actual, expected);
    } catch {
        return false;
    }
}

export function generateVerificationCode(): string {
    return String(randomInt(100000, 1000000));
}

export function hashVerificationCode(input: {
    email: string;
    purpose: AuthCodePurpose;
    code: string;
}): string {
    const secret = process.env.AUTH_CODE_SECRET || process.env.NEXTAUTH_SECRET || "dev-code-secret";
    const payload = [
        secret,
        normalizeEmail(input.email),
        input.purpose,
        normalizeCode(input.code)
    ].join(":");
    return createHash("sha256").update(payload).digest("hex");
}

export function sanitizeEmail(email: string): string {
    return normalizeEmail(email);
}

export function isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export function isValidPassword(password: string): boolean {
    return password.length >= 8;
}
