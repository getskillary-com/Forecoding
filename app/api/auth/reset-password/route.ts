import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { AuthCodePurposes, consumeAuthCode } from "@/lib/auth-code";
import { hashPassword, isValidEmail, isValidPassword, sanitizeEmail } from "@/lib/security";

export async function POST(req: Request) {
    try {
        const body = (await req.json()) as {
            email?: string;
            newPassword?: string;
            code?: string;
        };

        const email = sanitizeEmail(body.email ?? "");
        const newPassword = body.newPassword ?? "";
        const code = (body.code ?? "").trim();

        if (!isValidEmail(email) || !isValidPassword(newPassword) || code.length !== 6) {
            return NextResponse.json({ error: "Invalid request payload." }, { status: 400 });
        }

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) {
            return NextResponse.json({ error: "Account not found." }, { status: 404 });
        }

        const codeResult = await consumeAuthCode({
            email,
            code,
            purpose: AuthCodePurposes.resetPassword
        });

        if (!codeResult.ok) {
            return NextResponse.json({ error: codeResult.error }, { status: 400 });
        }

        const passwordHash = hashPassword(newPassword);
        await prisma.user.update({
            where: { email },
            data: {
                passwordHash,
                emailVerified: user.emailVerified ?? new Date(),
                sessionVersion: { increment: 1 }
            }
        });

        return NextResponse.json({ ok: true });
    } catch {
        return NextResponse.json({ error: "Failed to reset password." }, { status: 500 });
    }
}
