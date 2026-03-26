import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { resolveEnterpriseAuthContext } from "@/lib/enterprise-auth";

export const runtime = "nodejs";

export async function GET(req: Request) {
    try {
        const url = new URL(req.url);
        const email = url.searchParams.get("email") || "";
        const tenant = url.searchParams.get("tenant") || "";
        const requestHeaders = await headers();
        const host =
            requestHeaders.get("x-forwarded-host") ||
            requestHeaders.get("host") ||
            url.host ||
            "";

        const auth = await resolveEnterpriseAuthContext({
            email,
            tenantHint: tenant,
            host
        });

        return NextResponse.json({ auth: auth.bootstrap });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to resolve auth bootstrap.";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
