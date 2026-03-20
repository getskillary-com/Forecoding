import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { recordAuditEvent } from "@/lib/data/audit-events";
import { normalizeEmail, toDateOrNull } from "./firestore-utils";

export type UserStatus = "active" | "suspended";

function normalizeUserStatus(value: unknown): UserStatus {
    return value === "suspended" ? "suspended" : "active";
}

function normalizeStatusReason(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed || null;
}

export type UserProfile = {
    uid: string;
    email: string;
    emailLower: string;
    tenantId: string | null;
    status: UserStatus;
    statusReason: string | null;
    name: string | null;
    image: string | null;
    emailVerified: Date | null;
    legacyPasswordResetRequired: boolean;
    sessionVersion: number;
    statusUpdatedAt: Date | null;
    createdAt: Date | null;
    updatedAt: Date | null;
};

type UpsertUserInput = {
    uid: string;
    email: string;
    tenantId?: string | null;
    status?: UserStatus;
    statusReason?: string | null;
    name?: string | null;
    image?: string | null;
    emailVerified?: Date | null;
    legacyPasswordResetRequired?: boolean;
    sessionVersion?: number;
};

function usersCollection() {
    return adminDb.collection("users");
}

function normalizeTenantId(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed || null;
}

function mapUser(uid: string, data: Record<string, unknown>): UserProfile {
    const email = typeof data.email === "string" ? data.email : "";
    const sessionVersion = typeof data.sessionVersion === "number" ? data.sessionVersion : 0;
    return {
        uid,
        email,
        emailLower: typeof data.emailLower === "string" ? data.emailLower : normalizeEmail(email),
        tenantId: normalizeTenantId(data.tenantId),
        status: normalizeUserStatus(data.status),
        statusReason: normalizeStatusReason(data.statusReason),
        name: typeof data.name === "string" ? data.name : null,
        image: typeof data.image === "string" ? data.image : null,
        emailVerified: toDateOrNull(data.emailVerified),
        legacyPasswordResetRequired: data.legacyPasswordResetRequired === true,
        sessionVersion,
        statusUpdatedAt: toDateOrNull(data.statusUpdatedAt),
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
        tenantId:
            input.tenantId !== undefined
                ? normalizeTenantId(input.tenantId)
                : normalizeTenantId(existingData.tenantId),
        status:
            input.status !== undefined
                ? normalizeUserStatus(input.status)
                : normalizeUserStatus(existingData.status),
        statusReason:
            input.statusReason !== undefined
                ? normalizeStatusReason(input.statusReason)
                : normalizeStatusReason(existingData.statusReason),
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
        statusUpdatedAt: input.status !== undefined
            ? now
            : (existingData.statusUpdatedAt || null),
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

export async function setUserTenantByUid(input: {
    uid: string;
    tenantId: string | null;
}): Promise<UserProfile | null> {
    const uid = input.uid.trim();
    if (!uid) return null;

    const ref = usersCollection().doc(uid);
    const snap = await ref.get();
    if (!snap.exists) return null;

    await ref.set({
        tenantId: normalizeTenantId(input.tenantId),
        updatedAt: new Date()
    }, { merge: true });

    const updated = await ref.get();
    return mapUser(uid, updated.data() || {});
}

export async function listUserProfiles(input?: {
    limit?: number;
    status?: UserStatus | "";
    tenantId?: string;
    query?: string;
}): Promise<UserProfile[]> {
    const status = normalizeUserStatus(input?.status);
    const statusFilterEnabled = input?.status === "active" || input?.status === "suspended";
    const tenantId = normalizeTenantId(input?.tenantId) || "";
    const query = (input?.query || "").trim().toLowerCase();
    const limit = Math.max(1, Math.min(100, input?.limit ?? 40));

    const snap = await usersCollection()
        .orderBy("updatedAt", "desc")
        .limit(Math.max(limit, 120))
        .get();

    return snap.docs
        .map((doc) => mapUser(doc.id, doc.data() || {}))
        .filter((user) => {
            if (statusFilterEnabled && user.status !== status) return false;
            if (tenantId && (user.tenantId || "") !== tenantId) return false;
            if (query) {
                const haystack = [
                    user.uid,
                    user.email,
                    user.emailLower,
                    user.tenantId || "",
                    user.status,
                    user.statusReason || "",
                    user.name || ""
                ].join(" ").toLowerCase();
                if (!haystack.includes(query)) return false;
            }
            return true;
        })
        .slice(0, limit);
}

export async function updateUserStatusByUid(input: {
    uid: string;
    status: UserStatus;
    reason?: string | null;
    actorId?: string | null;
    actorEmail?: string | null;
}): Promise<UserProfile | null> {
    const uid = input.uid.trim();
    if (!uid) return null;

    const ref = usersCollection().doc(uid);
    const snap = await ref.get();
    if (!snap.exists) return null;

    const current = mapUser(uid, snap.data() || {});
    const nextStatus = normalizeUserStatus(input.status);
    const nextReason = normalizeStatusReason(input.reason);
    const now = new Date();
    const shouldBumpSessionVersion = current.status !== nextStatus;

    await ref.set({
        status: nextStatus,
        statusReason: nextReason,
        statusUpdatedAt: now,
        updatedAt: now,
        sessionVersion: shouldBumpSessionVersion ? FieldValue.increment(1) : current.sessionVersion
    }, { merge: true });

    const updatedSnap = await ref.get();
    const updated = mapUser(uid, updatedSnap.data() || {});

    await recordAuditEvent({
        eventType: "user.status_updated",
        severity: nextStatus === "suspended" ? "warning" : "info",
        actorId: input.actorId ?? null,
        actorEmail: input.actorEmail ?? null,
        resourceType: "user",
        resourceId: uid,
        summary: `User ${uid} status changed to ${nextStatus}.`,
        metadata: {
            uid,
            email: updated.email,
            tenantId: updated.tenantId || "",
            previousStatus: current.status,
            status: nextStatus,
            reason: nextReason || "",
            sessionVersion: String(updated.sessionVersion)
        }
    });

    return updated;
}
