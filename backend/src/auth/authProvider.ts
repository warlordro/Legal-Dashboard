import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { getAuthMode, getJwtAudience, getJwtIssuer, requireJwtSecret, type AuthMode } from "./config.ts";
import { verifyAuthToken, type AuthJwtPayload } from "./jwt.ts";
import { recordAudit } from "../db/auditRepository.ts";
import { isJtiRevoked } from "../db/jwtDenylistRepository.ts";
import { getUserById, type UserRow } from "../db/userRepository.ts";
import { getRequestId } from "../middleware/requestId.ts";
import { resolvePatContext } from "./patProvider.ts";
import { TOKEN_PREFIX } from "../db/apiTokenRepository.ts";

export const AUTH_COOKIE_NAME = "legal_dashboard_session";

export interface AuthenticatedContext {
  ownerId: string;
  actorId: string;
  user: UserRow | null;
  tokenPayload?: AuthJwtPayload;
  // PAT (piesa A): setate doar pe calea Personal Access Token. Pe JWT/desktop
  // raman undefined -> toate gate-urile PAT noi sunt no-op.
  tokenScopes?: string[];
  tokenId?: string;
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

    // PAT dispatch (piesa A): un `ld_pat_` cade pe calea PAT in web mode. Guard pe
    // getAuthMode()==="web" (belt-and-suspenders: aceasta clasa ruleaza doar in web,
    // dar guard-ul face desktop zero-impact deterministic — ZERO apeluri DB). Kill
    // switch operational LEGAL_DASHBOARD_PAT_DISABLED=1 il scoate per-request (cade pe
    // calea JWT si esueaza 401 normal). getAuthMode importat mai sus.
    //
    // runda 4 (hardening): dispecerizeaza PAT DOAR din `Authorization: Bearer`, NU din cookie.
    // Un `ld_pat_` strecurat in cookie ar deveni credential AMBIENT si ar ocoli originGuard
    // (care face bypass pe tokenId) -> CSRF. Cookie-ul ramane exclusiv pentru sesiuni JWT: un
    // ld_pat_ in cookie cade pe verificarea JWT si esueaza 401.
    const bearer = readBearerToken(c);
    if (
      getAuthMode() === "web" &&
      bearer?.startsWith(TOKEN_PREFIX) &&
      process.env.LEGAL_DASHBOARD_PAT_DISABLED !== "1"
    ) {
      return resolvePatContext(c, bearer);
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
      // Best-effort durable audit: replay of a revoked token is a
      // security-relevant event. Wrapped in its own try/catch so a failed audit
      // write NEVER changes the auth outcome — the replay is still rejected
      // below. Attribution extracted by hand (this seam runs before
      // ownerContext, so passing `c` would make getOwnerId(c) throw). CP-12.
      let ip: string | null = null;
      try {
        ip = getConnInfo(c).remote.address ?? null;
      } catch {
        ip = null;
      }
      const userAgent = c.req.header("user-agent") ?? null;
      const requestId = getRequestId(c) || null;
      try {
        recordAudit(null, "auth.jwt_revoked", {
          outcome: "denied",
          targetKind: "http_request",
          targetId: c.req.path,
          ip,
          userAgent,
          requestId,
          detail: { jti: payload.jti },
        });
      } catch (err) {
        console.error("[auth] auth.jwt_revoked audit failed:", err);
      }
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
