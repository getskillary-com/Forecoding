import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { AuthCodePurposes, consumeAuthCode } from "@/lib/auth-code";
import { hashPassword, isValidEmail, isValidPassword, sanitizeEmail } from "@/lib/security";

export async function POST(req: Request) {
    try {
        const body = (await req.json()) as {
            email?: string;
            password?: string;
            code?: string;
        };

        const email = sanitizeEmail(body.email ?? "");
        const password = body.password ?? "";
        const code = (body.code ?? "").trim();

        if (!isValidEmail(email) || !isValidPassword(password) || code.length !== 6) {
            return NextResponse.json({ error: "Invalid request payload." }, { status: 400 });
        }

        const existingUser = await prisma.user.findUnique({ where: { email } });
        if (existingUser) {
            return NextResponse.json({ error: "This email is already registered." }, { status: 409 });
        }

        const codeResult = await consumeAuthCode({
            email,
            code,
            purpose: AuthCodePurposes.register
        });

        if (!codeResult.ok) {
            return NextResponse.json({ error: codeResult.error }, { status: 400 });
        }

        const passwordHash = hashPassword(password);
        await prisma.user.create({
            data: {
                email,
                passwordHash,
                emailVerified: new Date()
            }
        });

        return NextResponse.json({ ok: true });
    } catch {
        return NextResponse.json({ error: "Failed to create account." }, { status: 500 });
    }
}
