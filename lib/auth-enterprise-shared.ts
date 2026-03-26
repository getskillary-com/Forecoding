export type EnterpriseProviderType = "oidc" | "saml" | "google";
export type TenantAuthMode = "personal" | "enterprise";
export type EnterpriseAuthBootstrapSource =
    | "default"
    | "tenant_hint"
    | "host"
    | "domain"
    | "identity_tenant";

export type EnterpriseAuthBootstrap = {
    mode: TenantAuthMode;
    source: EnterpriseAuthBootstrapSource;
    ready: boolean;
    tenantId: string | null;
    tenantSlug: string | null;
    orgId: string | null;
    identityPlatformTenantId: string | null;
    providerType: EnterpriseProviderType | null;
    providerId: string | null;
    domain: string | null;
    loginHint: string | null;
    allowPasswordLogin: boolean;
    allowCodeLogin: boolean;
    allowGoogleLogin: boolean;
    allowRegistration: boolean;
    allowPersonalFallback: boolean;
    message: string | null;
};

export function createDefaultEnterpriseAuthBootstrap(): EnterpriseAuthBootstrap {
    return {
        mode: "personal",
        source: "default",
        ready: true,
        tenantId: null,
        tenantSlug: null,
        orgId: null,
        identityPlatformTenantId: null,
        providerType: null,
        providerId: null,
        domain: null,
        loginHint: null,
        allowPasswordLogin: true,
        allowCodeLogin: true,
        allowGoogleLogin: true,
        allowRegistration: true,
        allowPersonalFallback: true,
        message: null
    };
}
