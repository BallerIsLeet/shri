import { NextResponse, type NextRequest } from "next/server";
import { basicAuthChallenge, verifyBasicAuthHeader } from "./lib/auth";

// Single-user basic-auth gate. /api/healthz is the only public path.
// See docs/09-web-app.md "Basic auth middleware".

export function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;

  // Healthz stays public so Railway's healthcheck can hit it without creds.
  if (pathname.startsWith("/api/healthz")) {
    return NextResponse.next();
  }

  const user = process.env.BASIC_AUTH_USER;
  const pass = process.env.BASIC_AUTH_PASS;
  if (!user || !pass) {
    // Fail closed: if either is absent the server can't authenticate anyone.
    // Middleware can't throw without breaking every request, so 503.
    return new NextResponse("Server auth not configured", { status: 503 });
  }

  if (verifyBasicAuthHeader(req.headers.get("authorization"), { user, pass })) {
    return NextResponse.next();
  }

  const challenge = basicAuthChallenge();
  return new NextResponse(challenge.body, {
    status: challenge.status,
    headers: challenge.headers,
  });
}

export const config = {
  // Skip Next internals + favicon. Everything else (pages + API routes) is gated.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
