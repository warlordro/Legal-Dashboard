import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { getAuthMode, getJwtAudience, getJwtIssuer, requireJwtSecret, type AuthMode } from "./config.ts";
import { verifyAuthToken, type AuthJwtPayload } from "./jwt.ts";
import { isJtiRevoked } from "../db/jwtDenylistRepository.ts";
import { getUserById, type UserRow } from "../db/userRepository.ts";

export const AUTH_COOKIE_NAME = "legal_dashboard_session";

export interface AuthenticatedContext {
  ownerId: string;
  actorId: string;
  user: UserRow | null;
  tokenPayload?: AuthJwtPayload;
}

interface AuthProvider {
  mode: AuthMode;
  authenticate(c: Context): AuthenticatedContext;
}

export class AuthenticationError extends Error {
  constructor(
    public readonly status: 401 | 403,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "AuthenticationError";
  }
}

function readBearerToken(c: Context): string | null {
  const authorization = c.req.header("authorization");
  if (!authorization) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return match?.[1] ?? null;
}

export function readRequestToken(c: Context): string | null {
  return readBearerToken(c) ?? getCookie(c, AUTH_COOKIE_NAME) ?? null;
}

export class DesktopAuthProvider implements AuthProvider {
  readonly mode = "desktop" as const;

  authenticate(): AuthenticatedContext {
    const user = getUserById("local");
    return {
      ownerId: "local",
      actorId: "local",
      user,
    };
  }
}

export class WebJwtAuthProvider implements AuthProvider {
  readonly mode = "web" as const;

  authenticate(c: Context): AuthenticatedContext {
    const token = readRequestToken(c);
    if (!token) {
      throw new AuthenticationError(401, "unauthorized", "Token de autentificare necesar.");
    }

    let payload: AuthJwtPayload;
    try {
      payload = verifyAuthToken(token, {
        secret: requireJwtSecret(),
        issuer: getJwtIssuer(),
        audience: getJwtAudience(),
      });
    } catch (err) {
      const internalCode =
        err instanceof Error && "code" in err ? String((err as { code: unknown }).code) : "invalid_token";
      console.warn(
        `[auth.jwt_invalid] internalCode=${internalCode} message=${err instanceof Error ? err.message : "unknown"}`
      );
      throw new AuthenticationError(401, "unauthorized", "Token de autentificare invalid.");
    }

    if (payload.jti && isJtiRevoked(payload.jti)) {
      console.warn(`[auth.jwt_revoked] sub=${payload.sub}`);
      throw new AuthenticationError(401, "unauthorized", "Token de autentificare invalid.");
    }

    const user = getUserById(payload.sub);
    if (user === null) {
      console.warn(`[auth.user_denied] internalCode=user_not_found sub=${payload.sub}`);
      throw new AuthenticationError(401, "unauthorized", "Token de autentificare invalid.");
    }
    if (user.status !== "active") {
      console.warn(`[auth.user_denied] internalCode=account_inactive sub=${payload.sub} status=${user.status}`);
      throw new AuthenticationError(401, "unauthorized", "Token de autentificare invalid.");
    }

    return {
      ownerId: user.id,
      actorId: user.id,
      user,
      tokenPayload: payload,
    };
  }
}

export function getAuthProvider(): AuthProvider {
  const mode = getAuthMode();
  return mode === "web" ? new WebJwtAuthProvider() : new DesktopAuthProvider();
}
