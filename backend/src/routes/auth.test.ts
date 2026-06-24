import Database from "better-sqlite3";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AUTH_COOKIE_NAME } from "../auth/authProvider.ts";
import { signAuthToken } from "../auth/jwt.ts";
import { getAuditEvents } from "../db/auditRepository.ts";
import { closeDb, getDb } from "../db/schema.ts";
import { insertUser } from "../db/userRepository.ts";
import { getOwnerId, ownerContext } from "../middleware/owner.ts";
import { requestIdContext } from "../middleware/requestId.ts";
import { ok } from "../util/envelope.ts";
import { authRouter } from "./auth.ts";

const SECRET = "0123456789abcdef0123456789abcdef";
let tmpRoot: string;

interface ErrorBody {
  error: { code: string; message: string };
}

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-auth-route-"));
  const dbPath = path.join(tmpRoot, "legal-dashboard.db");
  process.env.LEGAL_DASHBOARD_DB_PATH = dbPath;
  process.env.LEGAL_DASHBOARD_AUTH_MODE = "web";
  process.env.LEGAL_DASHBOARD_JWT_SECRET = SECRET;
  process.env.LEGAL_DASHBOARD_AUTH_COOKIE_SECURE = "1";
  const seed = new Database(dbPath);
  seed.close();
  getDb();
});

afterEach(async () => {
  closeDb();
  // biome-ignore lint/performance/noDelete: process.env trebuie unset real, nu valoare undefined.
  delete process.env.LEGAL_DASHBOARD_DB_PATH;
  // biome-ignore lint/performance/noDelete: process.env trebuie unset real, nu valoare undefined.
  delete process.env.LEGAL_DASHBOARD_AUTH_MODE;
  // biome-ignore lint/performance/noDelete: process.env trebuie unset real, nu valoare undefined.
  delete process.env.LEGAL_DASHBOARD_JWT_SECRET;
  // biome-ignore lint/performance/noDelete: process.env trebuie unset real, nu valoare undefined.
  delete process.env.LEGAL_DASHBOARD_AUTH_COOKIE_SECURE;
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

describe("/api/v1/auth", () => {
  it("keeps login as an explicit unimplemented provider seam", async () => {
    const app = buildApp();

    const res = await app.request("/api/v1/auth/login", { method: "POST" });

    expect(res.status).toBe(501);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe("not_implemented");
    expect(body.error.message).not.toMatch(/PR-10/i);
    expect(body.error.message).toMatch(/extern/i);
  });

  it("clears the session cookie on logout without requiring a valid token", async () => {
    const app = buildApp();

    const res = await app.request("/api/v1/auth/logout", { method: "POST" });

    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("legal_dashboard_session=");
  });

  it("records jtiPresent and revokeSucceeded on the auth.logout audit row", async () => {
    insertUser({ id: "alice", email: "alice@example.test", displayName: "Alice" });
    const app = buildApp();
    const token = signAuthToken({ sub: "alice", exp: 4_102_444_800, jti: "logout-jti-1" }, SECRET);

    const res = await app.request("/api/v1/auth/logout", {
      method: "POST",
      headers: { cookie: `${AUTH_COOKIE_NAME}=${token}` },
    });

    expect(res.status).toBe(200);
    const events = getAuditEvents({ action: "auth.logout" });
    expect(events.length).toBeGreaterThan(0);
    const detail = JSON.parse(events[0].detail_json) as Record<string, unknown>;
    expect(detail.revokeSucceeded).toBe(true);
    expect(detail.jtiPresent).toBe(true);
  });

  it("logs out a pre-v2.38 token without jti without writing to the denylist", async () => {
    insertUser({ id: "alice", email: "alice@example.test", displayName: "Alice" });
    const app = buildApp();
    // Pre-v2.38.0 token shape: valid + active user but no `jti` claim.
    const token = signAuthToken({ sub: "alice", exp: 4_102_444_800 }, SECRET);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await app.request("/api/v1/auth/logout", {
      method: "POST",
      headers: { cookie: `${AUTH_COOKIE_NAME}=${token}` },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ data: { loggedOut: true } });
    expect(res.headers.get("set-cookie")).toContain("legal_dashboard_session=");

    // No jti claim -> revokeJti must NOT run -> denylist stays empty.
    const row = getDb().prepare("SELECT COUNT(*) AS n FROM jwt_denylist").get() as { n: number };
    expect(row.n).toBe(0);

    // ...and the inability to revoke server-side must be observable (side-channel
    // warn), while the audit row still reports jtiPresent:false unchanged.
    // Assert before mockRestore — restore also clears recorded calls in vitest.
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("token lacks jti"));
    warnSpy.mockRestore();
    const events = getAuditEvents({ action: "auth.logout" });
    const detail = JSON.parse(events[0].detail_json) as Record<string, unknown>;
    expect(detail.jtiPresent).toBe(false);
  });

  it("accepts cookie auth and refreshes it into a secure HttpOnly SameSite cookie", async () => {
    insertUser({ id: "alice", email: "alice@example.test", displayName: "Alice" });
    const app = buildApp();
    const token = signAuthToken({ sub: "alice", exp: 4_102_444_800 }, SECRET);

    const res = await app.request("/api/v1/auth/refresh", {
      method: "POST",
      headers: { cookie: `${AUTH_COOKIE_NAME}=${token}` },
    });

    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("legal_dashboard_session=");
    expect(cookie.toLowerCase()).toContain("httponly");
    expect(cookie.toLowerCase()).toContain("secure");
    expect(cookie.toLowerCase()).toContain("samesite=strict");
  });

  it("uses Bearer auth before the session cookie when both are present", async () => {
    insertUser({ id: "alice", email: "alice@example.test", displayName: "Alice" });
    insertUser({ id: "bob", email: "bob@example.test", displayName: "Bob" });
    const app = buildApp();
    const bearer = signAuthToken({ sub: "alice", exp: 4_102_444_800 }, SECRET);
    const cookie = signAuthToken({ sub: "bob", exp: 4_102_444_800 }, SECRET);

    const res = await app.request("/api/v1/probe", {
      headers: {
        authorization: `Bearer ${bearer}`,
        cookie: `${AUTH_COOKIE_NAME}=${cookie}`,
      },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      data: { ownerId: "alice" },
      requestId: expect.any(String),
    });
  });
});
