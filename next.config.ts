import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  async headers() {
    return [
      {
        source:
          "/(favicon\\.ico|favicon-16x16\\.png|favicon-32x32\\.png|favicon-48x48\\.png|apple-touch-icon\\.png|icon-192\\.png|icon-512\\.png|site\\.webmanifest)",
        headers: [
          { key: "Cache-Control", value: "no-store, max-age=0" }
        ]
      }
    ];
  }
};

export default nextConfig;
