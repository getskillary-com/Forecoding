import { normalizeEmail } from "@/lib/data/firestore-utils";
import {
    findTenantByIdentityPlatformTenantId,
    findTenantBySlugOrId,
    getTenantById
} from "@/lib/data/tenants";
import { adminDb } from "@/lib/firebase-admin";
import type { Tenant } from "@/types";
import {
    createDefaultEnterpriseAuthBootstrap,
    type EnterpriseAuthBootstrap,
    type EnterpriseAuthBootstrapSource,
    type EnterpriseProviderType,
    type TenantAuthMode
} from "./auth-enterprise-shared";

type EnterpriseDomainBinding = {
    id: string;
    domain: string;
    tenantId: string | null;
    orgId: string | null;
    active: boolean;
    identityPlatformTenantId: string | null;
    providerType: EnterpriseProviderType | null;
    providerId: string | null;
    loginHint: string | null;
    allowPersonalFallback?: boolean;
    allowPasswordLogin?: boolean;
    allowCodeLogin?: boolean;
    allowGoogleLogin?: boolean;
    allowRegistration?: boolean;
};

export type EnterpriseAuthContext = {
    bootstrap: EnterpriseAuthBootstrap;
    tenant: Tenant | null;
    binding: EnterpriseDomainBinding | null;
};

function authDomainBindingsCollection() {
    return adminDb.collection("authDomainBindings");
}

function normalizeDomain(value: string | null | undefined) {
    const raw = (value || "").trim().toLowerCase();
    if (!raw) return null;
    const withoutProtocol = raw.replace(/^https?:\/\//, "");
    const hostname = withoutProtocol.split("/")[0]?.split(":")[0]?.trim() || "";
    const normalized = hostname.replace(/^\*\./, "").replace(/\.+$/, "");
    return normalized || null;
}

function extractEmailDomain(email: string | null | undefined) {
    const normalized = normalizeEmail(email || "");
    if (!normalized.includes("@")) return null;
    return normalizeDomain(normalized.split("@")[1] || "");
}

function normalizeOptionalBoolean(value: unknown) {
    return typeof value === "boolean" ? value : undefined;
}

function normalizeOptionalString(value: unknown) {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed || null;
}

function normalizeProviderType(value: unknown): EnterpriseProviderType | null {
    if (value === "oidc" || value === "saml" || value === "google") return value;
    return null;
}

function deriveTenantHintFromHost(host: string | null | undefined) {
    const normalizedHost = normalizeDomain(host);
    if (!normalizedHost || normalizedHost === "localhost") return null;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(normalizedHost)) return null;

    const labels = normalizedHost.split(".");
    if (labels.length < 3) return null;

    const subdomain = labels[0] || "";
    if (!subdomain || ["www", "app", "auth"].includes(subdomain)) return null;
    return subdomain;
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
        loginHint: normalizeOptionalString(data.loginHint),
        allowPersonalFallback: normalizeOptionalBoolean(data.allowPersonalFallback),
        allowPasswordLogin: normalizeOptionalBoolean(data.allowPasswordLogin),
        allowCodeLogin: normalizeOptionalBoolean(data.allowCodeLogin),
        allowGoogleLogin: normalizeOptionalBoolean(data.allowGoogleLogin),
        allowRegistration: normalizeOptionalBoolean(data.allowRegistration)
    };
}

async function getDomainBindingByDomain(domain: string): Promise<EnterpriseDomainBinding | null> {
    const normalizedDomain = normalizeDomain(domain);
    if (!normalizedDomain) return null;

    const direct = await authDomainBindingsCollection().doc(normalizedDomain).get();
    if (direct.exists) {
        return mapDomainBinding(direct.id, direct.data() || {});
    }

    const query = await authDomainBindingsCollection()
        .where("domain", "==", normalizedDomain)
        .limit(1)
        .get();
    if (query.empty) return null;

    const doc = query.docs[0];
    return mapDomainBinding(doc.id, doc.data() || {});
}

function resolveAuthMode(tenant: Tenant | null, binding: EnterpriseDomainBinding | null): TenantAuthMode {
    if (tenant?.authMode === "enterprise") return "enterprise";
    if (binding?.providerId || binding?.providerType || binding?.identityPlatformTenantId) return "enterprise";
    return "personal";
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

function buildBootstrap(input: {
    tenant: Tenant | null;
    binding: EnterpriseDomainBinding | null;
    source: EnterpriseAuthBootstrapSource;
    domain: string | null;
}): EnterpriseAuthBootstrap {
    const base = createDefaultEnterpriseAuthBootstrap();
    const { tenant, binding, source, domain } = input;
    const mode = resolveAuthMode(tenant, binding);
    const providerType = binding?.providerType ?? tenant?.enterpriseProviderType ?? null;
    const providerId =
        binding?.providerId ??
        tenant?.enterpriseProviderId ??
        (providerType === "google" ? "google.com" : null);
    const identityPlatformTenantId =
        binding?.identityPlatformTenantId ?? tenant?.identityPlatformTenantId ?? null;

    const allowPersonalFallback = resolveBoolean(
        binding?.allowPersonalFallback,
        tenant?.allowPersonalFallback,
        mode !== "enterprise"
    );
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
        ...base,
        mode,
        source,
        ready,
        tenantId: binding?.tenantId ?? tenant?.id ?? null,
        tenantSlug: tenant?.slug ?? null,
        orgId: binding?.orgId ?? tenant?.orgId ?? null,
        identityPlatformTenantId,
        providerType,
        providerId,
        domain,
        loginHint: binding?.loginHint ?? tenant?.loginHint ?? null,
        allowPasswordLogin,
        allowCodeLogin,
        allowGoogleLogin,
        allowRegistration,
        allowPersonalFallback,
        message
    };
}

function buildUnmappedIdentityTenantBootstrap(identityPlatformTenantId: string): EnterpriseAuthBootstrap {
    const base = createDefaultEnterpriseAuthBootstrap();
    return {
        ...base,
        mode: "enterprise",
        source: "identity_tenant",
        ready: false,
        identityPlatformTenantId,
        allowPasswordLogin: false,
        allowCodeLogin: false,
        allowGoogleLogin: false,
        allowRegistration: false,
        allowPersonalFallback: false,
        message: "This Identity Platform tenant is not mapped to an application tenant."
    };
}

export async function resolveEnterpriseAuthContext(input: {
    email?: string | null;
    tenantHint?: string | null;
    host?: string | null;
    identityPlatformTenantId?: string | null;
}): Promise<EnterpriseAuthContext> {
    const emailDomain = extractEmailDomain(input.email);
    const explicitTenantHint = normalizeOptionalString(input.tenantHint);
    const hostTenantHint = deriveTenantHintFromHost(input.host);
    const normalizedIdentityPlatformTenantId = normalizeOptionalString(input.identityPlatformTenantId);

    let tenant: Tenant | null = null;
    let binding: EnterpriseDomainBinding | null = null;
    let source: EnterpriseAuthBootstrapSource = "default";

    if (normalizedIdentityPlatformTenantId) {
        tenant = await findTenantByIdentityPlatformTenantId(normalizedIdentityPlatformTenantId);
        if (tenant) {
            source = "identity_tenant";
        }
    }

    if (!tenant && explicitTenantHint) {
        tenant = await findTenantBySlugOrId(explicitTenantHint);
        if (tenant) {
            source = "tenant_hint";
        }
    }

    if (!tenant && hostTenantHint) {
        tenant = await findTenantBySlugOrId(hostTenantHint);
        if (tenant) {
            source = "host";
        }
    }

    if (emailDomain) {
        binding = await getDomainBindingByDomain(emailDomain);
        if (binding) {
            if (!tenant && binding.tenantId) {
                tenant = await getTenantById(binding.tenantId);
            }
            if (!tenant && binding.identityPlatformTenantId) {
                tenant = await findTenantByIdentityPlatformTenantId(binding.identityPlatformTenantId);
            }
            source = "domain";
        }
    }

    if (!tenant && normalizedIdentityPlatformTenantId) {
        return {
            bootstrap: buildUnmappedIdentityTenantBootstrap(normalizedIdentityPlatformTenantId),
            tenant: null,
            binding
        };
    }

    return {
        bootstrap: buildBootstrap({
            tenant,
            binding,
            source,
            domain: emailDomain
        }),
        tenant,
        binding
    };
}
