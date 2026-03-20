import { adminDb } from "@/lib/firebase-admin";
import { toDateOrNull } from "./firestore-utils";
import type { AuditEvent } from "@/types";

type AuditEventInput = Omit<AuditEvent, "id" | "createdAt"> & {
    id?: string;
    createdAt?: number;
};

function auditEventsCollection() {
    return adminDb.collection("auditEvents");
}

function randomId() {
    return `audit_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function mapAuditEvent(id: string, data: Record<string, unknown>): AuditEvent {
    return {
        id,
        eventType: typeof data.eventType === "string" ? data.eventType : "unknown",
        severity:
            data.severity === "warning" || data.severity === "critical"
                ? data.severity
                : "info",
        actorId: typeof data.actorId === "string" ? data.actorId : null,
        actorEmail: typeof data.actorEmail === "string" ? data.actorEmail : null,
        resourceType: typeof data.resourceType === "string" ? data.resourceType : "unknown",
        resourceId: typeof data.resourceId === "string" ? data.resourceId : "unknown",
        summary: typeof data.summary === "string" ? data.summary : "Audit event",
        metadata: typeof data.metadata === "object" && data.metadata
            ? Object.fromEntries(
                Object.entries(data.metadata as Record<string, unknown>)
                    .filter(([, value]) => ["string", "number", "boolean"].includes(typeof value))
                    .map(([key, value]) => [key, String(value)])
            )
            : undefined,
        createdAt: toDateOrNull(data.createdAt)?.getTime() || Date.now()
    };
}

export async function recordAuditEvent(input: AuditEventInput): Promise<AuditEvent> {
    const id = input.id || randomId();
    const createdAt = input.createdAt ?? Date.now();
    await auditEventsCollection().doc(id).set({
        eventType: input.eventType,
        severity: input.severity,
        actorId: input.actorId ?? null,
        actorEmail: input.actorEmail ?? null,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        summary: input.summary,
        metadata: input.metadata ?? {},
        createdAt: new Date(createdAt)
    });

    return {
        id,
        eventType: input.eventType,
        severity: input.severity,
        actorId: input.actorId ?? null,
        actorEmail: input.actorEmail ?? null,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        summary: input.summary,
        metadata: input.metadata,
        createdAt
    };
}

export async function listAuditEvents(limit = 30): Promise<AuditEvent[]> {
    const snap = await auditEventsCollection()
        .orderBy("createdAt", "desc")
        .limit(limit)
        .get();

    return snap.docs.map((doc) => mapAuditEvent(doc.id, doc.data() || {}));
}

export async function searchAuditEvents(input?: {
    limit?: number;
    severity?: AuditEvent["severity"] | "";
    resourceType?: string;
    eventType?: string;
    query?: string;
}): Promise<AuditEvent[]> {
    const severity = input?.severity || "";
    const resourceType = (input?.resourceType || "").trim().toLowerCase();
    const eventType = (input?.eventType || "").trim().toLowerCase();
    const query = (input?.query || "").trim().toLowerCase();
    const limit = Math.max(1, Math.min(100, input?.limit ?? 40));

    const snap = await auditEventsCollection()
        .orderBy("createdAt", "desc")
        .limit(Math.max(limit, 80))
        .get();

    return snap.docs
        .map((doc) => mapAuditEvent(doc.id, doc.data() || {}))
        .filter((event) => {
            if (severity && event.severity !== severity) return false;
            if (resourceType && event.resourceType.toLowerCase() !== resourceType) return false;
            if (eventType && event.eventType.toLowerCase() !== eventType) return false;
            if (query) {
                const haystack = [
                    event.eventType,
                    event.resourceType,
                    event.resourceId,
                    event.summary,
                    event.actorEmail || "",
                    JSON.stringify(event.metadata || {})
                ].join(" ").toLowerCase();
                if (!haystack.includes(query)) return false;
            }
            return true;
        })
        .slice(0, limit);
}

export async function listGovernanceOperationEvents(limit = 12): Promise<AuditEvent[]> {
    const interestingEventTypes = new Set([
        "workspace.release_tag_created",
        "workspace.release_approved",
        "workspace.release_rejected",
        "workspace.release_rolled_back",
        "stripe.webhook_replayed",
        "stripe.webhook_replay_failed",
        "generation.job_failed",
        "generation.job_succeeded",
        "tenant.status_updated",
        "tenant.user_reassigned",
        "workspace.tenant_rebound"
    ]);

    const snap = await auditEventsCollection()
        .orderBy("createdAt", "desc")
        .limit(Math.max(limit, 80))
        .get();

    return snap.docs
        .map((doc) => mapAuditEvent(doc.id, doc.data() || {}))
        .filter((event) => interestingEventTypes.has(event.eventType))
        .slice(0, limit);
}
