import { adminDb } from "@/lib/firebase-admin";
import { toDateOrNull } from "./firestore-utils";
import { recordAuditEvent } from "./audit-events";
import type { FeatureFlag } from "@/types";

type FeatureFlagContext = {
    tenantId?: string | null;
    workspaceId?: string | null;
};

function featureFlagsCollection() {
    return adminDb.collection("featureFlags");
}

function normalizeKey(value: unknown) {
    if (typeof value !== "string") return "";
    return value.trim();
}

function normalizeScope(value: unknown): FeatureFlag["scope"] {
    if (value === "tenant" || value === "workspace") return value;
    return "global";
}

function normalizeScopeId(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed || null;
}

function sanitizeDocIdPart(value: string) {
    return value.replace(/\//g, "_").trim();
}

function buildDocId(input: {
    key: string;
    scope: FeatureFlag["scope"];
    scopeId?: string | null;
}) {
    const normalizedKey = sanitizeDocIdPart(input.key.trim());
    if (input.scope === "global") return normalizedKey;

    const normalizedScopeId = sanitizeDocIdPart((input.scopeId || "").trim());
    if (!normalizedScopeId) {
        throw new Error(`Scope id is required for ${input.scope} feature flags.`);
    }

    return `${normalizedKey}::${input.scope}::${normalizedScopeId}`;
}

function parseDocId(id: string): {
    key: string;
    scope: FeatureFlag["scope"];
    scopeId: string | null;
} {
    const [rawKey, rawScope, ...rawScopeIdParts] = id.split("::");
    if (rawScope === "tenant" || rawScope === "workspace") {
        return {
            key: rawKey || id,
            scope: rawScope,
            scopeId: rawScopeIdParts.join("::").trim() || null
        };
    }

    return {
        key: rawKey || id,
        scope: "global",
        scopeId: null
    };
}

function mapFeatureFlag(id: string, data: Record<string, unknown>): FeatureFlag {
    const parsedId = parseDocId(id);
    const scope = normalizeScope(data.scope ?? parsedId.scope);
    const normalizedScopeId = scope === "global"
        ? null
        : normalizeScopeId(data.scopeId) ?? parsedId.scopeId ?? null;

    return {
        key: normalizeKey(data.key) || parsedId.key || id,
        description: typeof data.description === "string" ? data.description : "",
        enabled: data.enabled === true,
        scope,
        scopeId: normalizedScopeId,
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

function buildFlagRank(flag: FeatureFlag, context: FeatureFlagContext) {
    const tenantId = normalizeScopeId(context.tenantId);
    const workspaceId = normalizeScopeId(context.workspaceId);

    if (flag.scope === "workspace") {
        if (!workspaceId || !flag.scopeId) return 0;
        return flag.scopeId === workspaceId ? 3 : 0;
    }
    if (flag.scope === "tenant") {
        if (!tenantId || !flag.scopeId) return 0;
        return flag.scopeId === tenantId ? 2 : 0;
    }
    return 1;
}

function selectBestFlag(flags: FeatureFlag[], context: FeatureFlagContext) {
    return flags
        .map((flag) => ({
            flag,
            rank: buildFlagRank(flag, context)
        }))
        .filter((item) => item.rank > 0)
        .sort((left, right) => {
            if (left.rank !== right.rank) return right.rank - left.rank;
            return right.flag.updatedAt - left.flag.updatedAt;
        })[0]?.flag || null;
}

export function buildFeatureFlagIdentity(flag: Pick<FeatureFlag, "key" | "scope" | "scopeId">) {
    return `${flag.key}::${flag.scope}::${flag.scopeId || "global"}`;
}

export async function listFeatureFlags(limit = 50): Promise<FeatureFlag[]> {
    const snap = await featureFlagsCollection()
        .orderBy("updatedAt", "desc")
        .limit(limit)
        .get();
    return snap.docs
        .map((doc) => mapFeatureFlag(doc.id, doc.data() || {}))
        .sort((left, right) => right.updatedAt - left.updatedAt);
}

export async function getFeatureFlagByKey(key: string): Promise<FeatureFlag | null> {
    return getFeatureFlagForContext({
        key,
        workspaceId: null,
        tenantId: null
    });
}

export async function getFeatureFlagForContext(input: {
    key: string;
    tenantId?: string | null;
    workspaceId?: string | null;
}): Promise<FeatureFlag | null> {
    const normalizedKey = normalizeKey(input.key);
    if (!normalizedKey) return null;

    const tenantId = normalizeScopeId(input.tenantId);
    const workspaceId = normalizeScopeId(input.workspaceId);

    const candidateDocIds = [
        workspaceId
            ? buildDocId({
                key: normalizedKey,
                scope: "workspace",
                scopeId: workspaceId
            })
            : null,
        tenantId
            ? buildDocId({
                key: normalizedKey,
                scope: "tenant",
                scopeId: tenantId
            })
            : null,
        buildDocId({
            key: normalizedKey,
            scope: "global"
        })
    ].filter((value): value is string => Boolean(value));

    for (const docId of candidateDocIds) {
        const snap = await featureFlagsCollection().doc(docId).get();
        if (!snap.exists) continue;
        const candidate = mapFeatureFlag(snap.id, snap.data() || {});
        if (buildFlagRank(candidate, { tenantId, workspaceId }) > 0) {
            return candidate;
        }
    }

    const scopedQuery = await featureFlagsCollection()
        .where("key", "==", normalizedKey)
        .limit(20)
        .get();
    const scopedCandidates = scopedQuery.docs.map((doc) => mapFeatureFlag(doc.id, doc.data() || {}));
    return selectBestFlag(scopedCandidates, { tenantId, workspaceId });
}

export async function isFeatureFlagEnabled(key: string, fallback = false): Promise<boolean> {
    const flag = await getFeatureFlagByKey(key);
    if (!flag) return fallback;
    return flag.enabled;
}

export async function isFeatureFlagEnabledForContext(input: {
    key: string;
    fallback?: boolean;
    tenantId?: string | null;
    workspaceId?: string | null;
}): Promise<boolean> {
    const fallback = input.fallback ?? false;
    const flag = await getFeatureFlagForContext({
        key: input.key,
        tenantId: input.tenantId,
        workspaceId: input.workspaceId
    });
    if (!flag) return fallback;
    return flag.enabled;
}

export async function upsertFeatureFlag(flag: FeatureFlag) {
    const normalizedKey = normalizeKey(flag.key);
    if (!normalizedKey) {
        throw new Error("Feature flag key is required.");
    }

    const scope = normalizeScope(flag.scope);
    const normalizedScopeId = scope === "global" ? null : normalizeScopeId(flag.scopeId);
    const docId = buildDocId({
        key: normalizedKey,
        scope,
        scopeId: normalizedScopeId
    });

    await featureFlagsCollection().doc(docId).set({
        key: normalizedKey,
        description: flag.description,
        enabled: flag.enabled,
        scope,
        scopeId: normalizedScopeId,
        value: flag.value ?? null,
        updatedAt: new Date(flag.updatedAt),
        updatedBy: flag.updatedBy ?? null
    }, { merge: true });

    await recordAuditEvent({
        eventType: flag.enabled ? "feature_flag.enabled" : "feature_flag.disabled",
        severity: "info",
        actorEmail: flag.updatedBy ?? null,
        resourceType: "featureFlag",
        resourceId: docId,
        summary: `Feature flag ${normalizedKey} was ${flag.enabled ? "enabled" : "disabled"}.`,
        metadata: {
            key: normalizedKey,
            scope,
            scopeId: normalizedScopeId || "",
            value: flag.value === null || flag.value === undefined ? "" : String(flag.value)
        }
    });

    return {
        ...flag,
        key: normalizedKey,
        scope,
        scopeId: normalizedScopeId
    } satisfies FeatureFlag;
}
