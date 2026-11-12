import type { NextConfig } from "next";

/**
 * AIPO Operations Web — shared Next.js config.
 *
 * - distDir is env-driven so several `next dev` servers (one per design variant)
 *   can run side by side without clobbering each other's build output:
 *     NEXT_DIST_DIR=.next-flowline npx next dev -p 3101
 * - compress is off so Server-Sent Events (/api/v1/stream) are flushed immediately.
 * - OPERATIONS_API_URL (optional, e.g. https://ops.internal.example/api/v1): when set, every
 *   /api/v1/* request is proxied server-side to the real FastAPI Operations API via a
 *   `beforeFiles` rewrite, which takes precedence over the built-in mock route handlers.
 *   Unset (default) → the internal mock API answers. Evaluated at build time.
 */
const upstream = process.env.OPERATIONS_API_URL?.replace(/\/+$/, "");

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  compress: false,
  reactStrictMode: true,
  poweredByHeader: false,
  async rewrites() {
    if (!upstream) return [];
    return { beforeFiles: [{ source: "/api/v1/:path*", destination: `${upstream}/:path*` }], afterFiles: [], fallback: [] };
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
