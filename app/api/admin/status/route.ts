import { NextResponse } from "next/server";
import { getServerSessionIdentity } from "@/lib/server-auth";
import { isAdminUser, resolveAdminRole } from "@/lib/admin";

export const runtime = "nodejs";

export async function GET() {
    try {
        const user = await getServerSessionIdentity();

        if (!user?.uid) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        return NextResponse.json({
            ok: true,
            isAdmin: isAdminUser({ email: user.email }),
            adminRole: resolveAdminRole({ email: user.email })
        });
    } catch {
        return NextResponse.json({ error: "Failed to resolve admin status." }, { status: 500 });
    }
}
