import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const DEFAULT_SITE_ORIGIN = "https://forecoding.com";
const PUBLIC_SITEMAP_PATHS = ["/", "/demo", "/privacy", "/terms", "/refund", "/cookie"];

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

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  const origin = resolveRequestOrigin(request);
  const urls = PUBLIC_SITEMAP_PATHS.map((path) => {
    const loc = escapeXml(new URL(path, origin).toString());
    return `  <url><loc>${loc}</loc></url>`;
  }).join("\n");

  const body = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
    urls,
    `</urlset>`,
  ].join("\n");

  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=3600",
    },
  });
}
