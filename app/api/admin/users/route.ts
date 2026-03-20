import { z } from "zod";
import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/admin-api";
import { listUserProfiles, updateUserStatusByUid, type UserProfile, type UserStatus } from "@/lib/data/users";

export const runtime = "nodejs";

const UpdateUserStatusSchema = z.object({
    uid: z.string().trim().min(1),
    status: z.enum(["active", "suspended"]),
    reason: z.string().trim().max(240).optional()
});

function serializeUser(user: UserProfile) {
    return {
        uid: user.uid,
        email: user.email,
        tenantId: user.tenantId ?? null,
        status: user.status,
        statusReason: user.statusReason ?? null,
        name: user.name ?? null,
        sessionVersion: user.sessionVersion,
        statusUpdatedAt: user.statusUpdatedAt?.getTime() ?? null,
        createdAt: user.createdAt?.getTime() ?? null,
        updatedAt: user.updatedAt?.getTime() ?? null
    };
}

export async function GET(req: Request) {
    const admin = await requireAdminRoute();
    if (admin.error) return admin.error;

    const url = new URL(req.url);
    const status = (url.searchParams.get("status") || "") as "" | UserStatus;
    const tenantId = url.searchParams.get("tenantId") || "";
    const query = url.searchParams.get("query") || "";
    const limit = Number.parseInt(url.searchParams.get("limit") || "40", 10);

    const users = await listUserProfiles({
        status,
        tenantId,
        query,
        limit: Number.isFinite(limit) ? limit : 40
    });

    return NextResponse.json({
        users: users.map(serializeUser),
        role: admin.role
    });
}

export async function PATCH(req: Request) {
    const admin = await requireAdminRoute({ minimumCapability: "users_manage" });
    if (admin.error) return admin.error;

    const payload = UpdateUserStatusSchema.parse(await req.json());
    const user = await updateUserStatusByUid({
        uid: payload.uid,
        status: payload.status,
        reason: payload.reason ?? null,
        actorId: admin.user?.uid ?? null,
        actorEmail: admin.user?.email ?? null
    });

    if (!user) {
        return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    return NextResponse.json({
        ok: true,
        user: serializeUser(user),
        role: admin.role
    });
}
