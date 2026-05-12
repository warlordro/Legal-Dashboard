import { describe, expect, it } from "vitest";
import { AuthTokenError, signAuthToken, verifyAuthToken } from "./jwt.ts";

const SECRET = "0123456789abcdef0123456789abcdef";

function base64Url(input: unknown): string {
  return Buffer.from(JSON.stringify(input))
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function expectTokenCode(fn: () => unknown, code: string): void {
  try {
    fn();
    throw new Error("expected token verification to fail");
  } catch (err) {
    expect(err).toBeInstanceOf(AuthTokenError);
    expect((err as AuthTokenError).code).toBe(code);
  }
}

describe("auth jwt", () => {
  it("verifies a valid HS256 token", () => {
    const token = signAuthToken(
      { sub: "alice", email: "alice@example.test", iat: 10, exp: 100, iss: "ld", aud: "web" },
      SECRET
    );

    const payload = verifyAuthToken(token, {
      secret: SECRET,
      nowSeconds: 50,
      issuer: "ld",
      audience: "web",
    });

    expect(payload.sub).toBe("alice");
    expect(payload.email).toBe("alice@example.test");
  });

  it("rejects tampered signatures", () => {
    const token = signAuthToken({ sub: "alice", exp: 100 }, SECRET);
    const parts = token.split(".");
    const tampered = `${parts[0]}.${parts[1]}.bad${parts[2].slice(3)}`;

    expect(() => verifyAuthToken(tampered, { secret: SECRET, nowSeconds: 50 })).toThrow(/signature/i);
  });

  it("rejects expired tokens", () => {
    const token = signAuthToken({ sub: "alice", exp: 100 }, SECRET);

    expect(() => verifyAuthToken(token, { secret: SECRET, nowSeconds: 101 })).toThrow(/expired/i);
  });

  it("rejects issuer and audience mismatches", () => {
    const token = signAuthToken({ sub: "alice", exp: 100, iss: "ld", aud: "web" }, SECRET);

    expect(() => verifyAuthToken(token, { secret: SECRET, nowSeconds: 50, issuer: "other" })).toThrow(/issuer/i);
    expect(() => verifyAuthToken(token, { secret: SECRET, nowSeconds: 50, audience: "other" })).toThrow(/audience/i);
  });

  it("rejects malformed tokens without three JWT parts", () => {
    expectTokenCode(() => verifyAuthToken("not-a-jwt", { secret: SECRET, nowSeconds: 50 }), "invalid_token");
  });

  it("rejects alg=none tokens before signature validation", () => {
    const token = `${base64Url({ alg: "none", typ: "JWT" })}.${base64Url({
      sub: "alice",
      exp: 100,
    })}.signature`;

    expectTokenCode(() => verifyAuthToken(token, { secret: SECRET, nowSeconds: 50 }), "unsupported_alg");
  });

  it("rejects payloads without a subject", () => {
    const token = signAuthToken({ exp: 100 } as Parameters<typeof signAuthToken>[0], SECRET);

    expectTokenCode(() => verifyAuthToken(token, { secret: SECRET, nowSeconds: 50 }), "missing_subject");
  });

  it("rejects payloads with missing or non-number exp", () => {
    const missingExp = signAuthToken({ sub: "alice" } as Parameters<typeof signAuthToken>[0], SECRET);
    const stringExp = signAuthToken(
      { sub: "alice", exp: "100" } as unknown as Parameters<typeof signAuthToken>[0],
      SECRET
    );

    expectTokenCode(() => verifyAuthToken(missingExp, { secret: SECRET, nowSeconds: 50 }), "token_expired");
    expectTokenCode(() => verifyAuthToken(stringExp, { secret: SECRET, nowSeconds: 50 }), "token_expired");
  });

  it("rejects tokens with nbf in the future beyond clock skew", () => {
    const token = signAuthToken({ sub: "alice", exp: 100, nbf: 56 }, SECRET);

    expectTokenCode(() => verifyAuthToken(token, { secret: SECRET, nowSeconds: 50 }), "token_not_active");
  });
});
