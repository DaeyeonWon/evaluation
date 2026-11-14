import { NextResponse, type NextRequest } from "next/server";

/** Legacy design-candidate route /issues/c → /issues/analysis (308, query preserved). */
export function GET(req: NextRequest) {
  const url = req.nextUrl.clone();
  url.pathname = "/issues/analysis";
  return NextResponse.redirect(url, 308);
}
