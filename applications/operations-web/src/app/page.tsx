import type { Metadata } from "next";
import { Landing } from "@/components/landing/landing";
import "@/styles/landing.css";

export const metadata: Metadata = {
  title: { absolute: "AIPO · 빅스비 실발화 평가 운영 콘솔 데모" },
};

/** "/" — concept chooser (foundation-owned). */
export default function Home() {
  return <Landing />;
}
