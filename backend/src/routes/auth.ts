import { randomUUID, timingSafeEqual } from "node:crypto";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";
import { Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { AUTH_COOKIE_NAME, readRequestToken } from "../auth/authProvider.ts";
import {
  getAuthMode,
  getJwtAudience,
  getJwtIssuer,
  getOAuth2ProxySharedSecret,
  getTokenTtlSeconds,
  isAuthCookieSecureDisabled,
  requireJwtSecret,
} from "../auth/config.ts";
import { signAuthToken, verifyAuthToken } from "../auth/jwt.ts";
import { recordAudit } from "../db/auditRepository.ts";
import { revokeJti } from "../db/jwtDenylistRepository.ts";
import { canonicalizeEmail, getUserByEmail, getUserById } from "../db/userRepository.ts";
import { getAuthUser } from "../middleware/owner.ts";
import { getRequestId } from "../middleware/requestId.ts";
import { hashEmail } from "../util/auditSanitize.ts";
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
    sameSite: "Strict",
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
  const rawToken = readRequestToken(c);
  let auditOwnerId: string | null = null;
  let auditActorId: string | null = null;
  let tokenVerified = false;
  let jtiPresent = false;
  let revokeSucceeded = false;
  try {
    if (rawToken) {
      const payload = verifyAuthToken(rawToken, {
        secret: requireJwtSecret(),
        issuer: getJwtIssuer(),
        audience: getJwtAudience(),
      });
      jtiPresent = Boolean(payload.jti);
      const user = getUserById(payload.sub);
      if (user && user.status === "active") {
        auditOwnerId = user.id;
        auditActorId = user.id;
        tokenVerified = true;
        if (payload.jti && typeof payload.exp === "number") {
          try {
            revokeJti(payload.jti, payload.exp, user.id);
            revokeSucceeded = true;
          } catch (err) {
            // Best-effort: logout still succeeds (cookie cleared below, token
            // expires at TTL), but a failed denylist write is security-relevant
            // and must be observable — not swallowed by the outer verify catch
            // (which would also mislabel the audit as tokenVerified=false). CP-12.
            console.error("[auth.logout] revokeJti failed — token NOT revoked server-side", {
              sub: payload.sub,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        } else if (!payload.jti) {
          // Pre-v2.38.0 tokens carry no jti, so there is nothing to denylist —
          // server-side revocation is impossible and we fall back to TTL expiry.
          // Observable so a flood of these signals stale clients still in flight.
          console.warn("[auth.logout] token lacks jti — cannot revoke server-side; relies on TTL expiry");
        }
      }
    }
  } catch {
    tokenVerified = false;
  }
  // Attribution must be extracted explicitly: this route is excluded from
  // ownerContext (owner.ts), so passing `c` as recordAudit's first arg would
  // make getOwnerId(c) throw in web mode. Pull ip/userAgent/requestId by hand.
  let ip: string | null = null;
  try {
    ip = getConnInfo(c).remote.address ?? null;
  } catch {
    ip = null;
  }
  const userAgent = c.req.header("user-agent") ?? null;
  const requestId = getRequestId(c) || null;
  try {
    recordAudit(null, "auth.logout", {
      ownerId: auditOwnerId,
      actorId: auditActorId,
      targetKind: auditOwnerId ? "user" : "http_request",
      targetId: auditOwnerId ?? c.req.path,
      ip,
      userAgent,
      requestId,
      detail: {
        triggered: "user_request",
        tokenPresent: Boolean(rawToken),
        tokenVerified,
        jtiPresent,
        revokeSucceeded,
      },
    });
  } catch (err) {
    console.error("[auth] auth.logout audit failed:", err);
  }
  deleteCookie(c, AUTH_COOKIE_NAME, {
    secure: secureCookie(),
    sameSite: "Strict",
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
//    HttpOnly, Secure (in productie), SameSite=Strict, Path=/.
//    SameSite=Strict e sigur aici: cookie-ul e consumat doar de fetch-uri
//    same-origin din SPA; sync-ul oauth2-proxy e server-to-server (header-e);
//    emailurile de alerta folosesc deep-link `legal-dashboard://` (protocol
//    custom Electron), nu un GET cross-site catre originea web.
function constantTimeStringEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

// Fix 2026-07-02: OAUTH2_PROXY_INJECT_REQUEST_HEADERS nu exista ca flag in
// oauth2-proxy v7.7.1 (verificat direct din `oauth2-proxy --help` in container
// — absent din output). Mecanismul original cu X-Proxy-Auth injectat de
// oauth2-proxy nu a functionat NICIODATA in productie (niciun request real nu
// a trecut de acest check). Mecanismul real, standard oauth2-proxy pentru a
// trece un secret static la upstream e `--pass-basic-auth` (default true) +
// `--basic-auth-password`, care seteaza `Authorization: Basic
// base64(user:secret)`. Acceptam secretul din ORICARE sursa (X-Proxy-Auth
// ramane valid daca cineva il configureaza corect pe viitor via alpha-config;
// Authorization:Basic e calea care functioneaza cu env vars simple).
function extractBasicAuthPassword(c: Context): string | null {
  const header = c.req.header("authorization") ?? "";
  if (!header.toLowerCase().startsWith("basic ")) return null;
  try {
    const decoded = Buffer.from(header.slice(6).trim(), "base64").toString("utf8");
    const sep = decoded.indexOf(":");
    if (sep === -1) return null;
    return decoded.slice(sep + 1);
  } catch {
    return null;
  }
}

authRouter.post("/oauth2/sync", (c) => {
  if (getAuthMode() !== "web") {
    return c.json(fail("desktop_only", "Bridge oauth2-proxy nu este disponibil in mod desktop.", c), 400);
  }

  const expected = getOAuth2ProxySharedSecret();
  if (expected === null) {
    return c.json(fail("bridge_disabled", "Bridge oauth2-proxy neconfigurat.", c), 503);
  }

  const provided = c.req.header("x-proxy-auth") ?? extractBasicAuthPassword(c) ?? "";
  if (!constantTimeStringEquals(expected, provided)) {
    recordAudit(null, "auth.oauth2.sync", {
      outcome: "denied",
      targetKind: "http_request",
      targetId: c.req.path,
      detail: { reason: "bad_proxy_secret" },
    });
    return c.json(fail("forbidden", "Acces interzis.", c), 403);
  }

  // Fix 2026-07-02: `--set-xauthrequest` (care produce X-Auth-Request-Email) e
  // documentat de oauth2-proxy ca header de RASPUNS pentru modul nginx
  // auth_request — verificat empiric (audit_log real: missing_identity pe
  // 100% din request-urile prin oauth2-proxy) ca NU e forward-uit catre
  // upstream cand oauth2-proxy ruleaza ca reverse-proxy propriu (--upstreams,
  // cazul nostru). Mecanismul care CHIAR ajunge la upstream e
  // --pass-user-headers (default true, confirmat din --help), care produce
  // X-Forwarded-Email. Refacem fallback-ul eliminat in v2.34.0 (P0-4-edit):
  // ramane sigur pentru ca perimetrul public (Traefik middleware
  // `legal-secure` in docker-compose.yml) strip-uieste ambele headere
  // (X-Auth-Request-Email SI X-Forwarded-Email) inainte sa ajunga la
  // oauth2-proxy — un client extern nu poate injecta niciunul.
  //
  // MR 0a (2026-07-06, contract v2.40.1): X-Forwarded-Email e sursa PRIMARA
  // (mecanismul real --pass-user-headers); X-Auth-Request-Email ramane
  // fallback. Fail-closed pe ambiguitate: daca ambele sosesc cu valori
  // diferite (dupa trim/lowercase), refuzam — o divergenta intre ele inseamna
  // proxy misconfigurat sau request forjat, nu o identitate de incredere.
  // v2.42.0 (4.1): acelasi canonicalizator ca la creare/import/seed — o
  // divergenta intre cai ar produce useri care nu se pot loga.
  const forwardedEmail = canonicalizeEmail(c.req.header("x-forwarded-email") ?? "");
  const authRequestEmail = canonicalizeEmail(c.req.header("x-auth-request-email") ?? "");
  if (forwardedEmail !== "" && authRequestEmail !== "" && forwardedEmail !== authRequestEmail) {
    recordAudit(null, "auth.oauth2.sync", {
      outcome: "denied",
      targetKind: "http_request",
      targetId: c.req.path,
      detail: { reason: "conflicting_identity_headers" },
    });
    return c.json(fail("missing_identity", "Identitate lipsa in header-ele proxy.", c), 400);
  }
  const email = forwardedEmail !== "" ? forwardedEmail : authRequestEmail;
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
    jti: randomUUID(),
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
    jti: randomUUID(),
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
