import { NextResponse } from "next/server";
import { verifyBasicAuthHeader, encodeBasicAuthHeader, makeCookieToken, AUTH_COOKIE } from "@/lib/auth";

export async function POST(req: Request): Promise<NextResponse> {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.user !== "string" || typeof body.pass !== "string") {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const envUser = process.env.BASIC_AUTH_USER;
  const envPass = process.env.BASIC_AUTH_PASS;
  if (!envUser || !envPass) {
    return NextResponse.json({ error: "Server not configured" }, { status: 503 });
  }

  const header = encodeBasicAuthHeader({ user: body.user, pass: body.pass });
  if (!verifyBasicAuthHeader(header, { user: envUser, pass: envPass })) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const token = makeCookieToken({ user: envUser, pass: envPass });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    // secure in production
    secure: process.env.NODE_ENV === "production",
  });
  return res;
}
