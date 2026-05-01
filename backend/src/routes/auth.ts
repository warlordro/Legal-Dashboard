import type { Context } from "hono";
import { Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { AUTH_COOKIE_NAME } from "../auth/authProvider.ts";
import {
  getAuthMode,
  getJwtAudience,
  getJwtIssuer,
  getTokenTtlSeconds,
  requireJwtSecret,
} from "../auth/config.ts";
import { signAuthToken } from "../auth/jwt.ts";
import { recordAudit } from "../db/auditRepository.ts";
import { getAuthUser } from "../middleware/owner.ts";
import { fail, ok } from "../util/envelope.ts";

export const authRouter = new Hono();

function secureCookie(): boolean {
  if (process.env.LEGAL_DASHBOARD_AUTH_COOKIE_SECURE === "0") return false;
  return getAuthMode() === "web";
}

function writeSessionCookie(c: Context, token: string, maxAge: number): void {
  setCookie(c, AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: secureCookie(),
    sameSite: "Lax",
    path: "/",
    maxAge,
  });
}

authRouter.post("/login", (c) => {
  return c.json(
    fail(
      "auth_provider_not_configured",
      "Login-ul real SSO/OAuth este intentionat in afara acestui PR auth-pluggable.",
      c,
    ),
    501,
  );
});

authRouter.post("/logout", (c) => {
  deleteCookie(c, AUTH_COOKIE_NAME, {
    secure: secureCookie(),
    sameSite: "Lax",
    path: "/",
  });
  return c.json(ok({ loggedOut: true }, c), 200);
});

authRouter.post("/refresh", (c) => {
  if (getAuthMode() === "desktop") {
    return c.json(ok({ mode: "desktop", refreshed: false }, c), 200);
  }

  const user = getAuthUser(c);
  if (user === null) {
    return c.json(fail("unauthorized", "Utilizator inexistent", c), 401);
  }

  const now = Math.floor(Date.now() / 1000);
  const ttl = getTokenTtlSeconds();
  const issuer = getJwtIssuer();
  const audience = getJwtAudience();
  const payload = {
    sub: user.id,
    email: user.email,
    name: user.display_name,
    iat: now,
    exp: now + ttl,
    ...(issuer ? { iss: issuer } : {}),
    ...(audience ? { aud: audience } : {}),
  };
  const token = signAuthToken(payload, requireJwtSecret());
  writeSessionCookie(c, token, ttl);
  recordAudit(c, "auth.refresh", {
    targetKind: "user",
    targetId: user.id,
    detail: { mode: "web" },
  });
  return c.json(ok({ mode: "web", refreshed: true, expiresAt: payload.exp }, c), 200);
});
