// v2.43.x (admin rnpm storage): contract endpoint admin GET /api/v1/admin/rnpm/usage
// — vizibilitate read-only pe consumul de disc RNPM per user (fisier viu + jail
// backup-uri). Harness modelat pe adminBackups.test.ts (buildApp(actAs),
// fixture-uri u1/admin1) + app.onError(appErrorHandler) ca in
// rnpmBackups.contract.test.ts (propagarea EACCES vede envelope-ul 500 real).

import Database from "better-sqlite3";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createRnpmManualBackup } from "../db/backup.ts";
import { __resetRnpmDbForTests, getRnpmDb } from "../db/rnpmDb.ts";
import { measureRnpmStorage } from "../db/rnpmStorageLimit.ts";
import { closeDb, getDb } from "../db/schema.ts";
import { insertUser, updateUserRole } from "../db/userRepository.ts";
import { requestIdContext } from "../middleware/requestId.ts";
import { appErrorHandler } from "../util/appErrorHandler.ts";
import { adminRnpmRouter } from "./adminRnpm.ts";

let tmpRoot: string;

function buildApp(actAs: string) {
  const app = new Hono();
  // Fara acest onError, un throw din ruta ar da 500 text/plain (default Hono),
  // nu envelope-ul {data,error,requestId} pe care il asteapta testul EACCES.
  app.onError(appErrorHandler);
  app.use("*", async (c, next) => {
    c.set("ownerId", actAs);
    await next();
  });
  app.use("*", requestIdContext);
  app.route("/api/v1/admin/rnpm", adminRnpmRouter);
  return app;
}

function seedRnpm(ownerId: string, marker: string): void {
  getRnpmDb(ownerId)
    .prepare("INSERT INTO rnpm_searches (owner_id, search_type, params_json) VALUES (?, 'dupa_nume', ?)")
    .run(ownerId, JSON.stringify({ marker }));
}

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-adminrnpm-"));
  process.env.LEGAL_DASHBOARD_DB_PATH = path.join(tmpRoot, "legal-dashboard.db");
  const seed = new Database(process.env.LEGAL_DASHBOARD_DB_PATH);
  seed.close();
  getDb();
  insertUser({ id: "u1", email: "u1@x", displayName: "U1" });
  insertUser({ id: "u2", email: "u2@x.ro", displayName: "U2", role: "user" });
  insertUser({ id: "admin1", email: "admin1@x", displayName: "Admin" });
  updateUserRole("admin1", "admin");
});

afterEach(async () => {
  vi.restoreAllMocks();
  __resetRnpmDbForTests();
  closeDb();
  // biome-ignore lint/performance/noDelete: process.env trebuie unset real, nu valoare undefined.
  delete process.env.LEGAL_DASHBOARD_DB_PATH;
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

describe("GET /api/v1/admin/rnpm/usage", () => {
  it("intoarce envelope cu un rand per user: dimensiune fisier viu + backups", async () => {
    seedRnpm("u1", "a");
    await createRnpmManualBackup("u1");
    const res = await buildApp("admin1").request("/api/v1/admin/rnpm/usage");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data?: {
        rows?: Array<{
          userId: string;
          dbSizeBytes: number | null;
          storageLimitBytes: number | null;
          backupCount: number;
          backupsBytes: number;
        }>;
      };
      requestId?: string;
    };
    expect(typeof body.requestId).toBe("string");
    const u1 = body.data?.rows?.find((r) => r.userId === "u1");
    const u2 = body.data?.rows?.find((r) => r.userId === "u2");
    const measured = await measureRnpmStorage("u1");
    expect(u1?.dbSizeBytes).toBe(measured.usedBytes);
    expect(u1?.storageLimitBytes).toBe(750 * 1024 * 1024);
    expect(u1?.backupCount).toBe(1);
    expect((u1?.backupsBytes ?? 0) > 0).toBe(true);
    expect(u2?.dbSizeBytes).toBeNull();
    expect(u2?.backupCount).toBe(0);
  });

  it("rolul user primeste 403 (admin-only)", async () => {
    const res = await buildApp("u1").request("/api/v1/admin/rnpm/usage");
    expect(res.status).toBe(403);
  });

  it("eroare FS non-ENOENT la stat pe fisierul unui user => 500 pe envelope (nu date false)", async () => {
    seedRnpm("u1", "a");
    vi.spyOn(fsPromises, "stat").mockRejectedValueOnce(
      Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" })
    );
    const res = await buildApp("admin1").request("/api/v1/admin/rnpm/usage");
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error?: { code?: string }; requestId?: string };
    expect(body.error?.code).toBe("INTERNAL_ERROR");
  });
});
