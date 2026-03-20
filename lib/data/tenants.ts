import { adminDb } from "@/lib/firebase-admin";
import { toDateOrNull } from "./firestore-utils";
import { recordAuditEvent } from "./audit-events";
import { syncOrgTenantCount } from "./orgs";
import type { Tenant } from "@/types";

function tenantsCollection() {
    return adminDb.collection("tenants");
}

function workspacesCollection() {
    return adminDb.collection("workspaces");
}

function normalizeTenantId(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed || null;
}

function normalizeTenantSlug(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const sanitized = value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-_]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
    return sanitized || null;
}

function normalizeTenantName(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed || null;
}

function normalizeOrgId(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed || null;
}

function normalizeStatus(value: unknown): Tenant["status"] {
    if (value === "trial" || value === "suspended") return value;
    return "active";
}

function buildFallbackTenantSlug(tenantId: string) {
    return normalizeTenantSlug(tenantId) || tenantId.toLowerCase().replace(/[^a-z0-9]+/g, "-") || tenantId;
}

function sanitizeLocalPart(email: string) {
    const local = email.split("@")[0] || "";
    return local.trim();
}

function mapTenant(id: string, data: Record<string, unknown>): Tenant {
    return {
        id,
        orgId: normalizeOrgId(data.orgId),
        name: normalizeTenantName(data.name) || id,
        slug: normalizeTenantSlug(data.slug) || buildFallbackTenantSlug(id),
        status: normalizeStatus(data.status),
        workspaceCount: typeof data.workspaceCount === "number" ? data.workspaceCount : 0,
        createdAt: toDateOrNull(data.createdAt)?.getTime() || Date.now(),
        updatedAt: toDateOrNull(data.updatedAt)?.getTime() || Date.now()
    };
}

export function buildPersonalTenantId(userId: string) {
    const normalizedUserId = userId.trim();
    const safeUserId = normalizedUserId.replace(/[^A-Za-z0-9_-]/g, "_") || "unknown";
    return `tenant_${safeUserId}`;
}

export async function getTenantById(tenantId: string): Promise<Tenant | null> {
    const normalizedTenantId = normalizeTenantId(tenantId);
    if (!normalizedTenantId) return null;

    const snap = await tenantsCollection().doc(normalizedTenantId).get();
    if (!snap.exists) return null;
    return mapTenant(snap.id, snap.data() || {});
}

export async function ensureTenantRecord(input: {
    tenantId: string;
    orgId?: string | null;
    name?: string | null;
    slug?: string | null;
    status?: Tenant["status"];
}): Promise<Tenant | null> {
    const tenantId = normalizeTenantId(input.tenantId);
    if (!tenantId) return null;

    const now = Date.now();
    const ref = tenantsCollection().doc(tenantId);
    const existing = await ref.get();
    const existingData = existing.exists ? (existing.data() as Record<string, unknown>) : {};

    await ref.set({
        orgId: normalizeOrgId(input.orgId) ?? normalizeOrgId(existingData.orgId) ?? null,
        name: normalizeTenantName(input.name) || normalizeTenantName(existingData.name) || tenantId,
        slug:
            normalizeTenantSlug(input.slug) ||
            normalizeTenantSlug(existingData.slug) ||
            buildFallbackTenantSlug(tenantId),
        status: normalizeStatus(input.status ?? existingData.status),
        workspaceCount:
            typeof existingData.workspaceCount === "number" ? existingData.workspaceCount : 0,
        createdAt: existingData.createdAt ?? new Date(now),
        updatedAt: new Date(now)
    }, { merge: true });

    const merged = await ref.get();
    return mapTenant(tenantId, merged.data() || {});
}

export async function ensurePersonalTenantForUser(input: {
    userId: string;
    email?: string | null;
    name?: string | null;
}): Promise<Tenant | null> {
    const userId = input.userId.trim();
    if (!userId) return null;

    const tenantId = buildPersonalTenantId(userId);
    const localPart = input.email ? sanitizeLocalPart(input.email) : "";
    const nameFromEmail = localPart ? `${localPart} Workspace` : null;
    const tenantName = normalizeTenantName(input.name) || nameFromEmail || `User ${userId.slice(0, 6)} Workspace`;

    return ensureTenantRecord({
        tenantId,
        name: tenantName,
        slug: buildFallbackTenantSlug(localPart || userId),
        status: "active"
    });
}

export async function resolveTenantForUser(input: {
    userId: string;
    email?: string | null;
    tenantId?: string | null;
}): Promise<Tenant | null> {
    const explicitTenantId = normalizeTenantId(input.tenantId);
    if (explicitTenantId) {
        const existing = await getTenantById(explicitTenantId);
        if (existing) return existing;

        return ensureTenantRecord({
            tenantId: explicitTenantId,
            name: explicitTenantId,
            slug: explicitTenantId,
            status: "active"
        });
    }

    return ensurePersonalTenantForUser({
        userId: input.userId,
        email: input.email ?? null
    });
}

export async function syncTenantWorkspaceCount(tenantId: string): Promise<Tenant | null> {
    const normalizedTenantId = normalizeTenantId(tenantId);
    if (!normalizedTenantId) return null;

    const tenant = await getTenantById(normalizedTenantId);
    if (!tenant) return null;

    const workspacesSnap = await workspacesCollection()
        .where("tenantId", "==", normalizedTenantId)
        .limit(500)
        .get();
    const workspaceCount = workspacesSnap.size;
    const nextUpdatedAt = Date.now();

    await tenantsCollection().doc(normalizedTenantId).set({
        workspaceCount,
        updatedAt: new Date(nextUpdatedAt)
    }, { merge: true });

    return {
        ...tenant,
        workspaceCount,
        updatedAt: nextUpdatedAt
    };
}

export async function listTenants(limit = 30): Promise<Tenant[]> {
    const snap = await tenantsCollection().limit(limit).get();
    return snap.docs
        .map((doc) => mapTenant(doc.id, doc.data() || {}))
        .sort((left, right) => right.updatedAt - left.updatedAt);
}

export async function updateTenantOrgBinding(input: {
    tenantId: string;
    orgId?: string | null;
    reason?: string | null;
    actorId?: string | null;
    actorEmail?: string | null;
}): Promise<{
    tenant: Tenant;
    previousOrgId: string | null;
    nextOrgId: string | null;
    changed: boolean;
}> {
    const tenantId = input.tenantId.trim();
    if (!tenantId) {
        throw new Error("Tenant id is required.");
    }
    const normalizedOrgId = normalizeOrgId(input.orgId);
    const ref = tenantsCollection().doc(tenantId);
    const snap = await ref.get();
    if (!snap.exists) {
        throw new Error("Tenant not found.");
    }

    const current = mapTenant(snap.id, snap.data() || {});
    const previousOrgId = current.orgId ?? null;
    const changed = previousOrgId !== normalizedOrgId;

    if (changed) {
        await ref.set({
            orgId: normalizedOrgId ?? null,
            updatedAt: new Date()
        }, { merge: true });
    }

    if (previousOrgId && previousOrgId !== normalizedOrgId) {
        await syncOrgTenantCount(previousOrgId);
    }
    if (normalizedOrgId) {
        await syncOrgTenantCount(normalizedOrgId);
    }

    if (changed) {
        await recordAuditEvent({
            eventType: "tenant.org_rebound",
            severity: "warning",
            actorId: input.actorId ?? null,
            actorEmail: input.actorEmail ?? null,
            resourceType: "tenant",
            resourceId: tenantId,
            summary: `Tenant ${tenantId} organization binding moved to ${normalizedOrgId || "unassigned"}.`,
            metadata: {
                tenantId,
                previousOrgId: previousOrgId || "",
                nextOrgId: normalizedOrgId || "",
                reason: input.reason || ""
            }
        });
    }

    return {
        tenant: {
            ...current,
            orgId: normalizedOrgId,
            updatedAt: Date.now()
        },
        previousOrgId,
        nextOrgId: normalizedOrgId,
        changed
    };
}

export async function updateTenantStatus(input: {
    tenantId: string;
    status: Tenant["status"];
    reason?: string | null;
    actorId?: string | null;
    actorEmail?: string | null;
}): Promise<Tenant | null> {
    const tenantId = input.tenantId.trim();
    if (!tenantId) return null;

    const ref = tenantsCollection().doc(tenantId);
    const snap = await ref.get();
    if (!snap.exists) return null;

    const current = mapTenant(snap.id, snap.data() || {});
    const nextStatus = input.status;
    const updatedAt = Date.now();

    await ref.set({
        status: nextStatus,
        updatedAt: new Date(updatedAt)
    }, { merge: true });

    const updated = {
        ...current,
        status: nextStatus,
        updatedAt
    };

    await recordAuditEvent({
        eventType: "tenant.status_updated",
        severity: nextStatus === "suspended" ? "warning" : "info",
        actorId: input.actorId ?? null,
        actorEmail: input.actorEmail ?? null,
        resourceType: "tenant",
        resourceId: tenantId,
        summary: `Tenant ${tenantId} status changed to ${nextStatus}.`,
        metadata: {
            tenantId,
            previousStatus: current.status,
            nextStatus,
            reason: input.reason || ""
        }
    });

    return updated;
}
