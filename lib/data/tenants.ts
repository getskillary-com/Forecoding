import { adminDb } from "@/lib/firebase-admin";
import { toDateOrNull } from "./firestore-utils";
import type { Tenant } from "@/types";

function tenantsCollection() {
    return adminDb.collection("tenants");
}

function mapTenant(id: string, data: Record<string, unknown>): Tenant {
    return {
        id,
        name: typeof data.name === "string" ? data.name : id,
        slug: typeof data.slug === "string" ? data.slug : id,
        status:
            data.status === "trial" || data.status === "suspended"
                ? data.status
                : "active",
        workspaceCount: typeof data.workspaceCount === "number" ? data.workspaceCount : 0,
        createdAt: toDateOrNull(data.createdAt)?.getTime() || Date.now(),
        updatedAt: toDateOrNull(data.updatedAt)?.getTime() || Date.now()
    };
}

export async function listTenants(limit = 30): Promise<Tenant[]> {
    const snap = await tenantsCollection().limit(limit).get();
    return snap.docs
        .map((doc) => mapTenant(doc.id, doc.data() || {}))
        .sort((left, right) => right.updatedAt - left.updatedAt);
}
