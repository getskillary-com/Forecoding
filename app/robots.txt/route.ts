import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const DEFAULT_SITE_ORIGIN = "https://forecoding.com";

function resolveRequestOrigin(request: NextRequest): string {
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("host")?.split(",")[0]?.trim();
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const requestProtocol = request.nextUrl.protocol.replace(/:$/, "");
  const protocol = forwardedProto || requestProtocol || "https";

  if (!host) {
    return DEFAULT_SITE_ORIGIN;
  }

  return `${protocol}://${host}`;
}

export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  const origin = resolveRequestOrigin(request);
  const sitemapUrl = new URL("/sitemap.xml", origin).toString();
  const body = [`User-agent: *`, `Allow: /`, `Sitemap: ${sitemapUrl}`].join("\n");

  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=3600",
    },
  });
}
