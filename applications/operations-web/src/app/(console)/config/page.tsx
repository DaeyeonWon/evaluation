import type { Metadata } from "next";
import { Suspense } from "react";
import { ConfigScreen } from "@/components/atlas/config";

export const metadata: Metadata = { title: "설정" };

export default function Page() {
  return (
    <Suspense>
      <ConfigScreen />
    </Suspense>
  );
}
