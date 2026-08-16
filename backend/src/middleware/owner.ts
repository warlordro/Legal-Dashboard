import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import {
  AUTH_COOKIE_NAME,
  AuthenticationError,
  getAuthProvider,
  type AuthenticatedContext,
} from "../auth/authProvider.ts";
import { recordAudit } from "../db/auditRepository.ts";
import { getAuthMode } from "../auth/config.ts";
import { fail } from "../util/envelope.ts";
import { getRequestId } from "./requestId.ts";
import { readClientIp } from "../util/proxyIp.ts";
import { TOKEN_PREFIX } from "../db/apiTokenRepository.ts";

// Bearer-ul e in forma de PAT (ld_pat_*)? Folosit doar pentru atribuire in auditul de
// auth.denied — un replay de PAT revocat/expirat devine separabil de un esec JWT.
function isPatShapedBearer(c: Context): boolean {
  const m = /^Bearer\s+(.+)$/i.exec((c.req.header("authorization") ?? "").trim());
  return (m?.[1] ?? "").startsWith(TOKEN_PREFIX);
}

// A prezentat clientul VREUN credential al aplicatiei, oricare?
//
// Fara campul asta, "cerere fara credential" si "credential invalid" produc
// amandoua `code: "unauthorized"` in audit, deci arata identic. Campul e un
// semnal de TRIAJ, nu o clasificare cauzala: NU separa atacatorii de
// utilizatorii legitimi (credential stuffing vine cu credential, iar un
// utilizator cu cookie expirat vine fara). Separa strict "a venit cu ceva" de
// "a venit fara nimic" — distinctia care lipsea cand un incident real nu a putut
// fi lamurit din audit.
//
// Deliberat NU refoloseste `readRequestToken` din authProvider: aceasta ruleaza
// pe calea de EROARE si nu are voie sa arunce. Selectia de credentiale din
// authProvider e pe cale sa devina fail-closed (poate arunca pe conflict intre
// surse), iar un throw de acolo ar inghiti chiar randul de audit. Helperul de
// aici e pur: doar prezenta, niciodata valoarea, si nicio validare.
//
// Cookie-ul se citeste cu parserul lui Hono, nu prin cautare de substring in
// headerul brut: acela dadea si fals pozitiv (`x_legal_dashboard_session=`, sau
// literalul aparut in VALOAREA altui cookie) si fals negativ (`nume = valoare`,
// pe care parserul real il accepta pentru ca trim-uieste numele). `getCookie` e
// non-throwing: split pe `;`, comparatie EXACTA de nume, decodare catch-safe.
//
// Ortogonal fata de `isPatShaped`: acela raspunde "ce FEL de credential",
// acesta raspunde "a fost vreunul".
function hasPresentedAppCredential(c: Context): boolean {
  if ((c.req.header("authorization") ?? "").trim() !== "") return true;
  return getCookie(c, AUTH_COOKIE_NAME) !== undefined;
}

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
      // readClientIp, nu peer-ul socketului: in spatele reverse-proxy-ului
      // (oauth2-proxy/Caddy in acelasi network Docker) peer-ul e containerul
      // vecin, deci fiecare refuz se inregistra cu 172.x — inutilizabil intr-o
      // investigatie si divergent de restul auditului, care trece prin
      // recordAudit -> readContext -> readClientIp. Contextul ramane `null`:
      // readContext apeleaza getOwnerId(), care arunca in web mode exact pe
      // calea asta (ownerId neasignat), iar catch-ul de mai jos ar inghiti
      // randul de securitate.
      ip: readClientIp(c),
      userAgent: c.req.header("user-agent") ?? null,
      detail: {
        requestId,
        method: c.req.method,
        code: err.code,
        status: err.status,
        // audit (fix): separa replay-urile de PAT revocat/expirat de esecurile JWT in log,
        // fara lookup DB pe calea de esec (anti-enumerare/timing). true = Bearer ld_pat_*.
        isPatShaped: isPatShapedBearer(c),
        // "A venit fara nimic" vs "a venit cu ceva invalid". Doar prezenta, niciodata
        // valoarea. Exista DOAR pe refuzurile de autentificare (aici), NU si pe cele de
        // autorizare din requireRole — acolo utilizatorul e deja autentificat, deci
        // campul ar fi mereu `true` si zero informatie. Cele doua familii raman
        // separabile in audit prin forma detaliului si prin owner_id (null aici, real
        // acolo); vezi pin-ul din requireRole.test.ts.
        tokenPresent: hasPresentedAppCredential(c),
      },
    });
  } catch (auditErr) {
    console.error(`[auth.audit_failed] ${auditErr instanceof Error ? auditErr.message : "unknown"}`);
  }
  return c.json(fail(err.code, err.message, c), err.status);
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
