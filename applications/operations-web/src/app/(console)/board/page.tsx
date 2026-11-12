import type { Metadata } from "next";
import { Suspense } from "react";
import { BoardScreen } from "@/components/atlas/board/board";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("board");
  return { title: t("title"), description: t("desc") };
}

export default function Page() {
  return (
    <Suspense>
      <BoardScreen />
    </Suspense>
  );
}
