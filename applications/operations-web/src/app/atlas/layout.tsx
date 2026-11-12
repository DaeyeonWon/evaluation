import type { Metadata } from "next";
import { AtlasShell } from "@/components/atlas/shell";
import "@/styles/atlas.css";

export const metadata: Metadata = {
  title: { default: "Atlas", template: "%s · Atlas" },
  description: "AIPO Atlas — 빅스비 실발화 평가 오케스트레이션을 설계 도면처럼 보여주는 운영 콘솔 (Mock 데이터).",
};

export default function AtlasLayout({ children }: LayoutProps<"/atlas">) {
  return (
    <div data-variant="atlas" className="atlas-root font-atlas">
      <AtlasShell>{children}</AtlasShell>
    </div>
  );
}
