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
 *   src/proxy.ts still runs first (auth + RBAC) and forwards identity as x-console-user-* headers.
 * - output "standalone": .next/standalone/server.js for the Docker image (see Dockerfile).
 * - experimental.authInterrupts: enables forbidden() (403 UI in src/app/forbidden.tsx).
 */
const upstream = process.env.OPERATIONS_API_URL?.replace(/\/+$/, "");

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  output: "standalone",
  experimental: {
    authInterrupts: true,
  },
  compress: false,
  reactStrictMode: true,
  poweredByHeader: false,
  async rewrites() {
    if (!upstream) return [];
    // /api/v1/auth/** (session cookie, role config) always stays local; everything else goes upstream.
    return {
      beforeFiles: [{ source: "/api/v1/:path((?!auth(?:/|$)).*)", destination: `${upstream}/:path` }],
      afterFiles: [],
      fallback: [],
    };
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
