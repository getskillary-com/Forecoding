import { toDateOrNull } from "./firestore-utils";
import { recordAuditEvent } from "./audit-events";
import { adminDb } from "@/lib/firebase-admin";
import type { Org } from "@/types";

function orgsCollection() {
    return adminDb.collection("orgs");
}

function tenantsCollection() {
    return adminDb.collection("tenants");
}

function normalizeOrgId(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed || null;
}

function normalizeOrgSlug(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const sanitized = value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-_]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
    return sanitized || null;
}

function normalizeOrgName(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed || null;
}

function normalizeOrgStatus(value: unknown): Org["status"] {
    if (value === "suspended") return "suspended";
    return "active";
}

function buildFallbackOrgSlug(orgId: string) {
    return normalizeOrgSlug(orgId) || orgId.toLowerCase().replace(/[^a-z0-9]+/g, "-") || orgId;
}

function mapOrg(id: string, data: Record<string, unknown>): Org {
    return {
        id,
        name: normalizeOrgName(data.name) || id,
        slug: normalizeOrgSlug(data.slug) || buildFallbackOrgSlug(id),
        status: normalizeOrgStatus(data.status),
        tenantCount: typeof data.tenantCount === "number" ? data.tenantCount : 0,
        createdAt: toDateOrNull(data.createdAt)?.getTime() || Date.now(),
        updatedAt: toDateOrNull(data.updatedAt)?.getTime() || Date.now()
    };
}

export async function getOrgById(orgId: string): Promise<Org | null> {
    const normalizedOrgId = normalizeOrgId(orgId);
    if (!normalizedOrgId) return null;

    const snap = await orgsCollection().doc(normalizedOrgId).get();
    if (!snap.exists) return null;
    return mapOrg(snap.id, snap.data() || {});
}

export async function ensureOrgRecord(input: {
    orgId: string;
    name?: string | null;
    slug?: string | null;
    status?: Org["status"];
}): Promise<Org | null> {
    const orgId = normalizeOrgId(input.orgId);
    if (!orgId) return null;

    const now = Date.now();
    const ref = orgsCollection().doc(orgId);
    const existing = await ref.get();
    const existingData = existing.exists ? (existing.data() as Record<string, unknown>) : {};

    await ref.set({
        name: normalizeOrgName(input.name) || normalizeOrgName(existingData.name) || orgId,
        slug:
            normalizeOrgSlug(input.slug) ||
            normalizeOrgSlug(existingData.slug) ||
            buildFallbackOrgSlug(orgId),
        status: normalizeOrgStatus(input.status ?? existingData.status),
        tenantCount: typeof existingData.tenantCount === "number" ? existingData.tenantCount : 0,
        createdAt: existingData.createdAt ?? new Date(now),
        updatedAt: new Date(now)
    }, { merge: true });

    const merged = await ref.get();
    return mapOrg(orgId, merged.data() || {});
}

export async function syncOrgTenantCount(orgId: string): Promise<Org | null> {
    const normalizedOrgId = normalizeOrgId(orgId);
    if (!normalizedOrgId) return null;

    const org = await getOrgById(normalizedOrgId);
    if (!org) return null;

    const tenantsSnap = await tenantsCollection()
        .where("orgId", "==", normalizedOrgId)
        .limit(500)
        .get();
    const tenantCount = tenantsSnap.size;
    const updatedAt = Date.now();

    await orgsCollection().doc(normalizedOrgId).set({
        tenantCount,
        updatedAt: new Date(updatedAt)
    }, { merge: true });

    return {
        ...org,
        tenantCount,
        updatedAt
    };
}

export async function listOrgs(limit = 30): Promise<Org[]> {
    const snap = await orgsCollection().limit(limit).get();
    return snap.docs
        .map((doc) => mapOrg(doc.id, doc.data() || {}))
        .sort((left, right) => right.updatedAt - left.updatedAt);
}

export async function updateOrgStatus(input: {
    orgId: string;
    status: Org["status"];
    reason?: string | null;
    actorId?: string | null;
    actorEmail?: string | null;
}): Promise<Org | null> {
    const orgId = normalizeOrgId(input.orgId);
    if (!orgId) return null;

    const ref = orgsCollection().doc(orgId);
    const snap = await ref.get();
    if (!snap.exists) return null;

    const current = mapOrg(snap.id, snap.data() || {});
    const nextStatus = input.status;
    const updatedAt = Date.now();

    await ref.set({
        status: nextStatus,
        updatedAt: new Date(updatedAt)
    }, { merge: true });

    const updated: Org = {
        ...current,
        status: nextStatus,
        updatedAt
    };

    await recordAuditEvent({
        eventType: "org.status_updated",
        severity: nextStatus === "suspended" ? "warning" : "info",
        actorId: input.actorId ?? null,
        actorEmail: input.actorEmail ?? null,
        resourceType: "org",
        resourceId: orgId,
        summary: `Organization ${orgId} status changed to ${nextStatus}.`,
        metadata: {
            orgId,
            previousStatus: current.status,
            nextStatus,
            reason: input.reason || ""
        }
    });

    return updated;
}
