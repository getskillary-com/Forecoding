import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AuthCodePurposes, consumeAuthCode } from "@/lib/auth-code";
import { isValidEmail, sanitizeEmail } from "@/lib/security";

export async function POST(req: Request) {
    try {
        const session = await getServerSession(authOptions);
        const userId = (session?.user as { id?: string } | undefined)?.id;
        if (!userId) {
            return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
        }

        const body = (await req.json()) as { email?: string; code?: string };
        const email = sanitizeEmail(body.email ?? "");
        const code = (body.code ?? "").trim();

        if (!isValidEmail(email) || code.length !== 6) {
            return NextResponse.json({ error: "Invalid request payload." }, { status: 400 });
        }

        const currentUser = await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, email: true }
        });
        if (!currentUser) {
            return NextResponse.json({ error: "Account not found." }, { status: 404 });
        }

        if (currentUser.email && sanitizeEmail(currentUser.email) === email) {
            return NextResponse.json({ error: "New email must be different from current email." }, { status: 400 });
        }

        const existingUser = await prisma.user.findUnique({
            where: { email },
            select: { id: true }
        });
        if (existingUser && existingUser.id !== userId) {
            return NextResponse.json({ error: "This email is already registered." }, { status: 409 });
        }

        const codeResult = await consumeAuthCode({
            email,
            code,
            purpose: AuthCodePurposes.changeEmail
        });
        if (!codeResult.ok) {
            return NextResponse.json({ error: codeResult.error }, { status: 400 });
        }

        await prisma.user.update({
            where: { id: userId },
            data: {
                email,
                emailVerified: new Date()
            }
        });

        return NextResponse.json({ ok: true, email });
    } catch {
        return NextResponse.json({ error: "Failed to change email." }, { status: 500 });
    }
}
