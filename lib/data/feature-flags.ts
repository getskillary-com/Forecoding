import { adminDb } from "@/lib/firebase-admin";
import { toDateOrNull } from "./firestore-utils";
import { recordAuditEvent } from "./audit-events";
import type { FeatureFlag } from "@/types";

function featureFlagsCollection() {
    return adminDb.collection("featureFlags");
}

function mapFeatureFlag(id: string, data: Record<string, unknown>): FeatureFlag {
    return {
        key: id,
        description: typeof data.description === "string" ? data.description : "",
        enabled: data.enabled === true,
        scope:
            data.scope === "tenant" || data.scope === "workspace"
                ? data.scope
                : "global",
        value:
            typeof data.value === "string" ||
            typeof data.value === "number" ||
            typeof data.value === "boolean"
                ? data.value
                : null,
        updatedAt: toDateOrNull(data.updatedAt)?.getTime() || Date.now(),
        updatedBy: typeof data.updatedBy === "string" ? data.updatedBy : null
    };
}

export async function listFeatureFlags(limit = 50): Promise<FeatureFlag[]> {
    const snap = await featureFlagsCollection().limit(limit).get();
    return snap.docs
        .map((doc) => mapFeatureFlag(doc.id, doc.data() || {}))
        .sort((left, right) => right.updatedAt - left.updatedAt);
}

export async function getFeatureFlagByKey(key: string): Promise<FeatureFlag | null> {
    const normalizedKey = key.trim();
    if (!normalizedKey) return null;

    const snap = await featureFlagsCollection().doc(normalizedKey).get();
    if (!snap.exists) return null;
    return mapFeatureFlag(snap.id, snap.data() || {});
}

export async function isFeatureFlagEnabled(key: string, fallback = false): Promise<boolean> {
    const flag = await getFeatureFlagByKey(key);
    if (!flag) return fallback;
    return flag.enabled;
}

export async function upsertFeatureFlag(flag: FeatureFlag) {
    await featureFlagsCollection().doc(flag.key).set({
        description: flag.description,
        enabled: flag.enabled,
        scope: flag.scope,
        value: flag.value ?? null,
        updatedAt: new Date(flag.updatedAt),
        updatedBy: flag.updatedBy ?? null
    }, { merge: true });

    await recordAuditEvent({
        eventType: flag.enabled ? "feature_flag.enabled" : "feature_flag.disabled",
        severity: "info",
        actorEmail: flag.updatedBy ?? null,
        resourceType: "featureFlag",
        resourceId: flag.key,
        summary: `Feature flag ${flag.key} was ${flag.enabled ? "enabled" : "disabled"}.`,
        metadata: {
            scope: flag.scope,
            value: flag.value === null || flag.value === undefined ? "" : String(flag.value)
        }
    });

    return flag;
}
