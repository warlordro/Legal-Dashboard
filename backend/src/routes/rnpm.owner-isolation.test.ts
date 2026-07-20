// Alice/Bob owner-isolation contract tests for /api/v1/rnpm.*
//
// Web-readiness closure (v2.12.0 deep-review remediation): the read/delete
// paths in routes/rnpm.ts must use `getOwnerId(c)` end-to-end so that two
// authenticated users on the same backend cannot observe or destroy each
// other's RNPM avize / search history.
//
// On desktop we seed user "local" + role admin (mirrors rnpm.contract.test.ts)
// and let the test middleware stamp `x-test-owner: alice|bob` on the Hono
// context as the resolved ownerId. The repos remain ownerId-aware (default
// "local" if not provided) — the gap fixed here was the routes silently
// dropping the value.
//
// Coverage:
//   - GET /saved (list) — Bob cannot see Alice's rows
//   - GET /saved/:id (detail) — 404 for the wrong owner
//   - POST /saved/export — bulk-by-id strips foreign rows
//   - DELETE /saved/:id — wrong owner returns deleted:false
//   - DELETE /saved/all — admin scope is owner-bounded (does not nuke other tenants)
//   - POST /saved/delete-batch — wrong-owner ids are no-ops
//   - GET /searches — owner isolation
//   - DELETE /searches/:id — wrong-owner is no-op
//   - GET /stats — counts are per-owner

import Database from "better-sqlite3";
import path from "node:path";
import os from "node:os";
import fsPromises from "node:fs/promises";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { rnpmRouter } from "./rnpm.ts";
import { closeDb, getDb } from "../db/schema.ts";
import { __resetRnpmDbForTests } from "../db/rnpmDb.ts";
import { saveAvizFull } from "../db/avizRepository.ts";
import { saveSearch } from "../db/searchRepository.ts";
import { insertUser, updateUserRole } from "../db/userRepository.ts";

let tmpRoot: string;

function buildApp() {
  const app = new Hono();
  // Mimics the production ownerContext middleware for tests: stamp an explicit
  // ownerId from the `x-test-owner` header so the rnpm router sees a stable
  // identity per request without spinning up the JWT auth provider.
  app.use("*", async (c, next) => {
    const fakeOwner = c.req.header("x-test-owner") ?? "local";
    c.set("ownerId", fakeOwner);
    c.set("actorId", fakeOwner);
    await next();
  });
  app.route("/api/v1/rnpm", rnpmRouter);
  return app;
}

async function jsonOf<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

function seedAvizFor(ownerId: string, identificator: string, opts?: { searchType?: string; activ?: boolean }): number {
  return saveAvizFull({
    ownerId,
    uuid: `uuid-${ownerId}-${identificator}`,
    identificator,
    searchType: opts?.searchType ?? "ipoteci",
    tip: "Aviz initial",
    data: "01.04.2026",
    activ: opts?.activ ?? true,
  });
}

function seedSearchFor(ownerId: string, searchType = "ipoteci"): number {
  return saveSearch({ ownerId, searchType, paramsJson: "{}", totalResults: 1 });
}

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-rnpm-isolation-"));
  const dbPath = path.join(tmpRoot, "legal-dashboard.db");
  process.env.LEGAL_DASHBOARD_DB_PATH = dbPath;
  const seed = new Database(dbPath);
  seed.close();
  getDb();

  // requireRole("admin") on /saved/all needs each test owner to be admin in
  // order to exercise the owner-scoped delete path. In production each web
  // tenant would be its own admin within their data scope.
  insertUser({ id: "alice", email: "alice@example.com", displayName: "Alice", role: "admin" });
  insertUser({ id: "bob", email: "bob@example.com", displayName: "Bob", role: "admin" });
  // Default seed user `local` from migration 0002 stays as user (irrelevant here).
  void updateUserRole;
});

afterEach(async () => {
  __resetRnpmDbForTests();
  closeDb();
  // biome-ignore lint/performance/noDelete: process.env trebuie unset real, nu valoare undefined.
  delete process.env.LEGAL_DASHBOARD_DB_PATH;
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

describe("RNPM owner isolation — Alice vs Bob", () => {
  describe("GET /saved", () => {
    it("Bob never sees Alice's avize in the list", async () => {
      seedAvizFor("alice", "AV-ALICE-1");
      seedAvizFor("alice", "AV-ALICE-2");
      seedAvizFor("bob", "AV-BOB-1");

      const aliceRes = await buildApp().request("/api/v1/rnpm/saved", {
        headers: { "x-test-owner": "alice" },
      });
      const aliceBody = await jsonOf<{ items: Array<{ identificator: string; owner_id: string }>; total: number }>(
        aliceRes
      );
      expect(aliceBody.total).toBe(2);
      for (const r of aliceBody.items) expect(r.owner_id).toBe("alice");
      expect(aliceBody.items.map((r) => r.identificator).sort()).toEqual(["AV-ALICE-1", "AV-ALICE-2"]);

      const bobRes = await buildApp().request("/api/v1/rnpm/saved", {
        headers: { "x-test-owner": "bob" },
      });
      const bobBody = await jsonOf<{ items: Array<{ identificator: string; owner_id: string }>; total: number }>(
        bobRes
      );
      expect(bobBody.total).toBe(1);
      expect(bobBody.items[0].owner_id).toBe("bob");
      expect(bobBody.items[0].identificator).toBe("AV-BOB-1");
    });

    it("search-text filter does not leak rows across owners", async () => {
      // Same identifier under both owners; q= must scope to caller's owner.
      seedAvizFor("alice", "SHARED-IDENT");
      seedAvizFor("bob", "SHARED-IDENT");
      const res = await buildApp().request("/api/v1/rnpm/saved?q=SHARED-IDENT", {
        headers: { "x-test-owner": "alice" },
      });
      const body = await jsonOf<{ items: Array<{ owner_id: string }>; total: number }>(res);
      expect(body.total).toBe(1);
      expect(body.items[0].owner_id).toBe("alice");
    });
  });

  describe("GET /saved/:id", () => {
    it("Bob gets 404 when fetching Alice's aviz id", async () => {
      const aliceId = seedAvizFor("alice", "AV-PRIVATE");
      const res = await buildApp().request(`/api/v1/rnpm/saved/${aliceId}`, {
        headers: { "x-test-owner": "bob" },
      });
      expect(res.status).toBe(404);
      const body = await jsonOf<{ error: { code: string; message: string } }>(res);
      expect(body.error.code).toBe("NOT_FOUND");
      expect(typeof body.error.message).toBe("string");
    });

    it("Alice can fetch her own aviz", async () => {
      const aliceId = seedAvizFor("alice", "AV-OWN");
      const res = await buildApp().request(`/api/v1/rnpm/saved/${aliceId}`, {
        headers: { "x-test-owner": "alice" },
      });
      expect(res.status).toBe(200);
      const body = await jsonOf<{ aviz: { id: number; owner_id: string } }>(res);
      expect(body.aviz.id).toBe(aliceId);
      expect(body.aviz.owner_id).toBe("alice");
    });
  });

  describe("POST /saved/export", () => {
    it("Bob cannot export Alice's aviz by id (foreign id is dropped, not 500'd)", async () => {
      const aliceId = seedAvizFor("alice", "AV-EXPORT-ALICE");
      const bobId = seedAvizFor("bob", "AV-EXPORT-BOB");

      const res = await buildApp().request("/api/v1/rnpm/saved/export", {
        method: "POST",
        headers: { "content-type": "application/json", "x-test-owner": "bob" },
        body: JSON.stringify({ ids: [aliceId, bobId] }),
      });
      expect(res.status).toBe(200);
      const body = await jsonOf<{ items: Array<{ aviz: { id: number; owner_id: string } }> }>(res);
      // Only Bob's aviz comes back; Alice's id is silently filtered by the
      // `WHERE owner_id = ?` clause in the repository.
      expect(body.items.length).toBe(1);
      expect(body.items[0].aviz.id).toBe(bobId);
      expect(body.items[0].aviz.owner_id).toBe("bob");
    });
  });

  describe("DELETE /saved/:id", () => {
    it("Bob deleting Alice's id returns deleted:false and the row stays", async () => {
      const aliceId = seedAvizFor("alice", "AV-DEL-ALICE");

      const res = await buildApp().request(`/api/v1/rnpm/saved/${aliceId}`, {
        method: "DELETE",
        headers: { "x-test-owner": "bob" },
      });
      expect(res.status).toBe(200);
      const body = await jsonOf<{ deleted: boolean }>(res);
      expect(body.deleted).toBe(false);

      // Verify Alice still has her row.
      const verify = await buildApp().request(`/api/v1/rnpm/saved/${aliceId}`, {
        headers: { "x-test-owner": "alice" },
      });
      expect(verify.status).toBe(200);
    });
  });

  describe("DELETE /saved/all", () => {
    it("Bob deleting all wipes only Bob's rows; Alice's stay", async () => {
      seedAvizFor("alice", "AV-KEEP-1");
      seedAvizFor("alice", "AV-KEEP-2");
      seedAvizFor("bob", "AV-WIPE-1");
      seedAvizFor("bob", "AV-WIPE-2");
      seedAvizFor("bob", "AV-WIPE-3");

      const res = await buildApp().request("/api/v1/rnpm/saved/all", {
        method: "DELETE",
        headers: { "x-test-owner": "bob", "x-legal-dashboard-desktop": "1" },
      });
      expect(res.status).toBe(200);
      const body = await jsonOf<{ deleted: number }>(res);
      expect(body.deleted).toBe(3);

      // Alice's rows are intact.
      const aliceList = await buildApp().request("/api/v1/rnpm/saved", {
        headers: { "x-test-owner": "alice" },
      });
      const aliceBody = await jsonOf<{ total: number }>(aliceList);
      expect(aliceBody.total).toBe(2);

      // Bob is empty.
      const bobList = await buildApp().request("/api/v1/rnpm/saved", {
        headers: { "x-test-owner": "bob" },
      });
      const bobBody = await jsonOf<{ total: number }>(bobList);
      expect(bobBody.total).toBe(0);
    });
  });

  describe("POST /saved/delete-batch", () => {
    it("foreign ids in the batch are silently ignored; owner ids deleted", async () => {
      const aliceId = seedAvizFor("alice", "AV-BATCH-ALICE");
      const bobId1 = seedAvizFor("bob", "AV-BATCH-BOB-1");
      const bobId2 = seedAvizFor("bob", "AV-BATCH-BOB-2");

      const res = await buildApp().request("/api/v1/rnpm/saved/delete-batch", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-test-owner": "bob",
          "x-legal-dashboard-desktop": "1",
        },
        body: JSON.stringify({ ids: [aliceId, bobId1, bobId2] }),
      });
      expect(res.status).toBe(200);
      const body = await jsonOf<{ deleted: number }>(res);
      expect(body.deleted).toBe(2);

      // Alice's row survived.
      const verifyAlice = await buildApp().request(`/api/v1/rnpm/saved/${aliceId}`, {
        headers: { "x-test-owner": "alice" },
      });
      expect(verifyAlice.status).toBe(200);
    });
  });

  describe("GET /searches", () => {
    it("Bob's search history excludes Alice's rows", async () => {
      seedSearchFor("alice", "ipoteci");
      seedSearchFor("alice", "fiducii");
      seedSearchFor("bob", "specifice");

      const res = await buildApp().request("/api/v1/rnpm/searches", {
        headers: { "x-test-owner": "bob" },
      });
      expect(res.status).toBe(200);
      const body = await jsonOf<{ items: Array<{ owner_id: string; search_type: string }> }>(res);
      expect(body.items.length).toBe(1);
      expect(body.items[0].owner_id).toBe("bob");
      expect(body.items[0].search_type).toBe("specifice");
    });
  });

  describe("DELETE /searches/:id", () => {
    it("Bob deleting Alice's search id returns deleted:false", async () => {
      const aliceSearchId = seedSearchFor("alice");
      const res = await buildApp().request(`/api/v1/rnpm/searches/${aliceSearchId}`, {
        method: "DELETE",
        headers: { "x-test-owner": "bob" },
      });
      expect(res.status).toBe(200);
      const body = await jsonOf<{ deleted: boolean }>(res);
      expect(body.deleted).toBe(false);

      // Alice still sees her search history.
      const list = await buildApp().request("/api/v1/rnpm/searches", {
        headers: { "x-test-owner": "alice" },
      });
      const listBody = await jsonOf<{ items: Array<{ id: number }> }>(list);
      expect(listBody.items.some((r) => r.id === aliceSearchId)).toBe(true);
    });
  });

  describe("GET /stats", () => {
    it("counts are per-owner", async () => {
      seedAvizFor("alice", "AV-S-A1");
      seedAvizFor("alice", "AV-S-A2", { searchType: "fiducii", activ: false });
      seedAvizFor("bob", "AV-S-B1");

      const aliceRes = await buildApp().request("/api/v1/rnpm/stats", {
        headers: { "x-test-owner": "alice" },
      });
      const aliceBody = await jsonOf<{ total: number; activ: number; inactiv: number; byType: Record<string, number> }>(
        aliceRes
      );
      expect(aliceBody.total).toBe(2);
      expect(aliceBody.activ).toBe(1);
      expect(aliceBody.inactiv).toBe(1);
      expect(aliceBody.byType.ipoteci).toBe(1);
      expect(aliceBody.byType.fiducii).toBe(1);

      const bobRes = await buildApp().request("/api/v1/rnpm/stats", {
        headers: { "x-test-owner": "bob" },
      });
      const bobBody = await jsonOf<{ total: number; activ: number }>(bobRes);
      expect(bobBody.total).toBe(1);
      expect(bobBody.activ).toBe(1);
    });
  });
});
