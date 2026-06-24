import Database from "better-sqlite3";
import path from "node:path";
import os from "node:os";
import fsPromises from "node:fs/promises";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getAuditEvents } from "../db/auditRepository.ts";
import { revokeJti } from "../db/jwtDenylistRepository.ts";
import { closeDb, getDb } from "../db/schema.ts";
import { insertUser } from "../db/userRepository.ts";
import { getActorId, getOwnerId, ownerContext } from "../middleware/owner.ts";
import { requestIdContext } from "../middleware/requestId.ts";
import { signAuthToken } from "./jwt.ts";

const SECRET = "0123456789abcdef0123456789abcdef";

let tmpRoot: string;

interface ErrorBody {
  data: null;
  error: { code: string; message?: string };
  requestId: string;
}

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-auth-provider-"));
  const dbPath = path.join(tmpRoot, "legal-dashboard.db");
  process.env.LEGAL_DASHBOARD_DB_PATH = dbPath;
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
  delete process.env.LEGAL_DASHBOARD_JWT_ISSUER;
  // biome-ignore lint/performance/noDelete: process.env trebuie unset real, nu valoare undefined.
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
    })
  );
  return app;
}

function tokenWithJti(sub: string, jti: string, exp = 4_102_444_800): string {
  return signAuthToken({ sub, jti, exp, iss: "ld", aud: "web" }, SECRET);
}

describe("WebJwtAuthProvider revoked token replay", () => {
  it("rejects a replayed revoked token AND records an auth.jwt_revoked audit row", async () => {
    process.env.LEGAL_DASHBOARD_AUTH_MODE = "web";
    process.env.LEGAL_DASHBOARD_JWT_SECRET = SECRET;
    process.env.LEGAL_DASHBOARD_JWT_ISSUER = "ld";
    process.env.LEGAL_DASHBOARD_JWT_AUDIENCE = "web";
    insertUser({ id: "alice", email: "alice@example.test", displayName: "Alice" });
    const jti = "revoked-jti-1";
    revokeJti(jti, 4_102_444_800, "alice");
    const app = buildApp();

    const res = await app.request("/api/whoami", {
      headers: {
        authorization: `Bearer ${tokenWithJti("alice", jti)}`,
        "user-agent": "vitest-jwt-revoked",
      },
    });

    // (a) auth still rejected
    expect(res.status).toBe(401);
    const body = (await res.json()) as ErrorBody;
    expect(body.error).toMatchObject({
      code: "unauthorized",
      message: "Token de autentificare invalid.",
    });

    // (b) a durable auth.jwt_revoked audit row exists for the replay
    const events = getAuditEvents({ ownerId: null, action: "auth.jwt_revoked" });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      owner_id: null,
      action: "auth.jwt_revoked",
      target_kind: "http_request",
      target_id: "/api/whoami",
      outcome: "denied",
      user_agent: "vitest-jwt-revoked",
      request_id: body.requestId,
    });
    expect(JSON.parse(events[0].detail_json)).toEqual({ jti });
  });
});
