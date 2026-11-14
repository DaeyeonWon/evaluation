import { NextResponse, type NextRequest } from "next/server";

/** Legacy design-candidate route /issues/b → /issues/report (308, query preserved). */
export function GET(req: NextRequest) {
  const url = req.nextUrl.clone();
  url.pathname = "/issues/report";
  return NextResponse.redirect(url, 308);
}
