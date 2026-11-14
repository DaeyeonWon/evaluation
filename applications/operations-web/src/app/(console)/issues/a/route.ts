import { NextResponse, type NextRequest } from "next/server";

/** Legacy design-candidate route /issues/a → /issues (308, query preserved). */
export function GET(req: NextRequest) {
  const url = req.nextUrl.clone();
  url.pathname = "/issues";
  return NextResponse.redirect(url, 308);
}
