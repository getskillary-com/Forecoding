let cachedAdminStatus: boolean | null = null;
let adminStatusPromise: Promise<boolean> | null = null;

export function getCachedAdminStatus() {
    return cachedAdminStatus;
}

export async function loadAdminStatus(forceRefresh = false): Promise<boolean> {
    if (!forceRefresh && cachedAdminStatus !== null) {
        return cachedAdminStatus;
    }

    if (!forceRefresh && adminStatusPromise) {
        return adminStatusPromise;
    }

    adminStatusPromise = (async () => {
        try {
            const res = await fetch("/api/admin/status", { cache: "no-store" });
            if (!res.ok) {
                cachedAdminStatus = false;
                return false;
            }

            const payload = (await res.json()) as { isAdmin?: boolean };
            cachedAdminStatus = payload.isAdmin === true;
            return cachedAdminStatus;
        } catch {
            cachedAdminStatus = false;
            return false;
        } finally {
            adminStatusPromise = null;
        }
    })();

    return adminStatusPromise;
}
