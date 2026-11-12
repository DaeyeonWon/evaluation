import type { Metadata } from "next";
import { forbidden } from "next/navigation";

export const metadata: Metadata = { title: "403" };
export const dynamic = "force-dynamic";

/**
 * /403 — target of src/proxy.ts rewrites for pages the session may not open. Renders the global
 * src/app/forbidden.tsx with HTTP 403.
 */
export default function ForbiddenPage() {
  forbidden();
}
