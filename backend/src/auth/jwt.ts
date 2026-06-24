import { createHmac, timingSafeEqual } from "node:crypto";

export interface AuthJwtPayload {
  sub: string;
  jti?: string;
  email?: string;
  name?: string;
  exp: number;
  iat?: number;
  nbf?: number;
  iss?: string;
  aud?: string;
}

export class AuthTokenError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "AuthTokenError";
  }
}

function base64UrlEncode(input: string | Buffer): string {
  return Buffer.from(input).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function base64UrlDecode(input: string): Buffer {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Buffer.from(padded, "base64");
}

function hmac(data: string, secret: string): string {
  return base64UrlEncode(createHmac("sha256", secret).update(data).digest());
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function parseJsonPart<T>(part: string, code: string): T {
  try {
    return JSON.parse(base64UrlDecode(part).toString("utf8")) as T;
  } catch {
    throw new AuthTokenError(code, "Malformed token.");
  }
}

export function signAuthToken(payload: AuthJwtPayload, secret: string): string {
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  return `${signingInput}.${hmac(signingInput, secret)}`;
}

export function verifyAuthToken(
  token: string,
  opts: {
    secret: string;
    nowSeconds?: number;
    issuer?: string | null;
    audience?: string | null;
  }
): AuthJwtPayload {
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
    throw new AuthTokenError("invalid_token", "Malformed token.");
  }

  const [encodedHeader, encodedPayload, signature] = parts;
  const header = parseJsonPart<{ alg?: string; typ?: string }>(encodedHeader, "invalid_header");
  if (header.alg !== "HS256") {
    throw new AuthTokenError("unsupported_alg", "Unsupported token algorithm.");
  }

  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const expected = hmac(signingInput, opts.secret);
  if (!safeEqual(signature, expected)) {
    throw new AuthTokenError("invalid_signature", "Invalid token signature.");
  }

  const payload = parseJsonPart<AuthJwtPayload>(encodedPayload, "invalid_payload");
  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (!payload.sub || typeof payload.sub !== "string") {
    throw new AuthTokenError("missing_subject", "Token subject is missing.");
  }
  if (typeof payload.exp !== "number" || payload.exp <= now) {
    throw new AuthTokenError("token_expired", "Token is expired.");
  }
  if (typeof payload.nbf === "number" && payload.nbf > now) {
    throw new AuthTokenError("token_not_active", "Token is not active yet.");
  }
  if (opts.issuer && payload.iss !== opts.issuer) {
    throw new AuthTokenError("issuer_mismatch", "Token issuer mismatch.");
  }
  if (opts.audience && payload.aud !== opts.audience) {
    throw new AuthTokenError("audience_mismatch", "Token audience mismatch.");
  }

  return payload;
}
