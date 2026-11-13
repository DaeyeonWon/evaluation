import type { Metadata } from "next";
import { getT } from "@/i18n/server";
import Forbidden from "../forbidden";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("auth");
  return { title: t("forbidden.metaTitle"), robots: { index: false, follow: false } };
}
export const dynamic = "force-dynamic";

/**
 * /403 — target of src/proxy.ts rewrites (sent with HTTP 403) for pages the session may not open,
 * e.g. /hermes without `hermes:access`. It renders the same UI as src/app/forbidden.tsx but as a
 * normal server-rendered page: calling forbidden() here would make Next serve its client-rendered
 * error shell (`<html id="__next_error__">`), which has no server HTML, so the theme could not be
 * applied before first paint. forbidden.tsx still handles forbidden() thrown by pages themselves.
 */
export default function ForbiddenPage() {
  return <Forbidden />;
}
