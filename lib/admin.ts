import {
    getAdminEmailsFromEnv,
    getAdminViewerEmailsFromEnv,
    getOperatorEmailsFromEnv
} from "@/lib/env";

export type AdminRole = "none" | "viewer" | "operator" | "admin";
export type AdminCapability =
    | "feature_flags_write"
    | "orgs_manage"
    | "billing_manage"
    | "users_manage"
    | "tasks_manage"
    | "releases_publish"
    | "releases_approve"
    | "releases_rollback"
    | "webhooks_replay"
    | "tenants_manage"
    | "governance_override";

function normalizeEmail(value: string | null | undefined) {
    return (value || "").trim().toLowerCase();
}

export function isAdminEmail(email: string | null | undefined) {
    const normalized = normalizeEmail(email);
    if (!normalized) return false;
    return getAdminEmailsFromEnv().has(normalized);
}

export function resolveAdminRole(user: { email?: string | null } | null | undefined): AdminRole {
    const email = normalizeEmail(user?.email);
    if (!email) return "none";
    if (getAdminEmailsFromEnv().has(email)) return "admin";
    if (getOperatorEmailsFromEnv().has(email)) return "operator";
    if (getAdminViewerEmailsFromEnv().has(email)) return "viewer";
    return "none";
}

function roleRank(role: AdminRole) {
    switch (role) {
        case "admin":
            return 3;
        case "operator":
            return 2;
        case "viewer":
            return 1;
        default:
            return 0;
    }
}

export function getAdminCapabilitiesForRole(role: AdminRole): AdminCapability[] {
    if (role === "admin") {
        return [
            "feature_flags_write",
            "orgs_manage",
            "billing_manage",
            "users_manage",
            "tasks_manage",
            "releases_publish",
            "releases_approve",
            "releases_rollback",
            "webhooks_replay",
            "tenants_manage",
            "governance_override"
        ];
    }
    if (role === "operator") {
        return [
            "feature_flags_write",
            "tasks_manage",
            "releases_publish",
            "releases_approve",
            "releases_rollback",
            "webhooks_replay"
        ];
    }
    return [];
}

export function hasAdminRole(
    user: { email?: string | null } | null | undefined,
    minimumRole: Exclude<AdminRole, "none"> = "viewer"
) {
    return roleRank(resolveAdminRole(user)) >= roleRank(minimumRole);
}

export function hasAdminCapability(
    user: { email?: string | null } | null | undefined,
    capability: AdminCapability
) {
    const role = resolveAdminRole(user);
    return getAdminCapabilitiesForRole(role).includes(capability);
}

export function isAdminUser(user: { email?: string | null } | null | undefined) {
    return resolveAdminRole(user) === "admin";
}
