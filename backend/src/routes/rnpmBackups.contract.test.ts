// v2.43.0 (rnpm-split): contract rute self-service backup RNPM owner-scoped.
// Toate mutatiile pastreaza requireDesktopHeader (CSRF desktop, pass-through
// web); self-service = requireRole("admin", "user").

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import fsPromises from "node:fs/promises";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getRnpmBackupDir } from "../db/backup.ts";
import { __resetRnpmActivityForTests, beginRnpmSearch, endRnpmSearch } from "../db/rnpmActivity.ts";
import { __resetRnpmDbForTests, getRnpmDb, getRnpmDbPath, rnpmFileStem } from "../db/rnpmDb.ts";
import { getAuditEvents } from "../db/auditRepository.ts";
import { closeDb, getDb } from "../db/schema.ts";
import { insertUser, updateUserRole } from "../db/userRepository.ts";
import { requestIdContext } from "../middleware/requestId.ts";
import { __resetRnpmBackupCooldownForTests, rnpmRouter } from "./rnpm.ts";

const DESKTOP = { "x-legal-dashboard-desktop": "1" } as const;
const JSON_DESKTOP = { "content-type": "application/json", ...DESKTOP } as const;

let tmpRoot: string;

function buildApp(actAs: string) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("ownerId", actAs);
    await next();
  });
  app.use("*", requestIdContext);
  app.route("/api/rnpm", rnpmRouter);
  return app;
}

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-rnpmbk-route-"));
  process.env.LEGAL_DASHBOARD_DB_PATH = path.join(tmpRoot, "legal-dashboard.db");
  const seed = new Database(process.env.LEGAL_DASHBOARD_DB_PATH);
  seed.close();
  getDb();
  insertUser({ id: "u1", email: "u1@x", displayName: "U1" });
  insertUser({ id: "u2", email: "u2@x", displayName: "U2" });
  insertUser({ id: "admin1", email: "admin1@x", displayName: "Admin" });
  updateUserRole("admin1", "admin");
  __resetRnpmBackupCooldownForTests();
});

afterEach(async () => {
  __resetRnpmActivityForTests();
  __resetRnpmDbForTests();
  closeDb();
  // biome-ignore lint/performance/noDelete: process.env trebuie unset real, nu valoare undefined.
  delete process.env.LEGAL_DASHBOARD_DB_PATH;
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

function seedRnpm(ownerId: string, marker: string): void {
  getRnpmDb(ownerId)
    .prepare("INSERT INTO rnpm_searches (owner_id, search_type, params_json) VALUES (?, 'dupa_nume', ?)")
    .run(ownerId, JSON.stringify({ marker }));
}

async function createBackupAs(actAs: string): Promise<string> {
  __resetRnpmBackupCooldownForTests();
  const res = await buildApp(actAs).request("/api/rnpm/backups/create", { method: "POST", headers: DESKTOP });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { ok: boolean; name: string };
  expect(body.ok).toBe(true);
  return body.name;
}

describe("GET /api/rnpm/backups — jail-ul callerului", () => {
  it("userul vede doar jail-ul lui; ?ownerId strain e ignorat silentios pentru non-admin", async () => {
    seedRnpm("u1", "a");
    const name = await createBackupAs("u1");

    const own = await buildApp("u1").request("/api/rnpm/backups");
    expect(own.status).toBe(200);
    expect(((await own.json()) as { backups: { name: string }[] }).backups.map((b) => b.name)).toContain(name);

    const other = await buildApp("u2").request("/api/rnpm/backups");
    expect(((await other.json()) as { backups: unknown[] }).backups).toEqual([]);

    // Non-admin cu ?ownerId=u1: primeste tot jail-ul PROPRIU (u2, gol), nu 403.
    const sneaky = await buildApp("u2").request("/api/rnpm/backups?ownerId=u1");
    expect(sneaky.status).toBe(200);
    expect(((await sneaky.json()) as { backups: unknown[] }).backups).toEqual([]);
  });

  it("adminul cu ?ownerId=u1 vede jail-ul lui u1", async () => {
    seedRnpm("u1", "a");
    const name = await createBackupAs("u1");
    const res = await buildApp("admin1").request("/api/rnpm/backups?ownerId=u1");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { backups: { name: string }[] }).backups.map((b) => b.name)).toContain(name);
  });
});

describe("POST /api/rnpm/backups/create", () => {
  it("creeaza backup-ul in jail-ul propriu + audit backup.rnpm.create", async () => {
    seedRnpm("u1", "a");
    const name = await createBackupAs("u1");
    expect(name).toMatch(/^rnpm\.manual-/);
    expect(fs.existsSync(path.join(getRnpmBackupDir("u1"), name))).toBe(true);
    const audits = getAuditEvents({ action: "backup.rnpm.create" });
    expect(audits.length).toBe(1);
  });

  it("cooldown 60s per owner: al doilea create imediat => 429 cu Retry-After", async () => {
    seedRnpm("u1", "a");
    const app = buildApp("u1");
    const first = await app.request("/api/rnpm/backups/create", { method: "POST", headers: DESKTOP });
    expect(first.status).toBe(200);
    const second = await app.request("/api/rnpm/backups/create", { method: "POST", headers: DESKTOP });
    expect(second.status).toBe(429);
    expect(second.headers.get("Retry-After")).toMatch(/^\d+$/);
    // Alt owner NU e afectat de cooldown-ul lui u1.
    const other = await buildApp("u2").request("/api/rnpm/backups/create", { method: "POST", headers: DESKTOP });
    expect(other.status).toBe(200);
  });

  it("fara header desktop in mod desktop => 403", async () => {
    const res = await buildApp("u1").request("/api/rnpm/backups/create", { method: "POST" });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/rnpm/backups/restore", () => {
  it("restore pe fisierul propriu: datele post-backup dispar, pre-restore snapshot raportat", async () => {
    seedRnpm("u1", "pre");
    const name = await createBackupAs("u1");
    seedRnpm("u1", "post");
    __resetRnpmDbForTests();

    const res = await buildApp("u1").request("/api/rnpm/backups/restore", {
      method: "POST",
      headers: JSON_DESKTOP,
      body: JSON.stringify({ name }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; preRestoreName: string };
    expect(body.ok).toBe(true);
    expect(body.preRestoreName).toMatch(/^rnpm\.pre-restore-/);

    const n = (getRnpmDb("u1").prepare("SELECT COUNT(*) AS n FROM rnpm_searches").get() as { n: number }).n;
    expect(n).toBe(1);
  });

  it("non-admin cu body { name, ownerId: 'u2' } => opereaza pe fisierul PROPRIU; u2 byte-identic", async () => {
    seedRnpm("u1", "a");
    seedRnpm("u2", "b");
    const name = await createBackupAs("u1");
    seedRnpm("u1", "extra");
    __resetRnpmDbForTests();
    const u2Bytes = fs.readFileSync(getRnpmDbPath("u2"));

    const res = await buildApp("u1").request("/api/rnpm/backups/restore", {
      method: "POST",
      headers: JSON_DESKTOP,
      body: JSON.stringify({ name, ownerId: "u2" }),
    });
    expect(res.status).toBe(200);

    // u1 a fost restaurat (1 rand), u2 ramane byte-identic.
    expect((getRnpmDb("u1").prepare("SELECT COUNT(*) AS n FROM rnpm_searches").get() as { n: number }).n).toBe(1);
    expect(fs.readFileSync(getRnpmDbPath("u2")).equals(u2Bytes)).toBe(true);
  });

  it("admin cu { name, ownerId: 'u1' } => restaureaza fisierul lui u1 + audit cu targetOwnerId", async () => {
    seedRnpm("u1", "a");
    const name = await createBackupAs("u1");
    seedRnpm("u1", "post");
    __resetRnpmDbForTests();

    const res = await buildApp("admin1").request("/api/rnpm/backups/restore", {
      method: "POST",
      headers: JSON_DESKTOP,
      body: JSON.stringify({ name, ownerId: "u1" }),
    });
    expect(res.status).toBe(200);
    expect((getRnpmDb("u1").prepare("SELECT COUNT(*) AS n FROM rnpm_searches").get() as { n: number }).n).toBe(1);

    const audits = getAuditEvents({ action: "backup.rnpm.restore" });
    expect(audits.length).toBe(1);
    expect(JSON.parse(audits[0].detail_json ?? "{}").targetOwnerId).toBe("u1");
  });

  it("409 SEARCH_ACTIVE cand ownerul are o cautare in zbor", async () => {
    seedRnpm("u1", "a");
    const name = await createBackupAs("u1");
    beginRnpmSearch("u1");
    try {
      const res = await buildApp("u1").request("/api/rnpm/backups/restore", {
        method: "POST",
        headers: JSON_DESKTOP,
        body: JSON.stringify({ name }),
      });
      expect(res.status).toBe(409);
      expect(((await res.json()) as { error?: { code: string } }).error?.code).toBe("SEARCH_ACTIVE");
    } finally {
      endRnpmSearch("u1");
    }
  });

  it("nume invalid / traversal => 400 INVALID_PARAMS, nu 500", async () => {
    seedRnpm("u1", "a");
    await createBackupAs("u1");
    for (const bad of ["../evil.db", "rnpm.a/b.db", "legal-dashboard.2026-01-01.db", "x".repeat(10)]) {
      const res = await buildApp("u1").request("/api/rnpm/backups/restore", {
        method: "POST",
        headers: JSON_DESKTOP,
        body: JSON.stringify({ name: bad }),
      });
      expect(res.status, bad).toBe(400);
      expect(((await res.json()) as { error?: { code: string } }).error?.code).toBe("INVALID_PARAMS");
    }
  });
});

describe("DELETE /api/rnpm/backups", () => {
  it("sterge doar jail-ul propriu + audit", async () => {
    seedRnpm("u1", "a");
    seedRnpm("u2", "b");
    await createBackupAs("u1");
    const nameU2 = await createBackupAs("u2");

    const res = await buildApp("u1").request("/api/rnpm/backups", { method: "DELETE", headers: DESKTOP });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { deleted: number }).deleted).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(path.join(getRnpmBackupDir("u2"), nameU2))).toBe(true);
    expect(getAuditEvents({ action: "backup.rnpm.delete_all" }).length).toBe(1);
  });
});

describe("rutele pe fisierul callerului (stats/compact/delete-all)", () => {
  it("GET /stats raporteaza fisierul per user (stem), nu monolitul", async () => {
    seedRnpm("u1", "a");
    const res = await buildApp("u1").request("/api/rnpm/stats", { headers: DESKTOP });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { total: number; db: { path: string; sizeBytes: number } };
    expect(path.basename(body.db.path)).toBe(`${rnpmFileStem("u1")}.db`);
    expect(body.db.sizeBytes).toBeGreaterThan(0);
  });

  it("POST /compact ruleaza pe fisierul callerului si e permis rolului user", async () => {
    seedRnpm("u1", "a");
    const res = await buildApp("u1").request("/api/rnpm/compact", { method: "POST", headers: DESKTOP });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; beforeBytes: number; afterBytes: number };
    expect(body.ok).toBe(true);
    expect(body.beforeBytes).toBeGreaterThan(0);
  });

  it("DELETE /saved/all e self-service si refuza cu 409 SEARCH_ACTIVE in timpul unei cautari", async () => {
    seedRnpm("u1", "a");
    beginRnpmSearch("u1");
    try {
      const res = await buildApp("u1").request("/api/rnpm/saved/all", { method: "DELETE", headers: DESKTOP });
      expect(res.status).toBe(409);
      expect(((await res.json()) as { error?: { code: string } }).error?.code).toBe("SEARCH_ACTIVE");
    } finally {
      endRnpmSearch("u1");
    }
    const ok = await buildApp("u1").request("/api/rnpm/saved/all", { method: "DELETE", headers: DESKTOP });
    expect(ok.status).toBe(200);
  });

  it("POST /saved/delete-batch refuza cu 409 SEARCH_ACTIVE in timpul unei cautari", async () => {
    seedRnpm("u1", "a");
    beginRnpmSearch("u1");
    try {
      const res = await buildApp("u1").request("/api/rnpm/saved/delete-batch", {
        method: "POST",
        headers: JSON_DESKTOP,
        body: JSON.stringify({ ids: [1] }),
      });
      expect(res.status).toBe(409);
      expect(((await res.json()) as { error?: { code: string } }).error?.code).toBe("SEARCH_ACTIVE");
    } finally {
      endRnpmSearch("u1");
    }
  });
});
