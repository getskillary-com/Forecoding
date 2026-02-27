function normalizeEmail(value: string | null | undefined) {
    return (value || "").trim().toLowerCase();
}

let cachedSource = "";
let cachedEmails = new Set<string>();

function readAdminEmails() {
    const source = (
        process.env.FORECODING_ADMIN_EMAILS ||
        process.env.ADMIN_EMAILS ||
        ""
    ).trim();

    if (source === cachedSource) {
        return cachedEmails;
    }

    cachedSource = source;
    cachedEmails = new Set(
        source
            .split(/[,\n;]+/)
            .map((item) => normalizeEmail(item))
            .filter(Boolean)
    );

    return cachedEmails;
}

export function isAdminEmail(email: string | null | undefined) {
    const normalized = normalizeEmail(email);
    if (!normalized) return false;
    return readAdminEmails().has(normalized);
}

export function isAdminUser(user: { email?: string | null } | null | undefined) {
    return isAdminEmail(user?.email);
}

