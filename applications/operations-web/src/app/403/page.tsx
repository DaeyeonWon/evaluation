import type { Metadata } from "next";
import { forbidden } from "next/navigation";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("auth");
  return { title: t("forbidden.metaTitle") };
}
export const dynamic = "force-dynamic";

/**
 * /403 — target of src/proxy.ts rewrites for pages the session may not open. Renders the global
 * src/app/forbidden.tsx with HTTP 403.
 */
export default function ForbiddenPage() {
  forbidden();
}
