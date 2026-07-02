// Regresie pentru fix-ul round-4: rutele de management tokenuri (mutatii) TREBUIE sa fie
// montate DUPA originGuard, ca o sesiune cookie/JWT sa fie Origin-checked. Testul reconstruieste
// exact coada de lant din index.ts (ownerContext-stand-in -> originGuard -> apiTokensRouter) cu
// un peer NON-loopback mock-uit (in serverul real toate cererile vin de pe 127.0.0.1 -> originGuard
// face bypass de loopback, deci CSRF-ul nu poate fi exercitat end-to-end acolo).
//
// Daca cineva reintroduce bug-ul (router INAINTE de originGuard), un DELETE cross-origin ar
// ajunge la router (404 "token inexistent") in loc de 403 csrf -> testul 1 pica.

import Database from "better-sqlite3";
import { Hono } from "hono";
import path from "node:path";
import os from "node:os";
import fsPromises from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@hono/node-server/conninfo", () => ({ getConnInfo: vi.fn() }));

import { getConnInfo } from "@hono/node-server/conninfo";
import { closeDb, getDb } from "../db/schema.ts";
import { originGuard } from "../middleware/originGuard.ts";
import { apiTokensRouter } from "./apiTokens.ts";

const mockedConn = vi.mocked(getConnInfo);
let tmpRoot: string;

// Ordinea din index.ts: ... -> originGuard -> apiTokensRouter. Sesiune = ownerId setat, fara tokenId.
function buildApp() {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("ownerId", "alice");
    c.set("actorId", "alice");
    c.set("requestId", "req-test");
    await next();
  });
  app.use("/api/*", originGuard);
  app.route("/api/v1/tokens", apiTokensRouter);
  return app;
}

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-tokcsrf-"));
  process.env.LEGAL_DASHBOARD_DB_PATH = path.join(tmpRoot, "legal-dashboard.db");
  new Database(process.env.LEGAL_DASHBOARD_DB_PATH).close();
  getDb();
  mockedConn.mockReturnValue({ remote: { address: "10.0.0.5" } } as ReturnType<typeof getConnInfo>);
});
afterEach(async () => {
  closeDb();
  vi.restoreAllMocks();
  // biome-ignore lint/performance/noDelete: env trebuie unset real
  delete process.env.LEGAL_DASHBOARD_DB_PATH;
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

describe("token-management routes are Origin-checked (round-4 CSRF fix)", () => {
  it("rejects a cross-origin session DELETE /api/v1/tokens/:id with 403 (originGuard runs before the router)", async () => {
    const res = await buildApp().request("/api/v1/tokens/some-id", {
      method: "DELETE",
      headers: { host: "dashboard.lan", origin: "http://attacker.example" },
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("csrf_origin_mismatch");
  });

  it("lets a same-origin session DELETE reach the router (404 on a missing token, not a CSRF 403)", async () => {
    const res = await buildApp().request("/api/v1/tokens/some-id", {
      method: "DELETE",
      headers: { host: "dashboard.lan", origin: "http://dashboard.lan" },
    });
    expect(res.status).toBe(404); // a trecut de originGuard, tokenul nu exista
  });

  it("rejects a cross-origin session POST /api/v1/tokens/revoke-all with 403", async () => {
    const res = await buildApp().request("/api/v1/tokens/revoke-all", {
      method: "POST",
      headers: { host: "dashboard.lan", origin: "http://attacker.example" },
    });
    expect(res.status).toBe(403);
  });
});
