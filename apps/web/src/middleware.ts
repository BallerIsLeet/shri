import { NextResponse, type NextRequest } from "next/server";
import { verifyCookieToken, verifyBasicAuthHeader, AUTH_COOKIE } from "./lib/auth";

const PUBLIC_PATHS = ["/login", "/api/healthz", "/api/auth/"];

export function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const user = process.env.BASIC_AUTH_USER;
  const pass = process.env.BASIC_AUTH_PASS;
  if (!user || !pass) {
    return new NextResponse("Server auth not configured", { status: 503 });
  }

  const creds = { user, pass };

  // Cookie-based auth (login page flow)
  const cookieToken = req.cookies.get(AUTH_COOKIE)?.value;
  if (verifyCookieToken(cookieToken, creds)) {
    return NextResponse.next();
  }

  // Legacy Basic Auth header (e.g. API clients, curl)
  if (verifyBasicAuthHeader(req.headers.get("authorization"), creds)) {
    return NextResponse.next();
  }

  // Redirect browsers to the login page; pass the original URL as `next`
  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
