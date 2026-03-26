import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import {
    HttpsError,
    beforeUserCreated,
    beforeUserSignedIn
} from "firebase-functions/v2/identity";

// Revision marker to force a fresh deployment after enabling Identity Platform.
initializeApp();

const db = getFirestore();

type TenantAuthMode = "personal" | "enterprise";
type EnterpriseProviderType = "oidc" | "saml" | "google";
type BlockingStage = "create" | "sign_in";

type EnterpriseDomainBinding = {
    id: string;
    domain: string;
    tenantId: string | null;
    orgId: string | null;
    active: boolean;
    identityPlatformTenantId: string | null;
    providerType: EnterpriseProviderType | null;
    providerId: string | null;
    allowPersonalFallback?: boolean;
    allowPasswordLogin?: boolean;
    allowCodeLogin?: boolean;
    allowGoogleLogin?: boolean;
    allowRegistration?: boolean;
};

type EnterpriseTenantConfig = {
    id: string;
    orgId: string | null;
    slug: string | null;
    status: "active" | "trial" | "suspended" | null;
    authMode: TenantAuthMode | null;
    identityPlatformTenantId: string | null;
    enterpriseProviderType: EnterpriseProviderType | null;
    enterpriseProviderId: string | null;
    allowPersonalFallback?: boolean;
    allowPasswordLogin?: boolean;
    allowCodeLogin?: boolean;
    allowGoogleLogin?: boolean;
    allowRegistration?: boolean;
};

type EnterprisePolicy = {
    mode: TenantAuthMode;
    ready: boolean;
    tenantId: string | null;
    orgId: string | null;
    domain: string | null;
    identityPlatformTenantId: string | null;
    providerType: EnterpriseProviderType | null;
    providerId: string | null;
    allowPasswordLogin: boolean;
    allowCodeLogin: boolean;
    allowGoogleLogin: boolean;
    allowRegistration: boolean;
    message: string | null;
};

type BlockingEventLike = {
    data?: {
        email?: string | null;
        emailVerified?: boolean | null;
        customClaims?: Record<string, unknown> | null;
        tenantId?: string | null;
    } | null;
    credential?: {
        providerId?: string | null;
    } | null;
    additionalUserInfo?: {
        providerId?: string | null;
    } | null;
    eventType?: string | null;
    resource?: string | { name?: string | null } | null;
    tenantId?: string | null;
};

function normalizeOptionalString(value: unknown) {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed || null;
}

function normalizeOptionalBoolean(value: unknown) {
    return typeof value === "boolean" ? value : undefined;
}

function normalizeProviderType(value: unknown): EnterpriseProviderType | null {
    if (value === "oidc" || value === "saml" || value === "google") return value;
    return null;
}

function normalizeAuthMode(value: unknown): TenantAuthMode | null {
    if (value === "personal" || value === "enterprise") return value;
    return null;
}

function normalizeDomain(value: string | null | undefined) {
    const raw = (value || "").trim().toLowerCase();
    if (!raw) return null;
    const withoutProtocol = raw.replace(/^https?:\/\//, "");
    const hostname = withoutProtocol.split("/")[0]?.split(":")[0]?.trim() || "";
    const normalized = hostname.replace(/^\*\./, "").replace(/\.+$/, "");
    return normalized || null;
}

function normalizeEmail(value: string | null | undefined) {
    const normalized = (value || "").trim().toLowerCase();
    return normalized || "";
}

function extractEmailDomain(email: string | null | undefined) {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail.includes("@")) return null;
    return normalizeDomain(normalizedEmail.split("@")[1] || "");
}

function resolveBoolean(
    override: boolean | undefined,
    fallback: boolean | undefined,
    defaultValue: boolean
) {
    if (override !== undefined) return override;
    if (fallback !== undefined) return fallback;
    return defaultValue;
}

function resolveAuthMode(
    tenant: EnterpriseTenantConfig | null,
    binding: EnterpriseDomainBinding | null
): TenantAuthMode {
    if (tenant?.authMode === "enterprise") return "enterprise";
    if (binding?.providerId || binding?.providerType || binding?.identityPlatformTenantId) return "enterprise";
    return "personal";
}

function mapDomainBinding(id: string, data: Record<string, unknown>): EnterpriseDomainBinding {
    return {
        id,
        domain: normalizeDomain(typeof data.domain === "string" ? data.domain : id) || id,
        tenantId: normalizeOptionalString(data.tenantId),
        orgId: normalizeOptionalString(data.orgId),
        active: data.active !== false,
        identityPlatformTenantId: normalizeOptionalString(data.identityPlatformTenantId),
        providerType: normalizeProviderType(data.providerType),
        providerId: normalizeOptionalString(data.providerId),
        allowPersonalFallback: normalizeOptionalBoolean(data.allowPersonalFallback),
        allowPasswordLogin: normalizeOptionalBoolean(data.allowPasswordLogin),
        allowCodeLogin: normalizeOptionalBoolean(data.allowCodeLogin),
        allowGoogleLogin: normalizeOptionalBoolean(data.allowGoogleLogin),
        allowRegistration: normalizeOptionalBoolean(data.allowRegistration)
    };
}

function mapTenant(id: string, data: Record<string, unknown>): EnterpriseTenantConfig {
    const status = normalizeOptionalString(data.status);
    return {
        id,
        orgId: normalizeOptionalString(data.orgId),
        slug: normalizeOptionalString(data.slug),
        status:
            status === "active" || status === "trial" || status === "suspended"
                ? status
                : null,
        authMode: normalizeAuthMode(data.authMode),
        identityPlatformTenantId: normalizeOptionalString(data.identityPlatformTenantId),
        enterpriseProviderType: normalizeProviderType(data.enterpriseProviderType),
        enterpriseProviderId: normalizeOptionalString(data.enterpriseProviderId),
        allowPersonalFallback: normalizeOptionalBoolean(data.allowPersonalFallback),
        allowPasswordLogin: normalizeOptionalBoolean(data.allowPasswordLogin),
        allowCodeLogin: normalizeOptionalBoolean(data.allowCodeLogin),
        allowGoogleLogin: normalizeOptionalBoolean(data.allowGoogleLogin),
        allowRegistration: normalizeOptionalBoolean(data.allowRegistration)
    };
}

async function getDomainBindingByDomain(domain: string) {
    const normalizedDomain = normalizeDomain(domain);
    if (!normalizedDomain) return null;

    const direct = await db.collection("authDomainBindings").doc(normalizedDomain).get();
    if (direct.exists) {
        return mapDomainBinding(direct.id, direct.data() || {});
    }

    const query = await db
        .collection("authDomainBindings")
        .where("domain", "==", normalizedDomain)
        .limit(1)
        .get();
    if (query.empty) return null;

    const doc = query.docs[0];
    return mapDomainBinding(doc.id, doc.data() || {});
}

async function getTenantById(tenantId: string | null | undefined) {
    const normalizedTenantId = normalizeOptionalString(tenantId);
    if (!normalizedTenantId) return null;

    const snapshot = await db.collection("tenants").doc(normalizedTenantId).get();
    if (!snapshot.exists) return null;
    return mapTenant(snapshot.id, snapshot.data() || {});
}

async function getTenantByIdentityPlatformTenantId(identityPlatformTenantId: string | null | undefined) {
    const normalizedTenantId = normalizeOptionalString(identityPlatformTenantId);
    if (!normalizedTenantId) return null;

    const query = await db
        .collection("tenants")
        .where("identityPlatformTenantId", "==", normalizedTenantId)
        .limit(1)
        .get();
    if (query.empty) return null;

    const doc = query.docs[0];
    return mapTenant(doc.id, doc.data() || {});
}

function buildPolicy(
    tenant: EnterpriseTenantConfig | null,
    binding: EnterpriseDomainBinding | null,
    domain: string | null
): EnterprisePolicy {
    const mode = resolveAuthMode(tenant, binding);
    const providerType = binding?.providerType ?? tenant?.enterpriseProviderType ?? null;
    const providerId =
        binding?.providerId ??
        tenant?.enterpriseProviderId ??
        (providerType === "google" ? "google.com" : null);
    const identityPlatformTenantId =
        binding?.identityPlatformTenantId ?? tenant?.identityPlatformTenantId ?? null;
    const allowPasswordLogin = resolveBoolean(
        binding?.allowPasswordLogin,
        tenant?.allowPasswordLogin,
        mode !== "enterprise"
    );
    const allowCodeLogin = resolveBoolean(
        binding?.allowCodeLogin,
        tenant?.allowCodeLogin,
        mode !== "enterprise"
    );
    const allowGoogleLogin = resolveBoolean(
        binding?.allowGoogleLogin,
        tenant?.allowGoogleLogin,
        mode !== "enterprise" || providerType === "google"
    );
    const allowRegistration = resolveBoolean(
        binding?.allowRegistration,
        tenant?.allowRegistration,
        mode !== "enterprise"
    );
    const hasConfiguredEnterpriseProvider = Boolean(providerType && providerId);
    const hasAllowedEnterpriseMethod =
        hasConfiguredEnterpriseProvider ||
        allowPasswordLogin ||
        allowCodeLogin ||
        allowGoogleLogin;

    let ready = mode !== "enterprise";
    let message: string | null = null;

    if (binding && !binding.active) {
        ready = false;
        message = "Company sign-in is disabled for this domain.";
    } else if (tenant?.status === "suspended") {
        ready = false;
        message = "This tenant is suspended. Contact an administrator to restore access.";
    } else if (mode === "enterprise" && !hasAllowedEnterpriseMethod) {
        ready = false;
        message = "Enterprise sign-in is configured, but no login method is currently enabled for this tenant.";
    }

    return {
        mode,
        ready,
        tenantId: binding?.tenantId ?? tenant?.id ?? null,
        orgId: binding?.orgId ?? tenant?.orgId ?? null,
        domain,
        identityPlatformTenantId,
        providerType,
        providerId,
        allowPasswordLogin,
        allowCodeLogin,
        allowGoogleLogin,
        allowRegistration,
        message
    };
}

async function resolveEnterprisePolicy(input: {
    email: string | null | undefined;
    identityPlatformTenantId?: string | null;
    appTenantIdHint?: string | null;
}) {
    const domain = extractEmailDomain(input.email);
    const binding = domain ? await getDomainBindingByDomain(domain) : null;

    let tenant =
        (binding?.tenantId ? await getTenantById(binding.tenantId) : null) ??
        (input.appTenantIdHint ? await getTenantById(input.appTenantIdHint) : null);

    if (!tenant && input.identityPlatformTenantId) {
        tenant = await getTenantByIdentityPlatformTenantId(input.identityPlatformTenantId);
    }

    return buildPolicy(tenant, binding, domain);
}

function extractProviderFromEventType(eventType: string | null | undefined) {
    const raw = normalizeOptionalString(eventType);
    if (!raw) return "";
    const lastColonIndex = raw.lastIndexOf(":");
    if (lastColonIndex < 0 || lastColonIndex === raw.length - 1) return "";
    return raw.slice(lastColonIndex + 1).trim();
}

function readProviderId(event: BlockingEventLike) {
    return (
        normalizeOptionalString(event.credential?.providerId) ||
        normalizeOptionalString(event.additionalUserInfo?.providerId) ||
        extractProviderFromEventType(event.eventType) ||
        ""
    );
}

function readIdentityPlatformTenantId(event: BlockingEventLike) {
    const explicitTenantId =
        normalizeOptionalString(event.data?.tenantId) ||
        normalizeOptionalString(event.tenantId);
    if (explicitTenantId) return explicitTenantId;

    const resourceName =
        typeof event.resource === "string"
            ? event.resource
            : normalizeOptionalString(event.resource?.name);
    if (!resourceName) return null;

    const tenantMatch = resourceName.match(/\/tenants\/([^/]+)$/);
    return tenantMatch?.[1]?.trim() || null;
}

function readAppTenantIdHint(event: BlockingEventLike) {
    const claims = event.data?.customClaims;
    if (!claims || typeof claims !== "object") return null;
    return normalizeOptionalString(claims.tenantId);
}

function buildClaims(policy: EnterprisePolicy, providerId: string) {
    const customClaims: Record<string, string> = {};
    if (policy.tenantId) customClaims.tenantId = policy.tenantId;
    if (policy.orgId) customClaims.orgId = policy.orgId;
    if (policy.mode === "enterprise") customClaims.authMode = "enterprise";

    const sessionClaims: Record<string, string> = {};
    if (policy.domain) sessionClaims.companyDomain = policy.domain;
    if (policy.providerId) sessionClaims.enterpriseProviderId = policy.providerId;
    if (providerId) sessionClaims.lastAuthProvider = providerId;

    return {
        customClaims: Object.keys(customClaims).length > 0 ? customClaims : undefined,
        sessionClaims: Object.keys(sessionClaims).length > 0 ? sessionClaims : undefined
    };
}

function throwPolicyError(message: string) {
    throw new HttpsError("permission-denied", message);
}

function enforceEnterprisePolicy(
    policy: EnterprisePolicy,
    providerId: string,
    identityPlatformTenantId: string | null,
    stage: BlockingStage
) {
    if (policy.mode !== "enterprise") return;
    if (!policy.ready) {
        throwPolicyError(policy.message || "Enterprise sign-in is not fully configured for this tenant.");
    }

    const isPasswordSignIn = providerId === "password";
    const isCustomTokenSignIn = providerId === "custom";
    const isDirectGoogleSignIn = providerId === "google.com";

    if (stage === "create" && isPasswordSignIn && !policy.allowRegistration) {
        throwPolicyError("Self-service registration is disabled for this company. Use company SSO instead.");
    }

    if (stage === "sign_in" && isPasswordSignIn && !policy.allowPasswordLogin) {
        throwPolicyError("Password sign-in is disabled for this company. Use company SSO instead.");
    }
    if (stage === "sign_in" && isCustomTokenSignIn && !policy.allowCodeLogin) {
        throwPolicyError("Verification-code and custom-token sign-in are disabled for this company.");
    }
    if (stage === "sign_in" && isDirectGoogleSignIn && !policy.allowGoogleLogin) {
        throwPolicyError("Direct Google sign-in is disabled for this company. Use the configured enterprise provider.");
    }

    const passwordMethodAllowed = stage === "create" ? policy.allowRegistration : policy.allowPasswordLogin;
    const usesAllowedFallbackMethod =
        (isPasswordSignIn && passwordMethodAllowed) ||
        (isCustomTokenSignIn && policy.allowCodeLogin) ||
        (isDirectGoogleSignIn && policy.allowGoogleLogin);

    if (
        policy.identityPlatformTenantId &&
        identityPlatformTenantId !== policy.identityPlatformTenantId
    ) {
        throwPolicyError("This sign-in was issued for a different enterprise tenant.");
    }

    if (
        policy.providerId &&
        providerId &&
        providerId !== policy.providerId &&
        !usesAllowedFallbackMethod
    ) {
        throwPolicyError("This company requires signing in with its configured enterprise identity provider.");
    }
}

async function buildBlockingResponse(event: BlockingEventLike, stage: BlockingStage) {
    const email = normalizeEmail(event.data?.email || "");
    const providerId = readProviderId(event);
    const identityPlatformTenantId = readIdentityPlatformTenantId(event);
    const appTenantIdHint = readAppTenantIdHint(event);
    const policy = await resolveEnterprisePolicy({
        email,
        identityPlatformTenantId,
        appTenantIdHint
    });

    enforceEnterprisePolicy(policy, providerId, identityPlatformTenantId, stage);

    if (policy.mode !== "enterprise") {
        return;
    }

    const claims = buildClaims(policy, providerId);
    const shouldTrustEnterpriseProvider =
        Boolean(policy.providerId && providerId && providerId === policy.providerId && providerId !== "password" && providerId !== "custom");
    const response: Record<string, unknown> = {};

    if (claims.customClaims) {
        response.customClaims = claims.customClaims;
    }
    if (claims.sessionClaims) {
        response.sessionClaims = claims.sessionClaims;
    }
    if (shouldTrustEnterpriseProvider) {
        response.emailVerified = true;
    }

    return Object.keys(response).length > 0 ? response : undefined;
}

export const enforceEnterpriseUserCreation = beforeUserCreated(async (event) => {
    return buildBlockingResponse(event, "create");
});

export const enforceEnterpriseUserSignIn = beforeUserSignedIn(async (event) => {
    return buildBlockingResponse(event, "sign_in");
});
