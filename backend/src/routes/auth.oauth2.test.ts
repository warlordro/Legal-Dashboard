import Database from "better-sqlite3";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AUTH_COOKIE_NAME } from "../auth/authProvider.ts";
import { verifyAuthToken } from "../auth/jwt.ts";
import { closeDb, getDb } from "../db/schema.ts";
import { getAuditEvents } from "../db/auditRepository.ts";
import { insertUser, updateUserStatus } from "../db/userRepository.ts";
import { getOwnerId, ownerContext } from "../middleware/owner.ts";
import { requestIdContext } from "../middleware/requestId.ts";
import { ok } from "../util/envelope.ts";
import { authRouter } from "./auth.ts";

// 32-char minimums for both JWT secret and shared bridge secret.
const JWT_SECRET = "0123456789abcdef0123456789abcdef";
const PROXY_SECRET = "abcdefghijklmnopqrstuvwxyz012345";
const JWT_ISSUER = "legal-dashboard-test";
const JWT_AUDIENCE = "legal-dashboard-test";

let tmpRoot: string;

interface EnvelopeErrorBody {
  data: null;
  error: { code: string; message: string };
  requestId: string;
}

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-auth-oauth2-"));
  const dbPath = path.join(tmpRoot, "legal-dashboard.db");
  process.env.LEGAL_DASHBOARD_DB_PATH = dbPath;
  process.env.LEGAL_DASHBOARD_AUTH_MODE = "web";
  process.env.LEGAL_DASHBOARD_JWT_SECRET = JWT_SECRET;
  process.env.LEGAL_DASHBOARD_JWT_ISSUER = JWT_ISSUER;
  process.env.LEGAL_DASHBOARD_JWT_AUDIENCE = JWT_AUDIENCE;
  process.env.LEGAL_DASHBOARD_AUTH_COOKIE_SECURE = "1";
  process.env.LEGAL_DASHBOARD_OAUTH2_PROXY_SECRET = PROXY_SECRET;
  const seed = new Database(dbPath);
  seed.close();
  getDb();
});

afterEach(async () => {
  closeDb();
  // biome-ignore lint/performance/noDelete: env vars trebuie unset real.
  delete process.env.LEGAL_DASHBOARD_DB_PATH;
  // biome-ignore lint/performance/noDelete: env vars trebuie unset real.
  delete process.env.LEGAL_DASHBOARD_AUTH_MODE;
  // biome-ignore lint/performance/noDelete: env vars trebuie unset real.
  delete process.env.LEGAL_DASHBOARD_JWT_SECRET;
  // biome-ignore lint/performance/noDelete: env vars trebuie unset real.
  delete process.env.LEGAL_DASHBOARD_JWT_ISSUER;
  // biome-ignore lint/performance/noDelete: env vars trebuie unset real.
  delete process.env.LEGAL_DASHBOARD_JWT_AUDIENCE;
  // biome-ignore lint/performance/noDelete: env vars trebuie unset real.
  delete process.env.LEGAL_DASHBOARD_AUTH_COOKIE_SECURE;
  // biome-ignore lint/performance/noDelete: env vars trebuie unset real.
  delete process.env.LEGAL_DASHBOARD_OAUTH2_PROXY_SECRET;
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

function buildApp() {
  const app = new Hono();
  app.use("*", requestIdContext);
  app.use("*", ownerContext);
  app.route("/api/v1/auth", authRouter);
  app.get("/api/v1/probe", (c) => c.json(ok({ ownerId: getOwnerId(c) }, c)));
  return app;
}

function syncRequest(headers: Record<string, string>) {
  return buildApp().request("/api/v1/auth/oauth2/sync", { method: "POST", headers });
}

describe("/api/v1/auth/oauth2/sync — bridge oauth2-proxy", () => {
  it("returneaza 503 bridge_disabled cand shared secret-ul nu e setat", async () => {
    // biome-ignore lint/performance/noDelete: env vars trebuie unset real.
    delete process.env.LEGAL_DASHBOARD_OAUTH2_PROXY_SECRET;

    const res = await syncRequest({});

    expect(res.status).toBe(503);
    const body = (await res.json()) as EnvelopeErrorBody;
    expect(body.error.code).toBe("bridge_disabled");
  });

  it("returneaza 503 cand shared secret-ul are sub 32 chars", async () => {
    process.env.LEGAL_DASHBOARD_OAUTH2_PROXY_SECRET = "prea-scurt";

    const res = await syncRequest({ "x-proxy-auth": "prea-scurt" });

    expect(res.status).toBe(503);
    const body = (await res.json()) as EnvelopeErrorBody;
    expect(body.error.code).toBe("bridge_disabled");
  });

  it("returneaza 403 cand header-ul X-Proxy-Auth lipseste", async () => {
    const res = await syncRequest({ "x-auth-request-email": "alice@example.test" });

    expect(res.status).toBe(403);
    const body = (await res.json()) as EnvelopeErrorBody;
    expect(body.error.code).toBe("forbidden");

    const audits = getAuditEvents({ action: "auth.oauth2.sync" });
    expect(audits[0]?.outcome).toBe("denied");
    expect(JSON.parse(audits[0]?.detail_json ?? "{}")).toMatchObject({ reason: "bad_proxy_secret" });
  });

  it("returneaza 403 cand shared secret-ul nu se potriveste", async () => {
    const res = await syncRequest({
      "x-proxy-auth": PROXY_SECRET.replace("a", "z"),
      "x-auth-request-email": "alice@example.test",
    });

    expect(res.status).toBe(403);
    const body = (await res.json()) as EnvelopeErrorBody;
    expect(body.error.code).toBe("forbidden");
  });

  it("returneaza 400 missing_identity cand header-ele email lipsesc", async () => {
    const res = await syncRequest({ "x-proxy-auth": PROXY_SECRET });

    expect(res.status).toBe(400);
    const body = (await res.json()) as EnvelopeErrorBody;
    expect(body.error.code).toBe("missing_identity");
  });

  it("returneaza 403 not_provisioned cand user-ul nu exista in DB", async () => {
    const res = await syncRequest({
      "x-proxy-auth": PROXY_SECRET,
      "x-auth-request-email": "necunoscut@example.test",
    });

    expect(res.status).toBe(403);
    const body = (await res.json()) as EnvelopeErrorBody;
    expect(body.error.code).toBe("not_provisioned");

    const audits = getAuditEvents({ action: "auth.oauth2.sync" });
    const denied = audits.find((a) => a.outcome === "denied");
    expect(denied).toBeDefined();
    const detail = JSON.parse(denied?.detail_json ?? "{}");
    expect(detail.reason).toBe("user_not_provisioned");
    expect(detail.emailHash).toMatch(/^[0-9a-f]{16}$/);
    // CONSTRAINT: audit log NU primeste plaintext.
    expect(denied?.detail_json).not.toContain("necunoscut@example.test");
  });

  it("returneaza 403 account_inactive cand user-ul exista dar nu e active", async () => {
    insertUser({ id: "alice", email: "alice@example.test", displayName: "Alice", role: "admin" });
    updateUserStatus("alice", "suspended");

    const res = await syncRequest({
      "x-proxy-auth": PROXY_SECRET,
      "x-auth-request-email": "alice@example.test",
    });

    expect(res.status).toBe(403);
    const body = (await res.json()) as EnvelopeErrorBody;
    expect(body.error.code).toBe("account_inactive");
  });

  it("mintea JWT-ul si seteaza cookie-ul cu HttpOnly + Secure + SameSite=Strict", async () => {
    insertUser({ id: "alice", email: "alice@example.test", displayName: "Alice", role: "admin" });

    const res = await syncRequest({
      "x-proxy-auth": PROXY_SECRET,
      "x-auth-request-email": "alice@example.test",
    });

    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${AUTH_COOKIE_NAME}=`);
    expect(cookie.toLowerCase()).toContain("httponly");
    expect(cookie.toLowerCase()).toContain("secure");
    expect(cookie.toLowerCase()).toContain("samesite=strict");
    expect(cookie.toLowerCase()).toContain("path=/");
  });

  it("token-ul mint-uit are sub=user.id, iss, aud corecte si e verificabil", async () => {
    insertUser({ id: "alice", email: "alice@example.test", displayName: "Alice", role: "admin" });

    const res = await syncRequest({
      "x-proxy-auth": PROXY_SECRET,
      "x-auth-request-email": "alice@example.test",
    });

    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") ?? "";
    const token = cookie.match(new RegExp(`${AUTH_COOKIE_NAME}=([^;]+)`))?.[1] ?? "";
    expect(token.length).toBeGreaterThan(0);

    const payload = verifyAuthToken(token, {
      secret: JWT_SECRET,
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    expect(payload.sub).toBe("alice");
    expect(payload.iss).toBe(JWT_ISSUER);
    expect(payload.aud).toBe(JWT_AUDIENCE);
  });

  it("dupa sync, request-ul cu cookie-ul mint-uit autentifica probe-ul", async () => {
    insertUser({ id: "alice", email: "alice@example.test", displayName: "Alice", role: "admin" });

    const app = buildApp();
    const syncRes = await app.request("/api/v1/auth/oauth2/sync", {
      method: "POST",
      headers: {
        "x-proxy-auth": PROXY_SECRET,
        "x-auth-request-email": "alice@example.test",
      },
    });
    expect(syncRes.status).toBe(200);
    const cookie = syncRes.headers.get("set-cookie")?.split(";")[0] ?? "";

    const probeRes = await app.request("/api/v1/probe", { headers: { cookie } });
    expect(probeRes.status).toBe(200);
    expect(await probeRes.json()).toMatchObject({
      data: { ownerId: "alice" },
      requestId: expect.any(String),
    });
  });

  it("normalizeaza emailul (trim + lowercase) inainte de lookup", async () => {
    insertUser({ id: "alice", email: "alice@example.test", displayName: "Alice", role: "admin" });

    const res = await syncRequest({
      "x-proxy-auth": PROXY_SECRET,
      "x-auth-request-email": "  Alice@Example.Test  ",
    });

    expect(res.status).toBe(200);
  });

  // v2.40.1: X-Forwarded-Email e header-ul pe care oauth2-proxy il trimite REAL
  // upstream (`pass-user-headers`) — v2.34.0 il respinsese pe teoria gresita ca
  // X-Auth-Request-Email e canonic (acela e header de RASPUNS, nginx
  // auth_request, si nu sosea niciodata upstream). Ambele sunt acceptate, doar
  // dupa shared-secret check; Caddy le strip-uieste inbound pe amandoua.
  it("accepta X-Forwarded-Email ca identitate (mecanismul real oauth2-proxy)", async () => {
    insertUser({ id: "alice", email: "alice@example.test", displayName: "Alice", role: "admin" });

    const res = await syncRequest({
      "x-proxy-auth": PROXY_SECRET,
      "x-forwarded-email": "alice@example.test",
    });

    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${AUTH_COOKIE_NAME}=`);
  });

  // Stack-ul canonic din deploy/docker-compose.prod.yml (v2.40.1): oauth2-proxy
  // cu `basic-auth-password` + `pass-basic-auth` trimite upstream
  // `Authorization: Basic base64(<user>:<shared secret>)` + X-Forwarded-Email.
  it("accepta secretul din parola Basic Auth (oauth2-proxy basic-auth-password)", async () => {
    insertUser({ id: "alice", email: "alice@example.test", displayName: "Alice", role: "admin" });

    const res = await syncRequest({
      authorization: `Basic ${Buffer.from(`alice@example.test:${PROXY_SECRET}`).toString("base64")}`,
      "x-forwarded-email": "alice@example.test",
    });

    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${AUTH_COOKIE_NAME}=`);
  });

  it("respinge Basic Auth cu parola gresita", async () => {
    insertUser({ id: "alice", email: "alice@example.test", displayName: "Alice", role: "admin" });

    const res = await syncRequest({
      authorization: `Basic ${Buffer.from("alice@example.test:parola-gresita-cu-lungime-suficienta").toString("base64")}`,
      "x-forwarded-email": "alice@example.test",
    });

    expect(res.status).toBe(403);
    const body = (await res.json()) as EnvelopeErrorBody;
    expect(body.error.code).toBe("forbidden");
  });

  it("respinge Basic Auth malformat (fara separator user:parola)", async () => {
    insertUser({ id: "alice", email: "alice@example.test", displayName: "Alice", role: "admin" });

    const res = await syncRequest({
      authorization: `Basic ${Buffer.from(PROXY_SECRET).toString("base64")}`,
      "x-forwarded-email": "alice@example.test",
    });

    expect(res.status).toBe(403);
    const body = (await res.json()) as EnvelopeErrorBody;
    expect(body.error.code).toBe("forbidden");
  });

  it("respinge Basic Auth cu parola goala", async () => {
    insertUser({ id: "alice", email: "alice@example.test", displayName: "Alice", role: "admin" });

    const res = await syncRequest({
      authorization: `Basic ${Buffer.from("alice@example.test:").toString("base64")}`,
      "x-forwarded-email": "alice@example.test",
    });

    expect(res.status).toBe(403);
    const body = (await res.json()) as EnvelopeErrorBody;
    expect(body.error.code).toBe("forbidden");
  });

  it("suporta secret care contine ':' (split pe primul separator)", async () => {
    const secretWithColon = "abc:def:0123456789abcdef0123456789";
    process.env.LEGAL_DASHBOARD_OAUTH2_PROXY_SECRET = secretWithColon;
    insertUser({ id: "alice", email: "alice@example.test", displayName: "Alice", role: "admin" });

    const res = await syncRequest({
      authorization: `Basic ${Buffer.from(`alice@example.test:${secretWithColon}`).toString("base64")}`,
      "x-forwarded-email": "alice@example.test",
    });

    expect(res.status).toBe(200);
  });

  it("OR real intre mecanisme: Basic malformat nu blocheaza X-Proxy-Auth valid", async () => {
    insertUser({ id: "alice", email: "alice@example.test", displayName: "Alice", role: "admin" });

    const res = await syncRequest({
      authorization: "Basic nu-e-base64-valid",
      "x-proxy-auth": PROXY_SECRET,
      "x-forwarded-email": "alice@example.test",
    });

    expect(res.status).toBe(200);
  });

  it("respinge header-e de identitate conflictuale (fail-closed pe ambiguitate)", async () => {
    insertUser({ id: "alice", email: "alice@example.test", displayName: "Alice", role: "admin" });

    const res = await syncRequest({
      "x-proxy-auth": PROXY_SECRET,
      "x-forwarded-email": "alice@example.test",
      "x-auth-request-email": "mallory@example.test",
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as EnvelopeErrorBody;
    expect(body.error.code).toBe("missing_identity");

    const audits = getAuditEvents({ action: "auth.oauth2.sync" });
    const denied = audits.find((a) => a.outcome === "denied");
    expect(JSON.parse(denied?.detail_json ?? "{}")).toMatchObject({
      reason: "conflicting_identity_headers",
    });
  });

  it("accepta ambele header-e de identitate cand coincid (case-insensitive)", async () => {
    insertUser({ id: "alice", email: "alice@example.test", displayName: "Alice", role: "admin" });

    const res = await syncRequest({
      "x-proxy-auth": PROXY_SECRET,
      "x-forwarded-email": "alice@example.test",
      "x-auth-request-email": "Alice@Example.Test",
    });

    expect(res.status).toBe(200);
  });

  // Cu `pass-basic-auth`, oauth2-proxy trimite `Authorization: Basic ...` pe
  // ORICE request proxied, nu doar pe bridge. authProvider parseaza doar
  // `Bearer`, deci header-ul Basic trebuie sa fie inert pe rutele normale:
  // autentificarea ramane pe cookie-ul de sesiune.
  it("header-ul Basic omniprezent e inert pe rutele non-bridge (cookie-ul castiga)", async () => {
    insertUser({ id: "alice", email: "alice@example.test", displayName: "Alice", role: "admin" });

    const app = buildApp();
    const syncRes = await app.request("/api/v1/auth/oauth2/sync", {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`alice@example.test:${PROXY_SECRET}`).toString("base64")}`,
        "x-forwarded-email": "alice@example.test",
      },
    });
    expect(syncRes.status).toBe(200);
    const cookie = syncRes.headers.get("set-cookie")?.split(";")[0] ?? "";

    const probeRes = await app.request("/api/v1/probe", {
      headers: {
        cookie,
        authorization: `Basic ${Buffer.from(`alice@example.test:${PROXY_SECRET}`).toString("base64")}`,
      },
    });
    expect(probeRes.status).toBe(200);
    expect(await probeRes.json()).toMatchObject({ data: { ownerId: "alice" } });
  });

  it("identitatea vine din header, nu din user-ul Basic Auth", async () => {
    insertUser({ id: "alice", email: "alice@example.test", displayName: "Alice", role: "admin" });

    // user-ul Basic e alt string decat emailul provisionat — daca bridge-ul
    // l-ar folosi ca identitate, sync-ul ar esua cu not_provisioned.
    const res = await syncRequest({
      authorization: `Basic ${Buffer.from(`whatever-user:${PROXY_SECRET}`).toString("base64")}`,
      "x-forwarded-email": "alice@example.test",
    });

    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") ?? "";
    const token = cookie.match(new RegExp(`${AUTH_COOKIE_NAME}=([^;]+)`))?.[1] ?? "";
    const payload = verifyAuthToken(token, {
      secret: JWT_SECRET,
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    expect(payload.sub).toBe("alice");
  });

  it("audit-ul de succes contine targetId=user.id si NU plaintext email", async () => {
    insertUser({ id: "alice", email: "alice@example.test", displayName: "Alice", role: "admin" });

    const res = await syncRequest({
      "x-proxy-auth": PROXY_SECRET,
      "x-auth-request-email": "alice@example.test",
    });
    expect(res.status).toBe(200);

    const audits = getAuditEvents({ action: "auth.oauth2.sync" });
    const success = audits.find((a) => a.outcome === "ok");
    expect(success).toBeDefined();
    expect(success?.target_id).toBe("alice");
    expect(success?.owner_id).toBe("alice");
    expect(success?.detail_json).not.toContain("alice@example.test");
  });

  it("respinge in mod desktop cu desktop_only", async () => {
    process.env.LEGAL_DASHBOARD_AUTH_MODE = "desktop";

    const res = await syncRequest({
      "x-proxy-auth": PROXY_SECRET,
      "x-auth-request-email": "alice@example.test",
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as EnvelopeErrorBody;
    expect(body.error.code).toBe("desktop_only");
  });

  // FIX #6 (v2.33.0 follow-up — MEDIUM-5 defensive): Caddyfile strip-uieste
  // X-Auth-Request-Email / X-Forwarded-Email / X-Proxy-Auth la marginea
  // public-facing inainte de a forwarda la oauth2-proxy. Daca un attacker
  // bypass-eaza Caddy (port-forward intern, mis-config de retea, expose
  // direct port 3002 in afara enclavei), injecteaza header-ul direct la
  // backend. Backendul nu trebuie sa-l accepte ca semn de autenticitate
  // pentru altceva decat bridge-ul cu shared secret. Verificam ca:
  //   1. Endpoint-uri protejate (afara bridge-ului) nu citesc header-ul.
  //   2. Singura cale legitima ramane /oauth2/sync + X-Proxy-Auth valid.
  it("nu autorizeaza request-uri pe rute protejate doar pe baza X-Auth-Request-Email injectat", async () => {
    insertUser({ id: "alice", email: "alice@example.test", displayName: "Alice", role: "admin" });

    const app = buildApp();
    const res = await app.request("/api/v1/probe", {
      headers: {
        "x-auth-request-email": "alice@example.test",
        "x-forwarded-email": "alice@example.test",
      },
    });

    // ownerContext (in web mode) cere JWT cookie; X-Auth-Request-Email NU e
    // citit nicaieri in afara bridge-ului. Rezultat: anonymous, ownerId nu e
    // "alice". Probe-ul returneaza ownerId="local" sau 401 in functie de
    // configul ownerContext — important e sa NU fie "alice".
    if (res.status === 200) {
      const body = (await res.json()) as { data: { ownerId: string | null } };
      expect(body.data.ownerId).not.toBe("alice");
    } else {
      expect([401, 403]).toContain(res.status);
    }
  });

  it("logout invalideaza tokenul server-side — refolosirea cookie-ului da 401", async () => {
    insertUser({ id: "alice", email: "alice@example.test", displayName: "Alice", role: "admin" });

    const app = buildApp();

    // 1. sync valid → extrage cookie-ul de sesiune
    const syncRes = await app.request("/api/v1/auth/oauth2/sync", {
      method: "POST",
      headers: {
        "x-proxy-auth": PROXY_SECRET,
        "x-auth-request-email": "alice@example.test",
      },
    });
    expect(syncRes.status).toBe(200);
    const cookie = syncRes.headers.get("set-cookie")?.split(";")[0] ?? "";
    expect(cookie.length).toBeGreaterThan(0);

    // 2. GET pe ruta autentificata cu cookie → 200
    const before = await app.request("/api/v1/probe", { headers: { cookie } });
    expect(before.status).toBe(200);

    // 3. POST logout cu acelasi cookie → 200
    const logoutRes = await app.request("/api/v1/auth/logout", { method: "POST", headers: { cookie } });
    expect(logoutRes.status).toBe(200);

    // 4. refolosirea cookie-ului vechi → 401 (token revocat server-side)
    const after = await app.request("/api/v1/probe", { headers: { cookie } });
    expect(after.status).toBe(401);
  });

  it("logout ramane 200 si logheaza cand revokeJti arunca (observabilitate, nu fail-closed)", async () => {
    insertUser({ id: "alice", email: "alice@example.test", displayName: "Alice", role: "admin" });

    const app = buildApp();

    const syncRes = await app.request("/api/v1/auth/oauth2/sync", {
      method: "POST",
      headers: {
        "x-proxy-auth": PROXY_SECRET,
        "x-auth-request-email": "alice@example.test",
      },
    });
    expect(syncRes.status).toBe(200);
    const cookie = syncRes.headers.get("set-cookie")?.split(";")[0] ?? "";
    expect(cookie.length).toBeGreaterThan(0);

    // Forteaza un esec real al scrierii in denylist (nu mock): dropam tabela.
    getDb().exec("DROP TABLE jwt_denylist");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const logoutRes = await app.request("/api/v1/auth/logout", { method: "POST", headers: { cookie } });
      // best-effort: logout reuseste oricum (cookie sters, token expira la TTL)
      expect(logoutRes.status).toBe(200);
      // esecul revocarii e observabil, nu inghitit silentios de catch-ul exterior
      expect(errSpy).toHaveBeenCalledWith(
        "[auth.logout] revokeJti failed — token NOT revoked server-side",
        expect.objectContaining({ sub: "alice" })
      );
    } finally {
      errSpy.mockRestore();
    }
  });

  it("logout pe Bearer revoca tokenul — refolosirea aceluiasi Bearer da 401", async () => {
    insertUser({ id: "alice", email: "alice@example.test", displayName: "Alice", role: "admin" });

    const app = buildApp();

    const syncRes = await app.request("/api/v1/auth/oauth2/sync", {
      method: "POST",
      headers: {
        "x-proxy-auth": PROXY_SECRET,
        "x-auth-request-email": "alice@example.test",
      },
    });
    expect(syncRes.status).toBe(200);
    const cookieValue = syncRes.headers.get("set-cookie") ?? "";
    const token = cookieValue.match(new RegExp(`${AUTH_COOKIE_NAME}=([^;]+)`))?.[1] ?? "";
    expect(token.length).toBeGreaterThan(0);

    const bearer = `Bearer ${token}`;

    const before = await app.request("/api/v1/probe", { headers: { authorization: bearer } });
    expect(before.status).toBe(200);

    const logoutRes = await app.request("/api/v1/auth/logout", {
      method: "POST",
      headers: { authorization: bearer },
    });
    expect(logoutRes.status).toBe(200);

    const after = await app.request("/api/v1/probe", { headers: { authorization: bearer } });
    expect(after.status).toBe(401);
  });
});
