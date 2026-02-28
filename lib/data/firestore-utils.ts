import { Timestamp } from "firebase-admin/firestore";

export function toDateOrNull(value: unknown): Date | null {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (value instanceof Timestamp) return value.toDate();
    if (typeof value === "string" || typeof value === "number") {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
}

export function toIsoStringOrNull(value: unknown): string | null {
    const date = toDateOrNull(value);
    return date ? date.toISOString() : null;
}

export function normalizeEmail(email: string) {
    return (email || "").trim().toLowerCase();
}

