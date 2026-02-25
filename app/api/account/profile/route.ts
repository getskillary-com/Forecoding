import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function getUserId() {
    const session = await getServerSession(authOptions);
    return (session?.user as { id?: string } | undefined)?.id ?? null;
}

export async function GET() {
    try {
        const userId = await getUserId();
        if (!userId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                email: true,
                name: true,
                image: true,
                emailVerified: true
            }
        });

        if (!user) {
            return NextResponse.json({ error: "User not found." }, { status: 404 });
        }

        return NextResponse.json({ user });
    } catch {
        return NextResponse.json({ error: "Failed to load profile." }, { status: 500 });
    }
}

export async function PATCH(req: Request) {
    try {
        const userId = await getUserId();
        if (!userId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = (await req.json()) as { name?: string };
        const name = (body.name ?? "").trim();

        if (name.length > 80) {
            return NextResponse.json({ error: "Name is too long." }, { status: 400 });
        }

        const updated = await prisma.user.update({
            where: { id: userId },
            data: {
                name: name || null
            },
            select: {
                email: true,
                name: true,
                image: true,
                emailVerified: true
            }
        });

        return NextResponse.json({ ok: true, user: updated });
    } catch {
        return NextResponse.json({ error: "Failed to update profile." }, { status: 500 });
    }
}
