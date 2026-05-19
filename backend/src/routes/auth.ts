import { createHash, timingSafeEqual } from "node:crypto";
import type { Context } from "hono";
import { Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { AUTH_COOKIE_NAME } from "../auth/authProvider.ts";
import {
  getAuthMode,
  getJwtAudience,
  getJwtIssuer,
  getOAuth2ProxySharedSecret,
  getTokenTtlSeconds,
  isAuthCookieSecureDisabled,
  requireJwtSecret,
} from "../auth/config.ts";
import { signAuthToken } from "../auth/jwt.ts";
import { recordAudit } from "../db/auditRepository.ts";
import { getUserByEmail } from "../db/userRepository.ts";
import { getAuthUser } from "../middleware/owner.ts";
import { fail, ok } from "../util/envelope.ts";

export const authRouter = new Hono();

function secureCookie(): boolean {
  if (isAuthCookieSecureDisabled()) return false;
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
      "not_implemented",
      "Login first-party nu este livrat. In modul web tokenele JWT trebuie provisionate extern (IdP/SSO) si trimise prin cookie auth standard.",
      c
    ),
    501
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

// `/api/v1/auth/oauth2/sync` — bridge endpoint EXCLUSIV pentru deploy-ul
// productie cu sidecar oauth2-proxy (deploy/docker-compose.prod.yml).
//
// Flow: oauth2-proxy verifica sesiunea Google OAuth, apoi face proxy catre
// backend cu header-ele `X-Auth-Request-Email` + `X-Proxy-Auth: <shared secret>`.
// Bridge-ul valideaza shared secret-ul (timing-safe), cauta user-ul dupa email
// in tabela `users` si mintea JWT-ul HS256 nativ. Asa, restul backend-ului
// pastreaza SINGURA cale de auth (authProvider.ts) — toate request-urile
// ulterioare folosesc cookie-ul `legal_dashboard_session` cu JWT semnat de noi.
//
// Securitate:
//  - Shared secret >=32 chars in env `LEGAL_DASHBOARD_OAUTH2_PROXY_SECRET`. Daca
//    lipseste, endpoint-ul raspunde 503 (bridge_disabled) — nu pretinde ca
//    accepta orice header.
//  - timingSafeEqual pe shared secret (rezistent la timing attacks).
//  - User MUST exista in DB cu status="active". Nu provisionam useri pe loc.
//    Adminul foloseste `scripts/seed-admin.mjs` la primul boot, apoi creeaza
//    useri din UI-ul `/admin/users` (PR-8).
//  - Audit log primeste DOAR `emailHash` (SHA-256 prefix 16 hex) pe refuzuri,
//    NICIODATA email plaintext, NICIODATA continut header. La succes loggeaza
//    `targetId = user.id` (UUID-ul intern, nu identifiable info).
//  - Cookie-ul folosit pentru sesiune e identic cu cel de la `/auth/refresh`:
//    HttpOnly, Secure (in productie), SameSite=Lax, Path=/.
function hashEmail(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 16);
}

function constantTimeStringEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

authRouter.post("/oauth2/sync", (c) => {
  if (getAuthMode() !== "web") {
    return c.json(fail("desktop_only", "Bridge oauth2-proxy nu este disponibil in mod desktop.", c), 400);
  }

  const expected = getOAuth2ProxySharedSecret();
  if (expected === null) {
    return c.json(fail("bridge_disabled", "Bridge oauth2-proxy neconfigurat.", c), 503);
  }

  const provided = c.req.header("x-proxy-auth") ?? "";
  if (!constantTimeStringEquals(expected, provided)) {
    recordAudit(null, "auth.oauth2.sync", {
      outcome: "denied",
      targetKind: "http_request",
      targetId: c.req.path,
      detail: { reason: "bad_proxy_secret" },
    });
    return c.json(fail("forbidden", "Acces interzis.", c), 403);
  }

  const rawEmail = c.req.header("x-auth-request-email") ?? c.req.header("x-forwarded-email") ?? "";
  const email = rawEmail.trim().toLowerCase();
  if (!email || !email.includes("@") || email.length > 254) {
    recordAudit(null, "auth.oauth2.sync", {
      outcome: "denied",
      targetKind: "http_request",
      targetId: c.req.path,
      detail: { reason: "missing_identity" },
    });
    return c.json(fail("missing_identity", "Identitate lipsa in header-ele proxy.", c), 400);
  }

  const user = getUserByEmail(email);
  if (user === null) {
    recordAudit(null, "auth.oauth2.sync", {
      outcome: "denied",
      targetKind: "http_request",
      targetId: c.req.path,
      detail: { reason: "user_not_provisioned", emailHash: hashEmail(email) },
    });
    return c.json(
      fail(
        "not_provisioned",
        "Contul nu este configurat. Contacteaza adminul pentru a fi adaugat in lista de utilizatori.",
        c
      ),
      403
    );
  }
  if (user.status !== "active") {
    recordAudit(null, "auth.oauth2.sync", {
      outcome: "denied",
      ownerId: user.id,
      targetKind: "user",
      targetId: user.id,
      detail: { reason: "user_inactive", status: user.status },
    });
    return c.json(fail("account_inactive", "Contul este inactiv sau suspendat.", c), 403);
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
  recordAudit(null, "auth.oauth2.sync", {
    outcome: "ok",
    ownerId: user.id,
    actorId: user.id,
    targetKind: "user",
    targetId: user.id,
    detail: { mode: "web" },
  });
  return c.json(
    ok(
      {
        mode: "web",
        refreshed: true,
        expiresAt: payload.exp,
        user: { id: user.id, email: user.email, displayName: user.display_name, role: user.role },
      },
      c
    ),
    200
  );
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
