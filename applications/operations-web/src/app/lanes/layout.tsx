import type { Metadata } from "next";
import "@/styles/lanes.css";
import { LanesShell } from "@/components/lanes/shell";

export const metadata: Metadata = {
  title: { default: "Lanes", template: "%s · Lanes" },
  description: "AIPO Lanes — 언어 레인 스케줄러 보드 (빅스비 실발화 평가 운영 콘솔, Mock 데이터)",
};

export default function LanesLayout({ children }: LayoutProps<"/lanes">) {
  return (
    <div data-variant="lanes" className="lanes-root font-lanes">
      <LanesShell>{children}</LanesShell>
    </div>
  );
}
