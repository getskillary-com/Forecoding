import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { normalizeEmail, toDateOrNull } from "./firestore-utils";

export type UserProfile = {
    uid: string;
    email: string;
    emailLower: string;
    name: string | null;
    image: string | null;
    emailVerified: Date | null;
    legacyPasswordResetRequired: boolean;
    sessionVersion: number;
    createdAt: Date | null;
    updatedAt: Date | null;
};

type UpsertUserInput = {
    uid: string;
    email: string;
    name?: string | null;
    image?: string | null;
    emailVerified?: Date | null;
    legacyPasswordResetRequired?: boolean;
    sessionVersion?: number;
};

function usersCollection() {
    return adminDb.collection("users");
}

function mapUser(uid: string, data: Record<string, unknown>): UserProfile {
    const email = typeof data.email === "string" ? data.email : "";
    const sessionVersion = typeof data.sessionVersion === "number" ? data.sessionVersion : 0;
    return {
        uid,
        email,
        emailLower: typeof data.emailLower === "string" ? data.emailLower : normalizeEmail(email),
        name: typeof data.name === "string" ? data.name : null,
        image: typeof data.image === "string" ? data.image : null,
        emailVerified: toDateOrNull(data.emailVerified),
        legacyPasswordResetRequired: data.legacyPasswordResetRequired === true,
        sessionVersion,
        createdAt: toDateOrNull(data.createdAt),
        updatedAt: toDateOrNull(data.updatedAt)
    };
}

export async function getUserProfileByUid(uid: string): Promise<UserProfile | null> {
    const snap = await usersCollection().doc(uid).get();
    if (!snap.exists) return null;
    return mapUser(uid, snap.data() || {});
}

export async function getUserProfileByEmail(email: string): Promise<UserProfile | null> {
    const emailLower = normalizeEmail(email);
    if (!emailLower) return null;

    const query = await usersCollection()
        .where("emailLower", "==", emailLower)
        .limit(1)
        .get();

    if (query.empty) return null;
    const doc = query.docs[0];
    return mapUser(doc.id, doc.data() || {});
}

export async function upsertUserProfile(input: UpsertUserInput): Promise<UserProfile> {
    const now = new Date();
    const docRef = usersCollection().doc(input.uid);
    const existing = await docRef.get();
    const existingData = existing.exists ? (existing.data() as Record<string, unknown>) : {};

    const nextEmail = (input.email || "").trim();
    const payload: Record<string, unknown> = {
        email: nextEmail,
        emailLower: normalizeEmail(nextEmail),
        name: input.name ?? existingData.name ?? null,
        image: input.image ?? existingData.image ?? null,
        emailVerified: input.emailVerified ?? existingData.emailVerified ?? null,
        legacyPasswordResetRequired:
            input.legacyPasswordResetRequired ?? (existingData.legacyPasswordResetRequired === true),
        sessionVersion:
            typeof input.sessionVersion === "number"
                ? input.sessionVersion
                : typeof existingData.sessionVersion === "number"
                ? existingData.sessionVersion
                : 0,
        updatedAt: now
    };

    if (!existing.exists) {
        payload.createdAt = now;
    } else if (!existingData.createdAt) {
        payload.createdAt = now;
    }

    await docRef.set(payload, { merge: true });
    const merged = await docRef.get();
    return mapUser(input.uid, merged.data() || payload);
}

export async function bumpUserSessionVersion(uid: string): Promise<number> {
    const ref = usersCollection().doc(uid);
    await ref.set(
        {
            sessionVersion: FieldValue.increment(1),
            updatedAt: new Date()
        },
        { merge: true }
    );
    const snap = await ref.get();
    const data = snap.data() || {};
    return typeof data.sessionVersion === "number" ? data.sessionVersion : 0;
}

