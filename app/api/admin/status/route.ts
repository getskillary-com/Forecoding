import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdminUser } from "@/lib/admin";

export const runtime = "nodejs";

export async function GET() {
    try {
        const session = await getServerSession(authOptions);
        const user = session?.user as { id?: string; email?: string | null } | undefined;

        if (!user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        return NextResponse.json({
            ok: true,
            isAdmin: isAdminUser(user)
        });
    } catch {
        return NextResponse.json({ error: "Failed to resolve admin status." }, { status: 500 });
    }
}

