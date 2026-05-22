// Basic-auth helpers. Single-user app: one canonical {user, pass} pair lives in
// env. We compare on every request via the middleware. See docs/09-web-app.md
// "Basic auth middleware".

export type BasicAuthCreds = {
  user: string;
  pass: string;
};

/** Read BASIC_AUTH_USER / BASIC_AUTH_PASS from the environment. Throws if either is unset. */
export function readBasicAuthEnv(): BasicAuthCreds {
  const user = process.env.BASIC_AUTH_USER;
  const pass = process.env.BASIC_AUTH_PASS;
  if (!user || !pass) {
    throw new Error(
      "@shri/web: BASIC_AUTH_USER and BASIC_AUTH_PASS must both be set in env.",
    );
  }
  return { user, pass };
}

/** Build the "Basic <base64>" header value the client would send to authenticate. */
export function encodeBasicAuthHeader(creds: BasicAuthCreds): string {
  // Edge-runtime safe: btoa exists in both Node 18+ and the Edge runtime.
  const raw = `${creds.user}:${creds.pass}`;
  // Buffer when available, btoa fallback for edge.
  if (typeof Buffer !== "undefined") {
    return `Basic ${Buffer.from(raw, "utf8").toString("base64")}`;
  }
  return `Basic ${btoa(raw)}`;
}

/** Validate an Authorization header value against the configured creds. */
export function verifyBasicAuthHeader(
  header: string | null | undefined,
  creds: BasicAuthCreds,
): boolean {
  if (!header || !header.toLowerCase().startsWith("basic ")) return false;
  const expected = encodeBasicAuthHeader(creds);
  // Constant-ish-time compare — short strings, single user; this is enough.
  if (header.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < header.length; i++) {
    diff |= header.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

/** WWW-Authenticate response body + headers for a 401 challenge. */
export function basicAuthChallenge(): {
  status: number;
  body: string;
  headers: Record<string, string>;
} {
  return {
    status: 401,
    body: "Auth required",
    headers: {
      "WWW-Authenticate": 'Basic realm="shri"',
      "Content-Type": "text/plain",
    },
  };
}
