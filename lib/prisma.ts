import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
    globalForPrisma.prisma ??
    new PrismaClient({
        log: ["error", "warn"]
    });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

const TRANSIENT_PRISMA_ERROR_PATTERNS = [
    /error in postgresql connection: error\s*\{\s*kind:\s*closed/i,
    /can't reach database server/i,
    /connection terminated unexpectedly/i,
    /server closed the connection unexpectedly/i,
    /connection reset by peer/i,
    /timed out fetching a new connection/i,
    /read econnreset/i,
    /socket hang up/i
];

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
}

function getErrorCode(error: unknown): string {
    if (!error || typeof error !== "object") return "";
    if (!("code" in error)) return "";
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : "";
}

function isTransientPrismaConnectionError(error: unknown): boolean {
    const code = getErrorCode(error);
    if (code === "P1001" || code === "P1017" || code === "P2024") {
        return true;
    }

    const message = getErrorMessage(error);
    return TRANSIENT_PRISMA_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

type PrismaRetryOptions = {
    retries?: number;
    delayMs?: number;
};

export async function withPrismaRetry<T>(
    operation: () => Promise<T>,
    options: PrismaRetryOptions = {}
): Promise<T> {
    const retries = Math.max(0, options.retries ?? 1);
    const baseDelayMs = Math.max(0, options.delayMs ?? 120);

    let attempt = 0;
    while (true) {
        try {
            return await operation();
        } catch (error) {
            if (!isTransientPrismaConnectionError(error) || attempt >= retries) {
                throw error;
            }

            const delayMs = baseDelayMs * (attempt + 1);
            const message = getErrorMessage(error);
            console.warn(
                `[prisma] transient connection error, retrying (${attempt + 1}/${retries}) in ${delayMs}ms: ${message}`
            );
            await sleep(delayMs);
            attempt += 1;
        }
    }
}
