import { NextResponse } from "next/server";
import { getServerUser } from "@/lib/server-auth";
import { isAdminUser } from "@/lib/admin";

export const runtime = "nodejs";

export async function GET() {
    try {
        const user = await getServerUser();

        if (!user?.uid) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        return NextResponse.json({
            ok: true,
            isAdmin: isAdminUser({ email: user.email })
        });
    } catch {
        return NextResponse.json({ error: "Failed to resolve admin status." }, { status: 500 });
    }
}
