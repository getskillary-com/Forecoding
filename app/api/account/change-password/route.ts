import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hashPassword, isValidPassword } from "@/lib/security";

async function getUserId() {
    const session = await getServerSession(authOptions);
    return (session?.user as { id?: string } | undefined)?.id ?? null;
}

export async function POST(req: Request) {
    try {
        const userId = await getUserId();
        if (!userId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = (await req.json()) as {
            newPassword?: string;
            confirmNewPassword?: string;
        };
        const newPassword = body.newPassword ?? "";
        const confirmNewPassword = body.confirmNewPassword ?? "";

        if (!isValidPassword(newPassword)) {
            return NextResponse.json({ error: "New password must be at least 8 characters." }, { status: 400 });
        }

        if (confirmNewPassword && newPassword !== confirmNewPassword) {
            return NextResponse.json({ error: "Two passwords do not match." }, { status: 400 });
        }

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { emailVerified: true }
        });

        if (!user) {
            return NextResponse.json({ error: "User not found." }, { status: 404 });
        }

        await prisma.user.update({
            where: { id: userId },
            data: {
                passwordHash: hashPassword(newPassword),
                emailVerified: user.emailVerified ?? new Date()
            }
        });

        return NextResponse.json({ ok: true });
    } catch {
        return NextResponse.json({ error: "Failed to change password." }, { status: 500 });
    }
}
