import type { Metadata } from "next";
import { AtlasShell } from "@/components/atlas/shell";
import { getT } from "@/i18n/server";
import "@/styles/atlas.css";

export async function generateMetadata(): Promise<Metadata> {
  const [c, s] = await Promise.all([getT("common"), getT("shell")]);
  const name = s("brand.name");
  return {
    title: { default: name, template: `%s · ${name}` },
    description: `${name} — ${c("app.consoleName")} · ${c("app.subtitle")} (${c("app.mockData")})`,
  };
}

export default function AtlasLayout({ children }: LayoutProps<"/">) {
  return (
    <div data-variant="atlas" className="atlas-root font-atlas">
      <AtlasShell>{children}</AtlasShell>
    </div>
  );
}
