import { describe, it, expect } from "vitest";
import {
  encodeBasicAuthHeader,
  verifyBasicAuthHeader,
  basicAuthChallenge,
} from "../src/lib/auth";

describe("basic auth helpers", () => {
  const creds = { user: "alice", pass: "secret" };

  it("encodeBasicAuthHeader produces the standard format", () => {
    const header = encodeBasicAuthHeader(creds);
    expect(header.startsWith("Basic ")).toBe(true);
    const decoded = Buffer.from(header.slice("Basic ".length), "base64").toString(
      "utf8",
    );
    expect(decoded).toBe("alice:secret");
  });

  it("verifyBasicAuthHeader accepts the correct header", () => {
    const header = encodeBasicAuthHeader(creds);
    expect(verifyBasicAuthHeader(header, creds)).toBe(true);
  });

  it("verifyBasicAuthHeader rejects wrong creds", () => {
    const header = encodeBasicAuthHeader({ user: "alice", pass: "wrong" });
    expect(verifyBasicAuthHeader(header, creds)).toBe(false);
  });

  it("verifyBasicAuthHeader rejects missing / malformed headers", () => {
    expect(verifyBasicAuthHeader(null, creds)).toBe(false);
    expect(verifyBasicAuthHeader(undefined, creds)).toBe(false);
    expect(verifyBasicAuthHeader("Bearer xxx", creds)).toBe(false);
    expect(verifyBasicAuthHeader("Basic " + Buffer.from("nope").toString("base64"), creds)).toBe(false);
  });

  it("basicAuthChallenge returns a 401 WWW-Authenticate response", () => {
    const c = basicAuthChallenge();
    expect(c.status).toBe(401);
    expect(c.headers["WWW-Authenticate"]).toMatch(/Basic/i);
    expect(c.body).toMatch(/auth/i);
  });
});
