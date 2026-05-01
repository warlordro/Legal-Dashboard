import Database from "better-sqlite3";
import path from "path";
import os from "os";
import fsPromises from "fs/promises";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { signAuthToken } from "../auth/jwt.ts";
import { closeDb, getDb } from "../db/schema.ts";
import { insertUser, updateUserStatus } from "../db/userRepository.ts";
import { requestIdContext } from "./requestId.ts";
import { getActorId, getOwnerId, ownerContext } from "./owner.ts";

const SECRET = "0123456789abcdef0123456789abcdef";

let tmpRoot: string;

interface ErrorBody {
  data: null;
  error: { code: string };
  requestId: string;
}

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-owner-auth-"));
  const dbPath = path.join(tmpRoot, "legal-dashboard.db");
  process.env.LEGAL_DASHBOARD_DB_PATH = dbPath;
  const seed = new Database(dbPath);
  seed.close();
  getDb();
});

afterEach(async () => {
  closeDb();
  delete process.env.LEGAL_DASHBOARD_DB_PATH;
  delete process.env.LEGAL_DASHBOARD_AUTH_MODE;
  delete process.env.APP_MODE;
  delete process.env.LEGAL_DASHBOARD_JWT_SECRET;
  delete process.env.JWT_SECRET;
  delete process.env.LEGAL_DASHBOARD_JWT_ISSUER;
  delete process.env.LEGAL_DASHBOARD_JWT_AUDIENCE;
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
    }),
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
    expect(((await expired.json()) as ErrorBody).error.code).toBe("token_expired");

    const inactive = await app.request("/api/whoami", {
      headers: { authorization: `Bearer ${tokenFor("bob")}` },
    });
    expect(inactive.status).toBe(403);
    expect(((await inactive.json()) as ErrorBody).error.code).toBe("account_inactive");
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
      error: { code: "invalid_signature" },
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
      error: { code: "user_not_found" },
      requestId: expect.any(String),
    });
  });
});
