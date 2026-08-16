import Database from "better-sqlite3";
import path from "node:path";
import os from "node:os";
import fsPromises from "node:fs/promises";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { signAuthToken } from "../auth/jwt.ts";
import { getAuditEvents } from "../db/auditRepository.ts";
import { closeDb, getDb } from "../db/schema.ts";
import { insertUser, updateUserStatus } from "../db/userRepository.ts";
import { requestIdContext } from "./requestId.ts";
import { getActorId, getOwnerId, ownerContext } from "./owner.ts";

// Peer-ul socketului nu exista sub `app.request()`, exact ca in productie unde
// getConnInfo arunca fara server Node dedesubt. Mock-ul lasa comportamentul
// implicit (arunca -> IP null) si permite testului de proxy sa injecteze un peer.
vi.mock("@hono/node-server/conninfo", () => ({
  getConnInfo: vi.fn(() => {
    throw new TypeError("no connection");
  }),
}));
import { getConnInfo } from "@hono/node-server/conninfo";

const SECRET = "0123456789abcdef0123456789abcdef";

let tmpRoot: string;

interface ErrorBody {
  data: null;
  error: { code: string; message?: string };
  requestId: string;
}

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-owner-auth-"));
  const dbPath = path.join(tmpRoot, "legal-dashboard.db");
  process.env.LEGAL_DASHBOARD_DB_PATH = dbPath;
  const seed = new Database(dbPath);
  seed.close();
  getDb();
  vi.mocked(getConnInfo).mockImplementation(() => {
    throw new TypeError("no connection");
  });
});

afterEach(async () => {
  closeDb();
  // biome-ignore lint/performance/noDelete: process.env trebuie unset real, nu valoare undefined.
  delete process.env.LEGAL_DASHBOARD_DB_PATH;
  // biome-ignore lint/performance/noDelete: process.env trebuie unset real, nu valoare undefined.
  delete process.env.LEGAL_DASHBOARD_AUTH_MODE;
  // biome-ignore lint/performance/noDelete: process.env trebuie unset real, nu valoare undefined.
  delete process.env.APP_MODE;
  // biome-ignore lint/performance/noDelete: process.env trebuie unset real, nu valoare undefined.
  delete process.env.LEGAL_DASHBOARD_JWT_SECRET;
  // biome-ignore lint/performance/noDelete: process.env trebuie unset real, nu valoare undefined.
  delete process.env.JWT_SECRET;
  // biome-ignore lint/performance/noDelete: process.env trebuie unset real, nu valoare undefined.
  delete process.env.LEGAL_DASHBOARD_JWT_ISSUER;
  // biome-ignore lint/performance/noDelete: process.env trebuie unset real, nu valoare undefined.
  delete process.env.LEGAL_DASHBOARD_JWT_AUDIENCE;
  // biome-ignore lint/performance/noDelete: process.env trebuie unset real, nu valoare undefined.
  delete process.env.LEGAL_DASHBOARD_TRUSTED_PROXY_CIDR;
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

function buildApp() {
  const app = new Hono();
  app.use("*", requestIdContext);
  app.use("*", ownerContext);
  app.get("/api/whoami", (c) =>
    c.json({
      ownerId: getOwnerId(c),
      actorId: getActorId(c),
    })
  );
  app.get("/health", (c) => c.json({ ok: true }));
  return app;
}

function tokenFor(sub: string, exp = 4_102_444_800): string {
  return signAuthToken({ sub, exp, iss: "ld", aud: "web" }, SECRET);
}

describe("ownerContext auth seam", () => {
  it("keeps desktop mode as local without requiring a token", async () => {
    const app = buildApp();

    const res = await app.request("/api/whoami");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ownerId: "local", actorId: "local" });
  });

  it("allows health/non-api routes in web mode without authenticating", async () => {
    process.env.LEGAL_DASHBOARD_AUTH_MODE = "web";
    process.env.LEGAL_DASHBOARD_JWT_SECRET = SECRET;
    process.env.LEGAL_DASHBOARD_JWT_ISSUER = "ld";
    process.env.LEGAL_DASHBOARD_JWT_AUDIENCE = "web";
    const app = buildApp();

    const res = await app.request("/health");

    expect(res.status).toBe(200);
  });

  it("fails closed in web mode when the token is missing", async () => {
    process.env.LEGAL_DASHBOARD_AUTH_MODE = "web";
    process.env.LEGAL_DASHBOARD_JWT_SECRET = SECRET;
    const app = buildApp();

    const res = await app.request("/api/whoami");

    expect(res.status).toBe(401);
    const body = (await res.json()) as ErrorBody;
    expect(body.data).toBeNull();
    expect(body.error.code).toBe("unauthorized");
    expect(body.requestId).toMatch(/[0-9a-f-]{36}/i);
    expect(res.headers.get("x-request-id")).toBe(body.requestId);
  });

  it("records auth.denied audit events for failed web authentication", async () => {
    process.env.LEGAL_DASHBOARD_AUTH_MODE = "web";
    process.env.LEGAL_DASHBOARD_JWT_SECRET = SECRET;
    const app = buildApp();

    const res = await app.request("/api/whoami", {
      headers: { "user-agent": "vitest-auth-denied" },
    });

    expect(res.status).toBe(401);
    const body = (await res.json()) as ErrorBody;
    const events = getAuditEvents({ ownerId: null, action: "auth.denied" });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      owner_id: null,
      actor_id: null,
      action: "auth.denied",
      target_kind: "http_request",
      target_id: "/api/whoami",
      outcome: "denied",
      user_agent: "vitest-auth-denied",
    });
    expect(JSON.parse(events[0].detail_json)).toEqual({
      requestId: body.requestId,
      method: "GET",
      code: "unauthorized",
      status: 401,
      isPatShaped: false, // fara Authorization: Bearer ld_pat_* -> esec JWT/cookie, nu PAT
      tokenPresent: false, // cererea nu poarta nici Authorization, nici cookie de sesiune
    });
  });

  // Regresie 2026-07-29: auditul de refuz scria peer-ul socketului, adica
  // adresa containerului vecin (172.20.0.x) pentru fiecare vizitator din
  // spatele oauth2-proxy. Restul auditului trece prin readClientIp; refuzurile
  // trebuie sa raporteze acelasi IP real.
  it("records the forwarded client IP, not the trusted proxy peer", async () => {
    process.env.LEGAL_DASHBOARD_AUTH_MODE = "web";
    process.env.LEGAL_DASHBOARD_JWT_SECRET = SECRET;
    process.env.LEGAL_DASHBOARD_TRUSTED_PROXY_CIDR = "172.20.0.0/16";
    vi.mocked(getConnInfo).mockReturnValue({
      remote: { address: "172.20.0.4", port: 0, addressType: "IPv4" },
    } as unknown as ReturnType<typeof getConnInfo>);
    const app = buildApp();

    const res = await app.request("/api/whoami", {
      headers: { "x-forwarded-for": "203.0.113.9, 172.20.0.4" },
    });

    expect(res.status).toBe(401);
    const events = getAuditEvents({ ownerId: null, action: "auth.denied" });
    expect(events[0].ip).toBe("203.0.113.9");
  });

  it("flags isPatShaped=true in the auth.denied audit for a revoked/unknown ld_pat_ bearer", async () => {
    process.env.LEGAL_DASHBOARD_AUTH_MODE = "web";
    process.env.LEGAL_DASHBOARD_JWT_SECRET = SECRET;
    const app = buildApp();

    const res = await app.request("/api/whoami", {
      headers: { authorization: "Bearer ld_pat_does_not_exist" },
    });

    expect(res.status).toBe(401);
    const events = getAuditEvents({ ownerId: null, action: "auth.denied" });
    expect(JSON.parse(events[0].detail_json).isPatShaped).toBe(true);
  });

  // 2026-08-16: refuzul "fara credential" si cel "cu credential invalid" emiteau
  // AMANDOUA `code: "unauthorized"`, iar detaliul nu pastra diferenta. Consecinta
  // traita: un incident real (rafala de auth.denied pe deploy-ul web) nu a putut
  // fi lamurit din audit. Consecinta de securitate: o incercare sistematica de
  // acces neautorizat, care vine mereu fara credential, arata IDENTIC cu o
  // reincarcare de pagina esuata a unui utilizator legitim.
  it("marks tokenPresent=false when the request carried NO credential at all", async () => {
    process.env.LEGAL_DASHBOARD_AUTH_MODE = "web";
    process.env.LEGAL_DASHBOARD_JWT_SECRET = SECRET;
    const app = buildApp();

    const res = await app.request("/api/whoami");

    expect(res.status).toBe(401);
    const events = getAuditEvents({ ownerId: null, action: "auth.denied" });
    expect(JSON.parse(events[0].detail_json).tokenPresent).toBe(false);
  });

  it("marks tokenPresent=true for an invalid Bearer, distinguishing it from a missing one", async () => {
    process.env.LEGAL_DASHBOARD_AUTH_MODE = "web";
    process.env.LEGAL_DASHBOARD_JWT_SECRET = SECRET;
    const app = buildApp();

    const res = await app.request("/api/whoami", {
      headers: { authorization: "Bearer not-a-valid-jwt" },
    });

    expect(res.status).toBe(401);
    const detail = JSON.parse(getAuditEvents({ ownerId: null, action: "auth.denied" })[0].detail_json);
    expect(detail.tokenPresent).toBe(true);
    // Ortogonal fata de isPatShaped: un Bearer obisnuit e prezent, dar nu e PAT.
    expect(detail.isPatShaped).toBe(false);
  });

  it("marks tokenPresent=true when only an invalid session cookie is presented", async () => {
    process.env.LEGAL_DASHBOARD_AUTH_MODE = "web";
    process.env.LEGAL_DASHBOARD_JWT_SECRET = SECRET;
    const app = buildApp();

    const res = await app.request("/api/whoami", {
      headers: { cookie: "legal_dashboard_session=garbage" },
    });

    expect(res.status).toBe(401);
    expect(JSON.parse(getAuditEvents({ ownerId: null, action: "auth.denied" })[0].detail_json).tokenPresent).toBe(true);
  });

  // Cookie-ul e intrare externa, deci cazurile ostile se scriu INAINTEA celui
  // normal. Prima implementare cauta substring-ul `legal_dashboard_session=` in
  // headerul brut si gresea in AMBELE sensuri; helperul trebuie sa oglindeasca
  // parserul real (split pe `;`, primul `=`, nume trim-uit, egalitate exacta).
  it.each([
    ["x_legal_dashboard_session=abc", false, "nume cu prefix strain nu e cookie-ul aplicatiei"],
    ["other=legal_dashboard_session=abc", false, "sirul apare in VALOAREA altui cookie"],
    ["legal_dashboard_session_extra=abc", false, "nume cu sufix strain"],
    ["legal_dashboard_session = garbage", true, "parserul trim-uieste numele, deci sesiunea E vazuta"],
    ["  legal_dashboard_session=x", true, "spatiu la inceputul perechii"],
    ["a=1; legal_dashboard_session=x; b=2", true, "cookie legitim printre altele"],
    // Forma REALISTA a incidentului din productie: cookie-ul proxy-ului ajunge la
    // backend, cel de sesiune al aplicatiei lipseste. Trebuie sa iasa "fara
    // credential", altfel exact cazul pe care campul exista sa-l izoleze e clasat gresit.
    ["_oauth2_proxy=xyz", false, "doar cookie-ul proxy-ului, fara sesiune de aplicatie"],
    ["fara-egal", false, "pereche fara `=` nu trebuie sa arunce"],
    ["", false, "header gol"],
  ])("cookie %j -> tokenPresent=%s (%s)", async (cookie, expected) => {
    process.env.LEGAL_DASHBOARD_AUTH_MODE = "web";
    process.env.LEGAL_DASHBOARD_JWT_SECRET = SECRET;
    const app = buildApp();

    const res = await app.request("/api/whoami", { headers: cookie ? { cookie } : {} });

    expect(res.status).toBe(401);
    expect(JSON.parse(getAuditEvents({ ownerId: null, action: "auth.denied" })[0].detail_json).tokenPresent).toBe(
      expected
    );
  });

  it("still returns auth errors when auth.denied audit persistence fails", async () => {
    process.env.LEGAL_DASHBOARD_AUTH_MODE = "web";
    process.env.LEGAL_DASHBOARD_JWT_SECRET = SECRET;
    closeDb();
    process.env.LEGAL_DASHBOARD_DB_PATH = tmpRoot;
    const app = buildApp();

    const res = await app.request("/api/whoami");

    expect(res.status).toBe(401);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe("unauthorized");
    expect(body.requestId).toMatch(/[0-9a-f-]{36}/i);
  });

  it("authenticates a valid web JWT and sets owner/actor from the user", async () => {
    process.env.LEGAL_DASHBOARD_AUTH_MODE = "web";
    process.env.LEGAL_DASHBOARD_JWT_SECRET = SECRET;
    process.env.LEGAL_DASHBOARD_JWT_ISSUER = "ld";
    process.env.LEGAL_DASHBOARD_JWT_AUDIENCE = "web";
    insertUser({ id: "alice", email: "alice@example.test", displayName: "Alice" });
    const app = buildApp();

    const res = await app.request("/api/whoami", {
      headers: { authorization: `Bearer ${tokenFor("alice")}` },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ownerId: "alice", actorId: "alice" });
  });

  it("rejects expired JWTs and inactive users", async () => {
    process.env.LEGAL_DASHBOARD_AUTH_MODE = "web";
    process.env.LEGAL_DASHBOARD_JWT_SECRET = SECRET;
    process.env.LEGAL_DASHBOARD_JWT_ISSUER = "ld";
    process.env.LEGAL_DASHBOARD_JWT_AUDIENCE = "web";
    insertUser({ id: "alice", email: "alice@example.test", displayName: "Alice" });
    insertUser({ id: "bob", email: "bob@example.test", displayName: "Bob" });
    updateUserStatus("bob", "suspended");
    const app = buildApp();

    const expired = await app.request("/api/whoami", {
      headers: { authorization: `Bearer ${tokenFor("alice", 100)}` },
    });
    expect(expired.status).toBe(401);
    expect(((await expired.json()) as ErrorBody).error).toMatchObject({
      code: "unauthorized",
      message: "Token de autentificare invalid.",
    });

    const inactive = await app.request("/api/whoami", {
      headers: { authorization: `Bearer ${tokenFor("bob")}` },
    });
    expect(inactive.status).toBe(401);
    expect(((await inactive.json()) as ErrorBody).error).toMatchObject({
      code: "unauthorized",
      message: "Token de autentificare invalid.",
    });
  });

  it("returns an envelope with requestId for invalid signatures", async () => {
    process.env.LEGAL_DASHBOARD_AUTH_MODE = "web";
    process.env.LEGAL_DASHBOARD_JWT_SECRET = SECRET;
    const app = buildApp();
    const parts = tokenFor("alice").split(".");

    const res = await app.request("/api/whoami", {
      headers: { authorization: `Bearer ${parts[0]}.${parts[1]}.bad-signature` },
    });

    expect(res.status).toBe(401);
    const body = (await res.json()) as ErrorBody;
    expect(body).toMatchObject({
      data: null,
      error: {
        code: "unauthorized",
        message: "Token de autentificare invalid.",
      },
      requestId: expect.any(String),
    });
    expect(res.headers.get("x-request-id")).toBe(body.requestId);
  });

  it("returns an envelope for a valid JWT whose user row does not exist", async () => {
    process.env.LEGAL_DASHBOARD_AUTH_MODE = "web";
    process.env.LEGAL_DASHBOARD_JWT_SECRET = SECRET;
    const app = buildApp();

    const res = await app.request("/api/whoami", {
      headers: { authorization: `Bearer ${tokenFor("missing-user")}` },
    });

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({
      data: null,
      error: {
        code: "unauthorized",
        message: "Token de autentificare invalid.",
      },
      requestId: expect.any(String),
    });
  });
});
