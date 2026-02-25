import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import { AuthCodePurposes, consumeAuthCode } from "@/lib/auth-code";
import { prisma, withPrismaRetry } from "@/lib/prisma";
import { isValidEmail, sanitizeEmail, verifyPassword } from "@/lib/security";

const useDevBypass = process.env.NEXTAUTH_DEV_BYPASS === "1";

type TokenWithVersion = {
    sub?: string;
    sessionVersion?: number;
    invalidated?: boolean;
    email?: string | null;
    name?: string | null;
};

export const authOptions: NextAuthOptions = {
    adapter: useDevBypass ? undefined : PrismaAdapter(prisma),
    session: {
        strategy: "jwt"
    },
    providers: [
        CredentialsProvider({
            id: "credentials-password",
            name: "Email Password",
            credentials: {
                email: { label: "Email", type: "email" },
                password: { label: "Password", type: "password" }
            },
            async authorize(credentials) {
                const email = sanitizeEmail(credentials?.email ?? "");
                const password = credentials?.password ?? "";

                if (!isValidEmail(email) || !password) {
                    return null;
                }

                let user = null;
                try {
                    user = await withPrismaRetry(() =>
                        prisma.user.findUnique({ where: { email } })
                    );
                } catch (error) {
                    console.error("[auth] Failed to load user for password login:", error);
                    return null;
                }

                if (!user?.passwordHash) {
                    return null;
                }

                const valid = verifyPassword(password, user.passwordHash);
                if (!valid) {
                    return null;
                }

                return {
                    id: user.id,
                    name: user.name ?? user.email ?? "User",
                    email: user.email
                };
            }
        }),
        CredentialsProvider({
            id: "credentials-code",
            name: "Email Verification Code",
            credentials: {
                email: { label: "Email", type: "email" },
                code: { label: "Code", type: "text" }
            },
            async authorize(credentials) {
                const email = sanitizeEmail(credentials?.email ?? "");
                const code = (credentials?.code ?? "").trim();
                if (!isValidEmail(email) || code.length !== 6) {
                    return null;
                }

                const verifyResult = await consumeAuthCode({
                    email,
                    code,
                    purpose: AuthCodePurposes.login
                });

                if (!verifyResult.ok) {
                    return null;
                }

                let user = null;
                try {
                    user = await withPrismaRetry(() =>
                        prisma.user.findUnique({ where: { email } })
                    );
                } catch (error) {
                    console.error("[auth] Failed to load user for code login:", error);
                    return null;
                }

                if (!user) {
                    return null;
                }

                if (!user.emailVerified) {
                    try {
                        await withPrismaRetry(() =>
                            prisma.user.update({
                                where: { id: user.id },
                                data: { emailVerified: new Date() }
                            })
                        );
                    } catch (error) {
                        console.error("[auth] Failed to update email verification:", error);
                        return null;
                    }
                }

                return {
                    id: user.id,
                    name: user.name ?? user.email ?? "User",
                    email: user.email
                };
            }
        }),
        ...(useDevBypass ? [
            CredentialsProvider({
                id: "dev-login",
                name: "Dev Login",
                credentials: {
                    email: { label: "Email", type: "email", placeholder: "dev@local" }
                },
                async authorize(credentials) {
                    const email = credentials?.email?.trim() || "dev@local";
                    return {
                        id: "dev-user",
                        name: "Dev User",
                        email
                    };
                }
            })
        ] : [])
    ],
    secret: process.env.NEXTAUTH_SECRET,
    pages: {
        signIn: "/login"
    },
    callbacks: {
        async jwt({ token, user }) {
            const nextToken = token as typeof token & TokenWithVersion;

            if (user?.id) {
                nextToken.sub = user.id;
                nextToken.invalidated = false;
            }

            if (nextToken.invalidated) {
                return nextToken;
            }

            if (useDevBypass) {
                return nextToken;
            }

            if (!nextToken.sub) {
                return nextToken;
            }

            let dbUser: {
                sessionVersion: number;
                email: string | null;
                name: string | null;
            } | null = null;
            try {
                dbUser = await withPrismaRetry(() =>
                    prisma.user.findUnique({
                        where: { id: nextToken.sub },
                        select: {
                            sessionVersion: true,
                            email: true,
                            name: true
                        }
                    })
                );
            } catch (error) {
                console.error("[auth] Failed to validate jwt session against database:", error);
                nextToken.invalidated = true;
                return nextToken;
            }

            if (!dbUser) {
                nextToken.invalidated = true;
                return nextToken;
            }

            if (user?.id) {
                // Fresh sign-in: bind token to current server-side session version.
                nextToken.sessionVersion = dbUser.sessionVersion;
                nextToken.invalidated = false;
                nextToken.email = dbUser.email;
                nextToken.name = dbUser.name ?? dbUser.email ?? "User";
                return nextToken;
            }

            if (typeof nextToken.sessionVersion !== "number") {
                // Backward compatibility for old tokens without sessionVersion.
                nextToken.sessionVersion = dbUser.sessionVersion;
                nextToken.email = dbUser.email;
                nextToken.name = dbUser.name ?? dbUser.email ?? "User";
                return nextToken;
            }

            if (
                nextToken.sessionVersion !== dbUser.sessionVersion
            ) {
                nextToken.invalidated = true;
                return nextToken;
            }

            nextToken.sessionVersion = dbUser.sessionVersion;
            nextToken.email = dbUser.email;
            nextToken.name = dbUser.name ?? dbUser.email ?? "User";
            return nextToken;
        },
        async session({ session, token }) {
            const tokenWithVersion = token as typeof token & TokenWithVersion;
            if (!session.user) {
                return session;
            }

            if (tokenWithVersion.invalidated || !tokenWithVersion.sub) {
                delete (session.user as { id?: string }).id;
                session.user.email = null;
                session.user.name = null;
                session.user.image = null;
                return session;
            }

            (session.user as { id?: string }).id = tokenWithVersion.sub;
            session.user.email = tokenWithVersion.email ?? session.user.email ?? null;
            session.user.name = tokenWithVersion.name ?? session.user.name ?? null;
            return session;
        }
    }
};
