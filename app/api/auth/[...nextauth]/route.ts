import NextAuth, { type NextAuthOptions } from "next-auth";
import EmailProvider from "next-auth/providers/email";
import CredentialsProvider from "next-auth/providers/credentials";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import { prisma } from "@/lib/prisma";

const useDevBypass = process.env.NEXTAUTH_DEV_BYPASS === "1";

export const authOptions: NextAuthOptions = {
    adapter: useDevBypass ? undefined : PrismaAdapter(prisma),
    session: {
        strategy: "jwt"
    },
    providers: [
        ...(useDevBypass ? [
            CredentialsProvider({
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
        ] : [
            EmailProvider({
                server: process.env.EMAIL_SERVER,
                from: process.env.EMAIL_FROM
            })
        ])
    ],
    secret: process.env.NEXTAUTH_SECRET,
    pages: {
        signIn: "/login",
        verifyRequest: "/login?verify=1"
    }
};

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
