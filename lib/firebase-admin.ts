import { App, cert, getApps, initializeApp } from "firebase-admin/app";
import { Auth, BaseAuth, UserRecord, getAuth } from "firebase-admin/auth";
import { Firestore, getFirestore } from "firebase-admin/firestore";

function readPrivateKey() {
    const raw = process.env.FIREBASE_PRIVATE_KEY || "";
    if (!raw) return "";
    return raw.replace(/\\n/g, "\n");
}

function buildFirebaseApp() {
    const existing = getApps()[0];
    if (existing) return existing;

    const projectId = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "";
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL || "";
    const privateKey = readPrivateKey();

    if (projectId && clientEmail && privateKey) {
        return initializeApp({
            credential: cert({
                projectId,
                clientEmail,
                privateKey
            }),
            projectId
        });
    }

    return initializeApp(projectId ? { projectId } : undefined);
}

const app: App = buildFirebaseApp();

export const firebaseAdminApp = app;
export const adminAuth: Auth = getAuth(app);
export const adminDb: Firestore = getFirestore(app);

function normalizeIdentityPlatformTenantId(identityPlatformTenantId?: string | null) {
    const normalizedTenantId = (identityPlatformTenantId || "").trim();
    return normalizedTenantId || null;
}

function normalizeComparableEmail(email?: string | null) {
    return typeof email === "string" ? email.trim().toLowerCase() : "";
}

function readFirebaseAdminErrorCode(error: unknown) {
    if (!error || typeof error !== "object") {
        return null;
    }
    const code =
        ("code" in error && typeof error.code === "string" && error.code) ||
        ("errorInfo" in error &&
            error.errorInfo &&
            typeof error.errorInfo === "object" &&
            "code" in error.errorInfo &&
            typeof error.errorInfo.code === "string" &&
            error.errorInfo.code);
    return code || null;
}

export function getAuthClientForIdentityTenant(identityPlatformTenantId?: string | null): BaseAuth {
    const normalizedTenantId = normalizeIdentityPlatformTenantId(identityPlatformTenantId);
    if (!normalizedTenantId) {
        return adminAuth;
    }
    return adminAuth.tenantManager().authForTenant(normalizedTenantId);
}

export async function findAuthUserByEmail(
    email: string,
    identityPlatformTenantId?: string | null
): Promise<UserRecord | null> {
    const authClient = getAuthClientForIdentityTenant(identityPlatformTenantId);
    try {
        return await authClient.getUserByEmail(email);
    } catch (error) {
        const code = (error as { code?: string } | null)?.code;
        if (code === "auth/user-not-found") {
            return null;
        }
        throw error;
    }
}

export async function findAuthUserByUid(
    uid: string,
    identityPlatformTenantId?: string | null
): Promise<UserRecord | null> {
    const authClient = getAuthClientForIdentityTenant(identityPlatformTenantId);
    try {
        return await authClient.getUser(uid);
    } catch (error) {
        const code = (error as { code?: string } | null)?.code;
        if (code === "auth/user-not-found") {
            return null;
        }
        throw error;
    }
}

export async function revokeAuthRefreshTokens(input: {
    uid: string;
    email?: string | null;
    identityPlatformTenantId?: string | null;
}): Promise<"project" | "tenant"> {
    const normalizedTenantId = normalizeIdentityPlatformTenantId(input.identityPlatformTenantId);
    if (!normalizedTenantId) {
        await adminAuth.revokeRefreshTokens(input.uid);
        return "project";
    }

    const tenantAuth = getAuthClientForIdentityTenant(normalizedTenantId);
    try {
        await tenantAuth.revokeRefreshTokens(input.uid);
        return "tenant";
    } catch (tenantError) {
        const tenantErrorCode = readFirebaseAdminErrorCode(tenantError);
        const fallbackUser = await findAuthUserByUid(input.uid, null);
        const expectedEmail = normalizeComparableEmail(input.email);
        const fallbackEmail = normalizeComparableEmail(fallbackUser?.email);
        const canFallbackToProjectUser =
            Boolean(fallbackUser) && (!expectedEmail || fallbackEmail === expectedEmail);

        if (!canFallbackToProjectUser) {
            throw tenantError;
        }

        console.warn("[firebase-admin] tenant revokeRefreshTokens failed; retrying against project auth.", {
            uid: input.uid,
            tenantId: normalizedTenantId,
            code: tenantErrorCode
        });

        await adminAuth.revokeRefreshTokens(input.uid);
        return "project";
    }
}
