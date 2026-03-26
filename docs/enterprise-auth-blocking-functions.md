# Enterprise Auth Blocking Functions

This repository now resolves enterprise tenant and provider settings through:

- `tenants/{tenantId}`
- `authDomainBindings/{domain}`
- `GET /api/auth/bootstrap`
- `POST /api/auth/session`

The app-side enforcement is already in place, but production enterprise setups should also add
Firebase Auth blocking functions so unsupported users are rejected before Firebase issues a token.

## Firestore shape

`tenants/{tenantId}`

```json
{
  "name": "Acme",
  "slug": "acme",
  "status": "active",
  "authMode": "enterprise",
  "enterpriseProviderType": "saml",
  "enterpriseProviderId": "saml.acme",
  "allowPersonalFallback": false,
  "allowPasswordLogin": false,
  "allowCodeLogin": false,
  "allowGoogleLogin": false,
  "allowRegistration": false,
  "loginHint": "you@acme.com"
}
```

`authDomainBindings/{domain}`

```json
{
  "domain": "acme.com",
  "tenantId": "tenant_acme",
  "active": true,
  "providerType": "saml",
  "providerId": "saml.acme"
}
```

`identityPlatformTenantId` is optional. Keep it only if you later enable Identity Platform multi-tenancy.

## Blocking function example

This example assumes a separate Firebase Functions workspace with `firebase-functions` and
`firebase-admin` installed.

```ts
import { beforeUserSignedIn } from "firebase-functions/v2/identity";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

initializeApp();
const db = getFirestore();

export const enforceEnterpriseLogin = beforeUserSignedIn(async (event) => {
  const email = (event.data?.email || "").trim().toLowerCase();
  const tenantId = event.data?.tenantId || event.tenantId || "";
  const providerId = event.credential?.providerId || event.additionalUserInfo?.providerId || "";

  if (!email) {
    throw new Error("Email is required for enterprise sign-in.");
  }

  const domain = email.split("@")[1] || "";
  const domainBinding = await db.collection("authDomainBindings").doc(domain).get();
  if (!domainBinding.exists) {
    return;
  }

  const binding = domainBinding.data() || {};
  if (binding.active === false) {
    throw new Error("Company sign-in is disabled for this domain.");
  }

  if (binding.identityPlatformTenantId && tenantId !== binding.identityPlatformTenantId) {
    throw new Error("Tenant mismatch.");
  }

  if (binding.providerId && providerId !== binding.providerId) {
    throw new Error("Use the configured company identity provider.");
  }

  return {
    sessionClaims: {
      tenantId: binding.tenantId || "",
      orgId: binding.orgId || ""
    }
  };
});
```

## Deployment notes

- Blocking functions require Firebase Authentication with Identity Platform.
- OIDC and SAML providers also require an upgraded project.
- If you set custom claims or session claims in blocking functions, force a token refresh on the client before calling your app session endpoint.
