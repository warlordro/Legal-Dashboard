import type { Context, Next } from "hono";
import {
  AuthenticationError,
  getAuthProvider,
  type AuthenticatedContext,
} from "../auth/authProvider.ts";
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
  }
}

function shouldAuthenticatePath(c: Context): boolean {
  if (getAuthMode() === "desktop") return true;
  if (!c.req.path.startsWith("/api/")) return false;
  return c.req.path !== "/api/v1/auth/login" && c.req.path !== "/api/v1/auth/logout";
}

function writeAuthError(c: Context, err: AuthenticationError): Response {
  // PR-9 fix B3: foloseste envelope-ul standard fail() ca raspunsul sa contina
  // requestId si sa fie consistent cu /api/v1/* pe toate path-urile API.
  // Logam structurat fara token/cookie body.
  console.warn(
    `[auth.denied] requestId=${getRequestId(c)} path=${c.req.path} method=${c.req.method} code=${err.code} status=${err.status}`,
  );
  return c.json(fail(err.code, err.message, c), err.status);
}

// PR-9 auth seam: desktop stays a noop `local` identity; web mode resolves the
// caller through the configured AuthProvider and fails closed for API calls.
export async function ownerContext(c: Context, next: Next): Promise<Response | void> {
  if (!shouldAuthenticatePath(c)) {
    await next();
    return;
  }

  try {
    const authenticated = getAuthProvider().authenticate(c);
    c.set("ownerId", authenticated.ownerId);
    c.set("actorId", authenticated.actorId);
    c.set("authUser", authenticated.user);
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
