import type { Context, Next } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import { AuthenticationError, getAuthProvider, type AuthenticatedContext } from "../auth/authProvider.ts";
import { recordAudit } from "../db/auditRepository.ts";
import { getAuthMode } from "../auth/config.ts";
import { fail } from "../util/envelope.ts";
import { getRequestId } from "./requestId.ts";

// Type-augment Hono so c.get("ownerId") is typed string instead of unknown.
// Single source of truth for the variable name; route handlers and repositories
// never duplicate the literal.
declare module "hono" {
  interface ContextVariableMap {
    ownerId: string;
    actorId: string;
    authUser: AuthenticatedContext["user"];
    // PAT (piesa A): definite doar pe calea Personal Access Token; undefined pe
    // JWT/desktop -> gate-urile PAT raman no-op.
    tokenScopes: string[] | undefined;
    tokenId: string | undefined;
  }
}

function shouldAuthenticatePath(c: Context): boolean {
  if (getAuthMode() === "desktop") return true;
  if (!c.req.path.startsWith("/api/")) return false;
  // /auth/refresh ramane autentificat in v2.7.x: token expirat => auth.denied
  // si re-login in PR-10, nu grace-window implementat partial in seam-ul curent.
  //
  // /auth/oauth2/sync (v2.31.0) e gate-uit prin shared secret + email lookup in
  // handler-ul propriu — nu poate fi gardat de ownerContext pentru ca *minteste*
  // sesiunea pe care ownerContext o asteapta. Vezi backend/src/routes/auth.ts.
  if (c.req.path === "/api/v1/auth/login") return false;
  if (c.req.path === "/api/v1/auth/logout") return false;
  if (c.req.path === "/api/v1/auth/oauth2/sync") return false;
  return true;
}

function writeAuthError(c: Context, err: AuthenticationError): Response {
  const requestId = getRequestId(c);
  // PR-9 fix B3: foloseste envelope-ul standard fail() ca raspunsul sa contina
  // requestId si sa fie consistent cu /api/v1/* pe toate path-urile API.
  // Logam structurat fara token/cookie body.
  console.warn(
    `[auth.denied] requestId=${requestId} path=${c.req.path} method=${c.req.method} code=${err.code} status=${err.status}`
  );
  try {
    recordAudit(null, "auth.denied", {
      ownerId: null,
      actorId: null,
      outcome: "denied",
      targetKind: "http_request",
      targetId: c.req.path,
      ip: readRemoteIp(c),
      userAgent: c.req.header("user-agent") ?? null,
      detail: {
        requestId,
        method: c.req.method,
        code: err.code,
        status: err.status,
      },
    });
  } catch (auditErr) {
    console.error(`[auth.audit_failed] ${auditErr instanceof Error ? auditErr.message : "unknown"}`);
  }
  return c.json(fail(err.code, err.message, c), err.status);
}

function readRemoteIp(c: Context): string | null {
  try {
    return getConnInfo(c).remote.address ?? null;
  } catch {
    return null;
  }
}

// PR-9 auth seam: desktop stays a noop `local` identity; web mode resolves the
// caller through the configured AuthProvider and fails closed for API calls.
export async function ownerContext(c: Context, next: Next): Promise<Response | undefined> {
  if (!shouldAuthenticatePath(c)) {
    await next();
    return;
  }

  try {
    const authenticated = getAuthProvider().authenticate(c);
    c.set("ownerId", authenticated.ownerId);
    c.set("actorId", authenticated.actorId);
    c.set("authUser", authenticated.user);
    c.set("tokenScopes", authenticated.tokenScopes);
    c.set("tokenId", authenticated.tokenId);
    await next();
  } catch (err) {
    if (err instanceof AuthenticationError) return writeAuthError(c, err);
    throw err;
  }
}

// Helper consumed by routes/repositories. Desktop preserves the historic
// fallback; web mode requires ownerContext to have authenticated the request.
export function getOwnerId(c: Context): string {
  const ownerId = c.get("ownerId");
  if (ownerId) return ownerId;
  if (getAuthMode() === "desktop") return "local";
  throw new Error("ownerId missing from authenticated web request context");
}

export function getActorId(c: Context): string {
  const actorId = c.get("actorId");
  if (actorId) return actorId;
  return getOwnerId(c);
}

export function getAuthUser(c: Context): AuthenticatedContext["user"] {
  return c.get("authUser") ?? null;
}
