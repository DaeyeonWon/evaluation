import type { Metadata } from "next";
import { Suspense } from "react";
import { CanvasScreen } from "@/components/atlas/canvas/canvas";

export const metadata: Metadata = { title: "오케스트레이션" };

export default function Page() {
  return (
    <Suspense>
      <CanvasScreen />
    </Suspense>
  );
}
