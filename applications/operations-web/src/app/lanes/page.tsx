import type { Metadata } from "next";
import { Suspense } from "react";
import { BoardScreen } from "@/components/lanes/board";

export const metadata: Metadata = { title: "오케스트레이션 보드" };

export default function LanesBoardPage() {
  return (
    <Suspense fallback={<div className="skel" style={{ height: 480 }} />}>
      <BoardScreen />
    </Suspense>
  );
}
