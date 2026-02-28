import { FieldValue } from "firebase-admin/firestore";
import { AuthCodePurpose } from "@/lib/auth-types";
import { adminDb } from "@/lib/firebase-admin";
import { normalizeEmail, toDateOrNull } from "./firestore-utils";

type AuthCodeRecord = {
    id: string;
    emailLower: string;
    purpose: AuthCodePurpose;
    codeHash: string;
    expiresAt: Date;
    usedAt: Date | null;
    attempts: number;
    createdAt: Date;
};

function authCodesCollection() {
    return adminDb.collection("authCodes");
}

function mapAuthCode(id: string, data: Record<string, unknown>): AuthCodeRecord | null {
    const purpose = data.purpose;
    if (
        purpose !== "REGISTER" &&
        purpose !== "LOGIN" &&
        purpose !== "RESET_PASSWORD" &&
        purpose !== "CHANGE_EMAIL"
    ) {
        return null;
    }

    const createdAt = toDateOrNull(data.createdAt);
    const expiresAt = toDateOrNull(data.expiresAt);
    if (!createdAt || !expiresAt) return null;

    return {
        id,
        emailLower: typeof data.emailLower === "string" ? data.emailLower : "",
        purpose,
        codeHash: typeof data.codeHash === "string" ? data.codeHash : "",
        expiresAt,
        usedAt: toDateOrNull(data.usedAt),
        attempts: typeof data.attempts === "number" ? data.attempts : 0,
        createdAt
    };
}

export async function findRecentAuthCode(input: {
    email: string;
    purpose: AuthCodePurpose;
    now: Date;
}): Promise<AuthCodeRecord | null> {
    const emailLower = normalizeEmail(input.email);
    const query = await authCodesCollection()
        .where("emailLower", "==", emailLower)
        .where("purpose", "==", input.purpose)
        .where("usedAt", "==", null)
        .orderBy("createdAt", "desc")
        .limit(10)
        .get();

    for (const doc of query.docs) {
        const mapped = mapAuthCode(doc.id, doc.data() || {});
        if (!mapped) continue;
        if (mapped.expiresAt <= input.now) continue;
        return mapped;
    }
    return null;
}

export async function createAuthCodeRecord(input: {
    email: string;
    purpose: AuthCodePurpose;
    codeHash: string;
    expiresAt: Date;
}) {
    const docRef = authCodesCollection().doc();
    const now = new Date();
    await docRef.set({
        emailLower: normalizeEmail(input.email),
        purpose: input.purpose,
        codeHash: input.codeHash,
        expiresAt: input.expiresAt,
        usedAt: null,
        attempts: 0,
        createdAt: now,
        updatedAt: now
    });
    return docRef.id;
}

export async function consumeAuthCodeRecord(input: {
    email: string;
    purpose: AuthCodePurpose;
    codeHash: string;
    maxAttempts: number;
    now: Date;
}): Promise<{ ok: true } | { ok: false; error: string }> {
    const emailLower = normalizeEmail(input.email);
    const query = await authCodesCollection()
        .where("emailLower", "==", emailLower)
        .where("purpose", "==", input.purpose)
        .where("usedAt", "==", null)
        .orderBy("createdAt", "desc")
        .limit(20)
        .get();

    const target = query.docs
        .map((doc) => ({ doc, mapped: mapAuthCode(doc.id, doc.data() || {}) }))
        .find((item) => item.mapped && item.mapped.expiresAt > input.now);

    if (!target || !target.mapped) {
        return { ok: false, error: "Verification code is invalid or expired." };
    }

    if (target.mapped.attempts >= input.maxAttempts) {
        return { ok: false, error: "Too many attempts. Request a new verification code." };
    }

    const ref = target.doc.ref;
    if (target.mapped.codeHash !== input.codeHash) {
        await ref.set(
            {
                attempts: FieldValue.increment(1),
                updatedAt: input.now
            },
            { merge: true }
        );
        return { ok: false, error: "Verification code is incorrect." };
    }

    await ref.set(
        {
            usedAt: input.now,
            updatedAt: input.now
        },
        { merge: true }
    );

    return { ok: true };
}

