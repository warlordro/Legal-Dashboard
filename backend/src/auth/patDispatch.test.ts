// Task 7.6 (PAT piesa A) — desktop zero-impact / kill-switch / 401-contract pe
// dispatch-ul din authProvider. Exercita getAuthProvider().authenticate(c) real.

import Database from "better-sqlite3";
import path from "node:path";
import os from "node:os";
import fsPromises from "node:fs/promises";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDb, getDb } from "../db/schema.ts";
import { AuthenticationError, getAuthProvider } from "./authProvider.ts";
import * as apiTokenRepo from "../db/apiTokenRepository.ts";
import { createApiToken } from "../db/apiTokenRepository.ts";
import { insertUser } from "../db/userRepository.ts";

const WEB_SECRET = "test-jwt-secret-with-plenty-of-entropy-0123456789";
const savedEnv = { ...process.env };
let tmpRoot: string;

function probeApp() {
  const app = new Hono();
  app.get("/probe", (c) => {
    try {
      const ctx = getAuthProvider().authenticate(c);
      return c.json({ ownerId: ctx.ownerId, tokenId: ctx.tokenId ?? null, scopes: ctx.tokenScopes ?? null });
    } catch (err) {
      if (err instanceof AuthenticationError) return c.json({ error: err.code }, err.status);
      throw err;
    }
  });
  return app;
}

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-patdisp-"));
  process.env.LEGAL_DASHBOARD_DB_PATH = path.join(tmpRoot, "legal-dashboard.db");
  new Database(process.env.LEGAL_DASHBOARD_DB_PATH).close();
  getDb();
});
afterEach(async () => {
  closeDb();
  vi.restoreAllMocks();
  process.env = { ...savedEnv };
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

describe("PAT dispatch — desktop zero-impact (T-05)", () => {
  it("ignores a ld_pat_ Bearer header in desktop mode with ZERO DB calls", async () => {
    process.env.LEGAL_DASHBOARD_AUTH_MODE = "desktop";
    const spy = vi.spyOn(apiTokenRepo, "findActiveTokenByHash");
    const res = await probeApp().request("/probe", {
      headers: { authorization: "Bearer ld_pat_anything_at_all" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ownerId: string; tokenId: string | null };
    expect(body.ownerId).toBe("local");
    expect(body.tokenId).toBeNull(); // PAT path never taken
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("PAT dispatch — kill switch + resolve (web mode)", () => {
  it("resolves a valid PAT to its owner when the kill switch is off", async () => {
    process.env.LEGAL_DASHBOARD_AUTH_MODE = "web";
    process.env.LEGAL_DASHBOARD_JWT_SECRET = WEB_SECRET;
    // biome-ignore lint/performance/noDelete: env trebuie unset real (= undefined ar seta string-ul)
    delete process.env.LEGAL_DASHBOARD_PAT_DISABLED;
    insertUser({ id: "alice", email: "alice@example.com", displayName: "Alice", status: "active" });
    const { secret } = createApiToken({
      ownerId: "alice",
      name: "mcp",
      scopes: ["dosare"],
      captchaDailyCap: null,
      expiresAt: null,
    });
    const res = await probeApp().request("/probe", { headers: { authorization: `Bearer ${secret}` } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ownerId: string; tokenId: string | null; scopes: string[] | null };
    expect(body.ownerId).toBe("alice");
    expect(body.tokenId).not.toBeNull();
    expect(body.scopes).toEqual(["dosare"]);
  });

  it("rejects the same PAT with 401 when LEGAL_DASHBOARD_PAT_DISABLED=1 (falls to JWT path)", async () => {
    process.env.LEGAL_DASHBOARD_AUTH_MODE = "web";
    process.env.LEGAL_DASHBOARD_JWT_SECRET = WEB_SECRET;
    process.env.LEGAL_DASHBOARD_PAT_DISABLED = "1";
    insertUser({ id: "bob", email: "bob@example.com", displayName: "Bob", status: "active" });
    const { secret } = createApiToken({
      ownerId: "bob",
      name: "mcp",
      scopes: ["dosare"],
      captchaDailyCap: null,
      expiresAt: null,
    });
    const res = await probeApp().request("/probe", { headers: { authorization: `Bearer ${secret}` } });
    expect(res.status).toBe(401); // ld_pat_ is not a valid JWT → unauthorized
  });
});
