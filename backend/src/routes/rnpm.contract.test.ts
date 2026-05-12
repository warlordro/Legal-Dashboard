// Characterization tests for /api/v1/rnpm.* routes.
//
// These lock the *current* response shapes so the future PR-6 migration to the
// `{ data, error, requestId }` v1 envelope (`@hono/zod-openapi` adoption) is
// detectable in CI rather than discovered by callers. The rnpm router today
// returns bare objects (`{ items, total, ... }` on success, `{ error: "..." }`
// on failure) — that is intentional per backend/src/util/envelope.ts:
//
//   "Legacy non-envelope routes (dosare, termene, rnpm, ai) intentionally
//    remain as-is — those are pre-PR-3 and rewriting them is out of scope
//    until PR-6 (`@hono/zod-openapi` adoption) standardizes everything."
//
// Scope:
//   - Only routes that don't require external network (no real RNPM SOAP /
//     captcha provider / Electron shell) are exercised end-to-end.
//   - Assertions check key/type contracts, not business logic — saveAvizFull
//     and saveSearch from the repositories supply seed rows so the shape of
//     `{ items, total, page, pageSize }` etc. can be verified.
//   - Network-dependent routes (POST /search, POST /bulk, POST /captcha/balance
//     happy path) are exercised only on their input-validation branches, where
//     the response shape is predictable.

import Database from "better-sqlite3";
import path from "node:path";
import os from "node:os";
import fsPromises from "node:fs/promises";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { rnpmRouter } from "./rnpm.ts";
import { closeDb, getDb } from "../db/schema.ts";
import { saveAvizFull } from "../db/avizRepository.ts";
import { saveSearch } from "../db/searchRepository.ts";
import { updateUserRole } from "../db/userRepository.ts";

let tmpRoot: string;

function buildApp() {
  // v2.11.0 web-readiness closure: rutele globale (/saved/all, /compact,
  // /backups, /backups/restore, /open-*-folder) sunt gated de
  // requireRole("admin"). Pe desktop, getOwnerId(c) returneaza fallback
  // "local"; testele seed-uiesc un user `local` cu role=admin in beforeEach
  // ca guard-ul sa lase requestul prin. Restul rutelor (/saved, /searches,
  // /stats) raman fara guard si folosesc ownerId-ul fallback fara probleme.
  const app = new Hono();
  app.route("/api/v1/rnpm", rnpmRouter);
  return app;
}

async function jsonOf<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

function seedAviz(opts: {
  identificator: string;
  searchType?: string;
  tip?: string;
  data?: string;
  activ?: boolean | null;
}): number {
  return saveAvizFull({
    uuid: `uuid-${opts.identificator}`,
    identificator: opts.identificator,
    searchType: opts.searchType ?? "ipoteci",
    tip: opts.tip ?? "Aviz initial",
    data: opts.data ?? "01.04.2026",
    activ: opts.activ === undefined ? true : opts.activ,
  });
}

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-rnpm-contract-"));
  const dbPath = path.join(tmpRoot, "legal-dashboard.db");
  process.env.LEGAL_DASHBOARD_DB_PATH = dbPath;
  const seed = new Database(dbPath);
  seed.close();
  getDb();
  // v2.11.0 closure: rute /saved/all, /compact, /backups* sunt gated admin.
  // Migration 0002 seed-uieste user-ul `local` cu role=user; promovam la admin
  // ca requireRole("admin") sa accepte requesturile (in productie, owner-ul
  // desktop e admin via 0006_admin_roles bootstrap, vezi `setupBootstrapAdmin`).
  updateUserRole("local", "admin");
});

afterEach(async () => {
  closeDb();
  Reflect.deleteProperty(process.env, "LEGAL_DASHBOARD_DB_PATH");
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

describe("GET /api/v1/rnpm/saved", () => {
  it("returns { items: [], total: 0, page, pageSize } on empty DB", async () => {
    const res = await buildApp().request("/api/v1/rnpm/saved");
    expect(res.status).toBe(200);
    const body = await jsonOf<{ items: unknown[]; total: number; page: number; pageSize: number }>(res);
    expect(body.items).toEqual([]);
    expect(body.total).toBe(0);
    expect(typeof body.page).toBe("number");
    expect(typeof body.pageSize).toBe("number");
  });

  it("returns populated items with the AvizRecord column shape", async () => {
    seedAviz({ identificator: "AV-1" });
    seedAviz({ identificator: "AV-2", activ: false });
    const res = await buildApp().request("/api/v1/rnpm/saved");
    const body = await jsonOf<{ items: Array<Record<string, unknown>>; total: number }>(res);
    expect(body.total).toBe(2);
    expect(body.items.length).toBe(2);
    // Lock the row column set used by the React table (frontend/src/lib/rnpmApi.ts).
    const row = body.items[0];
    for (const key of [
      "id",
      "owner_id",
      "uuid",
      "identificator",
      "search_type",
      "tip",
      "data",
      "activ",
      "needs_actualizare",
      "detail_fetched",
      "created_at",
      "updated_at",
    ]) {
      expect(row).toHaveProperty(key);
    }
  });

  it("preserves activ null for RNPM rows with unknown status", async () => {
    seedAviz({ identificator: "AV-UNKNOWN", activ: null });

    const res = await buildApp().request("/api/v1/rnpm/saved");
    expect(res.status).toBe(200);
    const body = await jsonOf<{ items: Array<Record<string, unknown>>; total: number }>(res);

    expect(body.total).toBe(1);
    expect(body.items[0].activ).toBeNull();
  });
});

describe("GET /api/v1/rnpm/saved/:id", () => {
  it("returns 404 + { error } when missing", async () => {
    const res = await buildApp().request("/api/v1/rnpm/saved/9999");
    expect(res.status).toBe(404);
    const body = await jsonOf<{ error: string }>(res);
    expect(typeof body.error).toBe("string");
  });

  it("returns 400 + { error } when id is non-numeric", async () => {
    const res = await buildApp().request("/api/v1/rnpm/saved/notanumber");
    expect(res.status).toBe(400);
    const body = await jsonOf<{ error: string }>(res);
    expect(typeof body.error).toBe("string");
  });

  it("returns AvizFull shape { aviz, creditori, debitori, bunuri, istoric } when found", async () => {
    const id = seedAviz({ identificator: "AV-LOOKUP" });
    const res = await buildApp().request(`/api/v1/rnpm/saved/${id}`);
    expect(res.status).toBe(200);
    const body = await jsonOf<Record<string, unknown>>(res);
    for (const key of ["aviz", "creditori", "debitori", "bunuri", "istoric"]) {
      expect(body).toHaveProperty(key);
    }
    expect(Array.isArray(body.creditori)).toBe(true);
    expect(Array.isArray(body.debitori)).toBe(true);
    expect(Array.isArray(body.bunuri)).toBe(true);
    expect(Array.isArray(body.istoric)).toBe(true);
  });
});

describe("DELETE /api/v1/rnpm/saved/:id", () => {
  it("returns { deleted: true } when row existed", async () => {
    const id = seedAviz({ identificator: "AV-DEL" });
    const res = await buildApp().request(`/api/v1/rnpm/saved/${id}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    const body = await jsonOf<{ deleted: boolean }>(res);
    expect(body.deleted).toBe(true);
  });

  it("returns { deleted: false } when row missing", async () => {
    const res = await buildApp().request("/api/v1/rnpm/saved/9999", { method: "DELETE" });
    expect(res.status).toBe(200);
    const body = await jsonOf<{ deleted: boolean }>(res);
    expect(body.deleted).toBe(false);
  });

  it("returns 400 + { error } on non-numeric id", async () => {
    const res = await buildApp().request("/api/v1/rnpm/saved/notanumber", { method: "DELETE" });
    expect(res.status).toBe(400);
    const body = await jsonOf<{ error: string }>(res);
    expect(typeof body.error).toBe("string");
  });
});

describe("DELETE /api/v1/rnpm/saved/all", () => {
  it("returns { deleted: <count> }", async () => {
    seedAviz({ identificator: "AV-A" });
    seedAviz({ identificator: "AV-B" });
    const res = await buildApp().request("/api/v1/rnpm/saved/all", { method: "DELETE" });
    expect(res.status).toBe(200);
    const body = await jsonOf<{ deleted: number }>(res);
    expect(body.deleted).toBe(2);
  });
});

describe("POST /api/v1/rnpm/saved/delete-batch", () => {
  it("returns { deleted: <count> } when ids match rows", async () => {
    const id1 = seedAviz({ identificator: "AV-BATCH-1" });
    const id2 = seedAviz({ identificator: "AV-BATCH-2" });
    const res = await buildApp().request("/api/v1/rnpm/saved/delete-batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: [id1, id2] }),
    });
    expect(res.status).toBe(200);
    const body = await jsonOf<{ deleted: number }>(res);
    expect(body.deleted).toBe(2);
  });

  it("returns 400 + { error } on empty list", async () => {
    const res = await buildApp().request("/api/v1/rnpm/saved/delete-batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: [] }),
    });
    expect(res.status).toBe(400);
    const body = await jsonOf<{ error: string }>(res);
    expect(typeof body.error).toBe("string");
  });

  it("returns 400 + { error } when JSON body is malformed", async () => {
    const res = await buildApp().request("/api/v1/rnpm/saved/delete-batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
    const body = await jsonOf<{ error: string }>(res);
    expect(typeof body.error).toBe("string");
  });
});

describe("POST /api/v1/rnpm/saved/export", () => {
  it("returns { items: AvizFull[] } with the requested ids", async () => {
    const id = seedAviz({ identificator: "AV-EXP" });
    const res = await buildApp().request("/api/v1/rnpm/saved/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: [id] }),
    });
    expect(res.status).toBe(200);
    const body = await jsonOf<{ items: Array<{ aviz: { id: number } }> }>(res);
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBe(1);
    expect(body.items[0].aviz.id).toBe(id);
  });

  it("returns 400 + { error } on empty ids array", async () => {
    const res = await buildApp().request("/api/v1/rnpm/saved/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: [] }),
    });
    expect(res.status).toBe(400);
    const body = await jsonOf<{ error: string }>(res);
    expect(typeof body.error).toBe("string");
  });
});

describe("GET /api/v1/rnpm/stats", () => {
  it("returns { total, activ, inactiv, byType, db: { path, sizeBytes } }", async () => {
    seedAviz({ identificator: "AV-STAT-1" });
    seedAviz({ identificator: "AV-STAT-2", searchType: "fiducii", activ: false });

    const res = await buildApp().request("/api/v1/rnpm/stats");
    expect(res.status).toBe(200);
    const body = await jsonOf<{
      total: number;
      activ: number;
      inactiv: number;
      byType: Record<string, number>;
      db: { path: string; sizeBytes: number };
    }>(res);
    expect(body.total).toBe(2);
    expect(body.activ).toBe(1);
    expect(body.inactiv).toBe(1);
    expect(body.byType.ipoteci).toBe(1);
    expect(body.byType.fiducii).toBe(1);
    expect(typeof body.db.path).toBe("string");
    expect(typeof body.db.sizeBytes).toBe("number");
  });
});

describe("GET /api/v1/rnpm/searches", () => {
  it("returns { items: [], nextCursor: null } on empty DB", async () => {
    const res = await buildApp().request("/api/v1/rnpm/searches");
    expect(res.status).toBe(200);
    const body = await jsonOf<{ items: unknown[]; nextCursor: number | null }>(res);
    expect(body.items).toEqual([]);
    expect(body.nextCursor).toBeNull();
  });

  it("returns SearchRecord shape with cursor pagination metadata", async () => {
    saveSearch({ searchType: "ipoteci", paramsJson: "{}", totalResults: 5, criteriu: "test" });
    saveSearch({ searchType: "fiducii", paramsJson: "{}", totalResults: 1 });

    const res = await buildApp().request("/api/v1/rnpm/searches?limit=10");
    const body = await jsonOf<{
      items: Array<Record<string, unknown>>;
      nextCursor: number | null;
    }>(res);
    expect(body.items.length).toBe(2);
    expect(body.nextCursor).toBeNull();
    for (const key of ["id", "owner_id", "search_type", "params_json", "total_results", "criteriu", "created_at"]) {
      expect(body.items[0]).toHaveProperty(key);
    }
  });
});

describe("DELETE /api/v1/rnpm/searches/:id", () => {
  it("returns { deleted: true } on existing row", async () => {
    const id = saveSearch({ searchType: "ipoteci", paramsJson: "{}", totalResults: 0 });
    const res = await buildApp().request(`/api/v1/rnpm/searches/${id}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    const body = await jsonOf<{ deleted: boolean }>(res);
    expect(body.deleted).toBe(true);
  });

  it("returns { deleted: false } when row missing", async () => {
    const res = await buildApp().request("/api/v1/rnpm/searches/9999", { method: "DELETE" });
    expect(res.status).toBe(200);
    const body = await jsonOf<{ deleted: boolean }>(res);
    expect(body.deleted).toBe(false);
  });

  it("returns 400 + { error } on non-numeric id", async () => {
    const res = await buildApp().request("/api/v1/rnpm/searches/notanumber", { method: "DELETE" });
    expect(res.status).toBe(400);
    const body = await jsonOf<{ error: string }>(res);
    expect(typeof body.error).toBe("string");
  });
});

describe("POST /api/v1/rnpm/compact", () => {
  it("returns { ok: true, ...vacuumStats }", async () => {
    seedAviz({ identificator: "AV-COMPACT" });
    const res = await buildApp().request("/api/v1/rnpm/compact", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await jsonOf<{ ok: boolean }>(res);
    expect(body.ok).toBe(true);
  });
});

describe("POST /api/v1/rnpm/search input validation", () => {
  // Happy-path POST /search calls executeSearch which talks to RNPM upstream
  // and a captcha provider. Tests here cover only the input-validation branches
  // where the response shape is { error: string } and no network is touched.

  it("returns 400 + { error } on malformed JSON", async () => {
    const res = await buildApp().request("/api/v1/rnpm/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
    const body = await jsonOf<{ error: string }>(res);
    expect(typeof body.error).toBe("string");
  });

  it("returns 400 + { error } on invalid type", async () => {
    const res = await buildApp().request("/api/v1/rnpm/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "invalid_type", params: {}, captchaKey: "x".repeat(20) }),
    });
    expect(res.status).toBe(400);
    const body = await jsonOf<{ error: string }>(res);
    expect(typeof body.error).toBe("string");
  });

  it("returns 400 + { error } on missing captcha key", async () => {
    const res = await buildApp().request("/api/v1/rnpm/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "ipoteci", params: { foo: "bar" }, captchaKey: "" }),
    });
    expect(res.status).toBe(400);
    const body = await jsonOf<{ error: string }>(res);
    expect(typeof body.error).toBe("string");
  });
});

describe("POST /api/v1/rnpm/bulk input validation", () => {
  it("returns 400 + { error } on empty items list", async () => {
    const res = await buildApp().request("/api/v1/rnpm/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: [], captchaKey: "x".repeat(20) }),
    });
    expect(res.status).toBe(400);
    const body = await jsonOf<{ error: string }>(res);
    expect(typeof body.error).toBe("string");
  });

  it("returns 400 + { error } on items > 200", async () => {
    const items = Array.from({ length: 201 }, () => ({ type: "ipoteci", params: {} }));
    const res = await buildApp().request("/api/v1/rnpm/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items, captchaKey: "x".repeat(20) }),
    });
    expect(res.status).toBe(400);
    const body = await jsonOf<{ error: string }>(res);
    expect(typeof body.error).toBe("string");
  });

  it("returns 400 + { error } on invalid type within items", async () => {
    const res = await buildApp().request("/api/v1/rnpm/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        items: [{ type: "wrong_type", params: {} }],
        captchaKey: "x".repeat(20),
      }),
    });
    expect(res.status).toBe(400);
    const body = await jsonOf<{ error: string }>(res);
    expect(typeof body.error).toBe("string");
  });
});

describe("POST /api/v1/rnpm/captcha/balance input validation", () => {
  // Only validation branches — happy path requires a real captcha provider.
  it("returns 400 + { error } when key field is missing", async () => {
    const res = await buildApp().request("/api/v1/rnpm/captcha/balance", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await jsonOf<{ error: string }>(res);
    expect(typeof body.error).toBe("string");
  });

  it("returns 400 + { error } on malformed JSON", async () => {
    const res = await buildApp().request("/api/v1/rnpm/captcha/balance", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not-json",
    });
    expect(res.status).toBe(400);
    const body = await jsonOf<{ error: string }>(res);
    expect(typeof body.error).toBe("string");
  });
});

describe("POST /api/v1/rnpm/backups/restore input validation", () => {
  it("returns 400 + { error } when name field is missing", async () => {
    const res = await buildApp().request("/api/v1/rnpm/backups/restore", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await jsonOf<{ error: string }>(res);
    expect(typeof body.error).toBe("string");
  });

  it("returns 400 + { error } on malformed JSON", async () => {
    const res = await buildApp().request("/api/v1/rnpm/backups/restore", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    expect(res.status).toBe(400);
    const body = await jsonOf<{ error: string }>(res);
    expect(typeof body.error).toBe("string");
  });
});

// v2.11.0 web-readiness closure (#12): rutele care primesc captchaKey in body
// (search, bulk, captcha/balance) sunt gated cu 501 in `web` mode pana cand
// exista per-user server-side captcha key storage. Desktop ramane neschimbat.
describe("AUTH_MODE=web gate on captchaKey body endpoints (closure #12)", () => {
  // Salvam si restauram env-ul ca testele care urmeaza in alte fisiere sa nu
  // fie poluate. `getAuthMode()` citeste process.env la fiecare apel, asa ca
  // mutarea variabilei e suficienta.
  let savedAuthMode: string | undefined;
  beforeEach(() => {
    savedAuthMode = process.env.LEGAL_DASHBOARD_AUTH_MODE;
    process.env.LEGAL_DASHBOARD_AUTH_MODE = "web";
  });
  afterEach(() => {
    if (savedAuthMode === undefined) Reflect.deleteProperty(process.env, "LEGAL_DASHBOARD_AUTH_MODE");
    else process.env.LEGAL_DASHBOARD_AUTH_MODE = savedAuthMode;
  });

  it("POST /search returns 501 in web mode without consuming the body", async () => {
    const res = await buildApp().request("/api/v1/rnpm/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "ipoteci", params: {}, captchaKey: "x".repeat(20) }),
    });
    expect(res.status).toBe(501);
    const body = await jsonOf<{ error: string }>(res);
    expect(typeof body.error).toBe("string");
    expect(body.error).toMatch(/web mode|server-side|captcha/i);
  });

  it("POST /bulk returns 501 in web mode", async () => {
    const res = await buildApp().request("/api/v1/rnpm/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        items: [{ type: "ipoteci", params: {} }],
        captchaKey: "x".repeat(20),
      }),
    });
    expect(res.status).toBe(501);
  });

  it("POST /captcha/balance returns 501 in web mode", async () => {
    const res = await buildApp().request("/api/v1/rnpm/captcha/balance", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ captchaKey: "x".repeat(20) }),
    });
    expect(res.status).toBe(501);
  });
});

// Closure #2 verification: defense-in-depth — un user non-admin nu poate
// accesa rutele globale chiar daca getOwnerId returneaza id-ul lui.
describe("requireRole(admin) gate on global rnpm routes (closure #2)", () => {
  beforeEach(() => {
    // Demoteaza user-ul local promovat in beforeEach principal: requireRole
    // trebuie sa returneze 403 pentru un user fara rol admin.
    updateUserRole("local", "user");
  });

  it("DELETE /saved/all returns 403 for non-admin", async () => {
    const res = await buildApp().request("/api/v1/rnpm/saved/all", { method: "DELETE" });
    expect(res.status).toBe(403);
  });

  it("POST /compact returns 403 for non-admin", async () => {
    const res = await buildApp().request("/api/v1/rnpm/compact", { method: "POST" });
    expect(res.status).toBe(403);
  });

  it("GET /backups returns 403 for non-admin", async () => {
    const res = await buildApp().request("/api/v1/rnpm/backups");
    expect(res.status).toBe(403);
  });

  it("DELETE /backups returns 403 for non-admin", async () => {
    const res = await buildApp().request("/api/v1/rnpm/backups", { method: "DELETE" });
    expect(res.status).toBe(403);
  });
});
