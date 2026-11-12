import type { Metadata } from "next";
import { FlowlineShell } from "@/components/flowline/shell";
import "@/styles/flowline.css";

export const metadata: Metadata = {
  title: { default: "Flowline 관제", template: "%s · Flowline" },
  description: "빅스비 실발화 평가 파이프라인 관제 콘솔 (Flowline) — 앱 내장 Mock API · 시뮬레이터로 동작합니다.",
};

export default function FlowlineLayout({ children }: LayoutProps<"/flowline">) {
  return (
    <div data-variant="flowline" className="flowline-root font-flowline">
      <FlowlineShell>{children}</FlowlineShell>
    </div>
  );
}
