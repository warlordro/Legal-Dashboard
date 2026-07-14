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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { rnpmRouter } from "./rnpm.ts";
import { maybeAutoCompactRnpm } from "../db/backup.ts";
import { listAuditEvents } from "../db/auditRepository.ts";
import { measureRnpmStorage } from "../db/rnpmStorageLimit.ts";
import { closeDb, getDb } from "../db/schema.ts";
import { __resetRnpmDbForTests, closeRnpmDb, getRnpmDb, getRnpmDbPath } from "../db/rnpmDb.ts";
import { saveAvizFull } from "../db/avizRepository.ts";
import { saveSearch } from "../db/searchRepository.ts";
import { updateUserRole, updateUserStatus } from "../db/userRepository.ts";
import { requestIdContext } from "../middleware/requestId.ts";

vi.mock("../services/captchaSolver.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/captchaSolver.ts")>();
  return {
    ...actual,
    getCaptchaBalance: vi.fn(),
  };
});

vi.mock("../db/backup.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/backup.ts")>();
  return {
    ...actual,
    maybeAutoCompactRnpm: vi.fn(actual.maybeAutoCompactRnpm),
  };
});

let tmpRoot: string;

function buildApp() {
  // v2.11.0 web-readiness closure: rutele globale (/saved/all, /compact,
  // /backups, /backups/restore, /open-*-folder) sunt gated de
  // requireRole("admin"). Pe desktop, getOwnerId(c) returneaza fallback
  // "local"; testele seed-uiesc un user `local` cu role=admin in beforeEach
  // ca guard-ul sa lase requestul prin. Restul rutelor (/saved, /searches,
  // /stats) raman fara guard si folosesc ownerId-ul fallback fara probleme.
  const app = new Hono();
  app.use("*", requestIdContext);
  app.route("/api/v1/rnpm", rnpmRouter);
  return app;
}

async function jsonOf<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

// F11-F1 Stage 2: requireDesktopHeader gateaza POST/DELETE-urile admin body-
// less. Renderer-ul propriu seteaza header-ul prin apiFetch (Stage 3); aici
// trimitem explicit pentru a simula sursa "desktop".
const DESKTOP_HEADERS = { "x-legal-dashboard-desktop": "1" } as const;

type EnvelopeErrorBody = {
  data: null;
  error: { code: string; message: string };
  requestId: string;
};

function expectEnvelopeError(body: EnvelopeErrorBody, code: string) {
  expect(body).toMatchObject({
    data: null,
    error: { code, message: expect.any(String) },
    requestId: expect.any(String),
  });
  expect(body.requestId.length).toBeGreaterThan(0);
}

function seedAviz(opts: {
  identificator: string;
  searchType?: string;
  tip?: string;
  data?: string;
  activ?: boolean | null;
}): number {
  return saveAvizFull({
    ownerId: "local",
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
  __resetRnpmDbForTests();
  vi.clearAllMocks();
  closeDb();
  Reflect.deleteProperty(process.env, "LEGAL_DASHBOARD_DB_PATH");
  Reflect.deleteProperty(process.env, "LEGAL_DASHBOARD_RNPM_AUTOCOMPACT_MIN_FREE_MB");
  Reflect.deleteProperty(process.env, "LEGAL_DASHBOARD_RNPM_AUTOCOMPACT_DISABLED");
  Reflect.deleteProperty(process.env, "LEGAL_DASHBOARD_DEFAULT_RNPM_STORAGE_MB");
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

  // v2.34.0 P1-3: pageSize/limit clamped server-side to MAX_PAGE_SIZE=200
  // (DoS-by-quota / memory blowup prevention pe API public web).
  it("clamps pageSize to MAX_PAGE_SIZE=200 when client requests larger value", async () => {
    const res = await buildApp().request("/api/v1/rnpm/saved?pageSize=99999");
    expect(res.status).toBe(200);
    const body = await jsonOf<{ items: unknown[]; total: number; page: number; pageSize: number }>(res);
    expect(body.pageSize).toBe(200);
  });

  it("clamps non-positive pageSize back to the default", async () => {
    const res = await buildApp().request("/api/v1/rnpm/saved?pageSize=0");
    expect(res.status).toBe(200);
    const body = await jsonOf<{ pageSize: number }>(res);
    expect(body.pageSize).toBe(25);
  });
});

describe("GET /api/v1/rnpm/saved/:id", () => {
  it("returns 404 + { error } when missing", async () => {
    const res = await buildApp().request("/api/v1/rnpm/saved/9999");
    expect(res.status).toBe(404);
    const body = await jsonOf<EnvelopeErrorBody>(res);
    expectEnvelopeError(body, "NOT_FOUND");
  });

  it("returns 400 + { error } when id is non-numeric", async () => {
    const res = await buildApp().request("/api/v1/rnpm/saved/notanumber");
    expect(res.status).toBe(400);
    const body = await jsonOf<EnvelopeErrorBody>(res);
    expectEnvelopeError(body, "INVALID_PARAMS");
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
    const res = await buildApp().request(`/api/v1/rnpm/saved/${id}`, {
      method: "DELETE",
      headers: DESKTOP_HEADERS,
    });
    expect(res.status).toBe(200);
    const body = await jsonOf<{ deleted: boolean }>(res);
    expect(body.deleted).toBe(true);
  });

  it("returns { deleted: false } when row missing", async () => {
    const res = await buildApp().request("/api/v1/rnpm/saved/9999", {
      method: "DELETE",
      headers: DESKTOP_HEADERS,
    });
    expect(res.status).toBe(200);
    const body = await jsonOf<{ deleted: boolean }>(res);
    expect(body.deleted).toBe(false);
  });

  it("returns 400 + { error } on non-numeric id", async () => {
    const res = await buildApp().request("/api/v1/rnpm/saved/notanumber", {
      method: "DELETE",
      headers: DESKTOP_HEADERS,
    });
    expect(res.status).toBe(400);
    const body = await jsonOf<EnvelopeErrorBody>(res);
    expectEnvelopeError(body, "INVALID_PARAMS");
  });

  it("returns 403 without the desktop header", async () => {
    const id = seedAviz({ identificator: "AV-DEL-NO-HEADER" });
    const res = await buildApp().request(`/api/v1/rnpm/saved/${id}`, { method: "DELETE" });
    expect(res.status).toBe(403);
  });

  it("pastreaza succesul delete-ului cand scrierea de audit esueaza", async () => {
    const id = seedAviz({ identificator: "AV-DEL-AUDIT-FAIL" });
    getDb().exec("DROP TABLE audit_log");
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const existing = await buildApp().request(`/api/v1/rnpm/saved/${id}`, {
      method: "DELETE",
      headers: DESKTOP_HEADERS,
    });
    const missing = await buildApp().request("/api/v1/rnpm/saved/999999", {
      method: "DELETE",
      headers: DESKTOP_HEADERS,
    });

    expect(existing.status).toBe(200);
    expect(await jsonOf(existing)).toMatchObject({ deleted: true });
    expect(missing.status).toBe(200);
    expect(await jsonOf(missing)).toMatchObject({ deleted: false });
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("[audit] write failed for aviz.delete"),
      expect.any(String)
    );
  });
});

describe("DELETE /api/v1/rnpm/saved/all", () => {
  it("returns { deleted: <count> }", async () => {
    seedAviz({ identificator: "AV-A" });
    seedAviz({ identificator: "AV-B" });
    const res = await buildApp().request("/api/v1/rnpm/saved/all", {
      method: "DELETE",
      headers: DESKTOP_HEADERS,
    });
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
      headers: { "content-type": "application/json", "x-legal-dashboard-desktop": "1" },
      body: JSON.stringify({ ids: [id1, id2] }),
    });
    expect(res.status).toBe(200);
    const body = await jsonOf<{ deleted: number }>(res);
    expect(body.deleted).toBe(2);
  });

  it("returns 400 + { error } on empty list", async () => {
    const res = await buildApp().request("/api/v1/rnpm/saved/delete-batch", {
      method: "POST",
      headers: { "content-type": "application/json", "x-legal-dashboard-desktop": "1" },
      body: JSON.stringify({ ids: [] }),
    });
    expect(res.status).toBe(400);
    const body = await jsonOf<EnvelopeErrorBody>(res);
    expectEnvelopeError(body, "INVALID_PARAMS");
  });

  it("returns 400 + { error } when JSON body is malformed", async () => {
    const res = await buildApp().request("/api/v1/rnpm/saved/delete-batch", {
      method: "POST",
      headers: { "content-type": "application/json", "x-legal-dashboard-desktop": "1" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
    const body = await jsonOf<EnvelopeErrorBody>(res);
    expectEnvelopeError(body, "INVALID_JSON");
  });

  it("nu adauga campul compacted cand pragul nu cere compactare", async () => {
    const id = seedAviz({ identificator: "AV-BATCH-SMALL" });

    const res = await buildApp().request("/api/v1/rnpm/saved/delete-batch", {
      method: "POST",
      headers: { "content-type": "application/json", "x-legal-dashboard-desktop": "1" },
      body: JSON.stringify({ ids: [id] }),
    });
    const body = await jsonOf<Record<string, unknown>>(res);

    expect(res.status).toBe(200);
    expect(body.deleted).toBe(1);
    expect(body).not.toHaveProperty("compacted");
    expect(body).not.toHaveProperty("freedBytes");
  });

  it("compacteaza ruta reala peste prag si micsoreaza fisierul", async () => {
    process.env.LEGAL_DASHBOARD_RNPM_AUTOCOMPACT_MIN_FREE_MB = "0.1";
    const ids: number[] = [];
    for (let index = 0; index < 80; index++) {
      ids.push(
        saveAvizFull({
          ownerId: "local",
          uuid: `uuid-large-${index}`,
          identificator: `AV-LARGE-${index}`,
          searchType: "ipoteci",
          tip: "Aviz initial",
          data: "12.07.2026",
          bunuri: [
            {
              tip_bun: "altele",
              categorie: null,
              identificare: null,
              descriere: `${index}-${"x".repeat(8 * 1024)}`,
              model: null,
              serie_sasiu: null,
              serie_motor: null,
              nr_inmatriculare: null,
              referinte: [],
            },
          ],
        })
      );
    }
    closeRnpmDb("local");
    const beforeBytes = (await fsPromises.stat(getRnpmDbPath("local"))).size;

    const res = await buildApp().request("/api/v1/rnpm/saved/delete-batch", {
      method: "POST",
      headers: { "content-type": "application/json", "x-legal-dashboard-desktop": "1" },
      body: JSON.stringify({ ids }),
    });
    const body = await jsonOf<{ deleted: number; compacted?: boolean; freedBytes?: number }>(res);

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ deleted: ids.length, compacted: true });
    expect(body.freedBytes).toBeGreaterThan(0);
    expect((await fsPromises.stat(getRnpmDbPath("local"))).size).toBeLessThan(beforeBytes);
  });

  it("pastreaza 200 si raporteaza compacted false la refuzul compactarii", async () => {
    vi.mocked(maybeAutoCompactRnpm).mockResolvedValueOnce({
      attempted: true,
      compacted: false,
      freedBytes: 0,
      reason: "search_active",
      durationMs: 1,
    });
    const id = seedAviz({ identificator: "AV-BATCH-REFUSED" });

    const res = await buildApp().request("/api/v1/rnpm/saved/delete-batch", {
      method: "POST",
      headers: { "content-type": "application/json", "x-legal-dashboard-desktop": "1" },
      body: JSON.stringify({ ids: [id] }),
    });

    expect(res.status).toBe(200);
    await expect(jsonOf(res)).resolves.toMatchObject({ deleted: 1, compacted: false, freedBytes: 0 });
  });

  it("kill switch-ul pastreaza contractul vechi fara compacted", async () => {
    process.env.LEGAL_DASHBOARD_RNPM_AUTOCOMPACT_DISABLED = "1";
    const id = seedAviz({ identificator: "AV-BATCH-DISABLED" });

    const res = await buildApp().request("/api/v1/rnpm/saved/delete-batch", {
      method: "POST",
      headers: { "content-type": "application/json", "x-legal-dashboard-desktop": "1" },
      body: JSON.stringify({ ids: [id] }),
    });
    const body = await jsonOf<Record<string, unknown>>(res);

    expect(body).not.toHaveProperty("compacted");
  });

  it("delete-batch ramane permis cand baza este peste limita de stocare", async () => {
    process.env.LEGAL_DASHBOARD_DEFAULT_RNPM_STORAGE_MB = "0.000001";
    const id = seedAviz({ identificator: "AV-BATCH-OVER-STORAGE" });

    const res = await buildApp().request("/api/v1/rnpm/saved/delete-batch", {
      method: "POST",
      headers: { "content-type": "application/json", "x-legal-dashboard-desktop": "1" },
      body: JSON.stringify({ ids: [id] }),
    });

    expect(res.status).toBe(200);
    await expect(jsonOf(res)).resolves.toMatchObject({ deleted: 1 });
  });

  it("auditul delete ramane primul si autocompact are eveniment distinct", async () => {
    vi.mocked(maybeAutoCompactRnpm).mockResolvedValueOnce({
      attempted: true,
      compacted: true,
      freedBytes: 4096,
      durationMs: 7,
    });
    const id = seedAviz({ identificator: "AV-BATCH-AUDIT" });

    await buildApp().request("/api/v1/rnpm/saved/delete-batch", {
      method: "POST",
      headers: { "content-type": "application/json", "x-legal-dashboard-desktop": "1" },
      body: JSON.stringify({ ids: [id] }),
    });
    const rows = listAuditEvents({ ownerId: "local", limit: 20 })
      .rows.filter((row) => row.action === "aviz.delete_batch" || row.action === "rnpm.autocompact")
      .reverse();

    expect(rows.map((row) => row.action)).toEqual(["aviz.delete_batch", "rnpm.autocompact"]);
    expect(JSON.parse(rows[0].detail_json)).toMatchObject({ requested: 1, deleted: 1 });
    expect(JSON.parse(rows[1].detail_json)).toEqual({
      attempted: true,
      compacted: true,
      freedBytes: 4096,
      durationMs: 7,
    });
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
    const body = await jsonOf<EnvelopeErrorBody>(res);
    expectEnvelopeError(body, "INVALID_PARAMS");
  });
});

describe("GET /api/v1/rnpm/stats", () => {
  it("returns { total, activ, inactiv, byType, db: { sizeBytes } } fara path absolut", async () => {
    seedAviz({ identificator: "AV-STAT-1" });
    seedAviz({ identificator: "AV-STAT-2", searchType: "fiducii", activ: false });

    const res = await buildApp().request("/api/v1/rnpm/stats");
    expect(res.status).toBe(200);
    const body = await jsonOf<{
      total: number;
      activ: number;
      inactiv: number;
      byType: Record<string, number>;
      db: { sizeBytes: number; path?: string };
    }>(res);
    expect(body.total).toBe(2);
    expect(body.activ).toBe(1);
    expect(body.inactiv).toBe(1);
    expect(body.byType.ipoteci).toBe(1);
    expect(body.byType.fiducii).toBe(1);
    expect(body.db.sizeBytes).toBe((await measureRnpmStorage("local")).usedBytes);
    expect("path" in body.db).toBe(false);
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
    saveSearch({ ownerId: "local", searchType: "ipoteci", paramsJson: "{}", totalResults: 5, criteriu: "test" });
    saveSearch({ ownerId: "local", searchType: "fiducii", paramsJson: "{}", totalResults: 1 });

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

  // v2.34.0 P1-3: limit-ul de /searches e clamped la MAX_PAGE_SIZE=200.
  // Cu un singur rand seed-uit, ne intereseaza ca cererea cu limit=99999
  // intoarce 200 (nu 500/crash) si raspunsul e populat.
  it("accepts and clamps oversized limit values without crashing", async () => {
    saveSearch({ ownerId: "local", searchType: "ipoteci", paramsJson: "{}", totalResults: 0 });
    const res = await buildApp().request("/api/v1/rnpm/searches?limit=99999");
    expect(res.status).toBe(200);
    const body = await jsonOf<{ items: unknown[]; nextCursor: number | null }>(res);
    expect(Array.isArray(body.items)).toBe(true);
  });
});

describe("DELETE /api/v1/rnpm/searches/:id", () => {
  it("returns { deleted: true } on existing row", async () => {
    const id = saveSearch({ ownerId: "local", searchType: "ipoteci", paramsJson: "{}", totalResults: 0 });
    const res = await buildApp().request(`/api/v1/rnpm/searches/${id}`, {
      method: "DELETE",
      headers: DESKTOP_HEADERS,
    });
    expect(res.status).toBe(200);
    const body = await jsonOf<{ deleted: boolean }>(res);
    expect(body.deleted).toBe(true);
  });

  it("returns { deleted: false } when row missing", async () => {
    const res = await buildApp().request("/api/v1/rnpm/searches/9999", {
      method: "DELETE",
      headers: DESKTOP_HEADERS,
    });
    expect(res.status).toBe(200);
    const body = await jsonOf<{ deleted: boolean }>(res);
    expect(body.deleted).toBe(false);
  });

  it("returns 400 + { error } on non-numeric id", async () => {
    const res = await buildApp().request("/api/v1/rnpm/searches/notanumber", {
      method: "DELETE",
      headers: DESKTOP_HEADERS,
    });
    expect(res.status).toBe(400);
    const body = await jsonOf<EnvelopeErrorBody>(res);
    expectEnvelopeError(body, "INVALID_PARAMS");
  });

  it("apeleaza autocompact si raporteaza rezultatul pe stergerea individuala", async () => {
    vi.mocked(maybeAutoCompactRnpm).mockResolvedValueOnce({ attempted: true, compacted: true, freedBytes: 2048 });
    const id = saveSearch({ ownerId: "local", searchType: "ipoteci", paramsJson: "{}", totalResults: 0 });

    const res = await buildApp().request(`/api/v1/rnpm/searches/${id}`, {
      method: "DELETE",
      headers: DESKTOP_HEADERS,
    });

    expect(await jsonOf(res)).toEqual({ deleted: true, compacted: true, freedBytes: 2048 });
  });

  it("returns 403 without the desktop header", async () => {
    const id = saveSearch({ ownerId: "local", searchType: "ipoteci", paramsJson: "{}", totalResults: 0 });
    const res = await buildApp().request(`/api/v1/rnpm/searches/${id}`, { method: "DELETE" });
    expect(res.status).toBe(403);
  });

  it("pastreaza succesul delete-ului cand scrierea de audit esueaza", async () => {
    const id = saveSearch({ ownerId: "local", searchType: "ipoteci", paramsJson: "{}", totalResults: 0 });
    getDb().exec("DROP TABLE audit_log");
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const existing = await buildApp().request(`/api/v1/rnpm/searches/${id}`, {
      method: "DELETE",
      headers: DESKTOP_HEADERS,
    });
    const missing = await buildApp().request("/api/v1/rnpm/searches/999999", {
      method: "DELETE",
      headers: DESKTOP_HEADERS,
    });

    expect(existing.status).toBe(200);
    expect(await jsonOf(existing)).toMatchObject({ deleted: true });
    expect(missing.status).toBe(200);
    expect(await jsonOf(missing)).toMatchObject({ deleted: false });
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("[audit] write failed for search.delete"),
      expect.any(String)
    );
  });
});

describe("DELETE /api/v1/rnpm/saved/:id autocompact", () => {
  it("apeleaza autocompact si tolereaza o eroare netipata dupa delete", async () => {
    vi.mocked(maybeAutoCompactRnpm).mockRejectedValueOnce(new Error("boom"));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const id = seedAviz({ identificator: "AV-ONE-AUTO" });

    const res = await buildApp().request(`/api/v1/rnpm/saved/${id}`, {
      method: "DELETE",
      headers: DESKTOP_HEADERS,
    });

    expect(res.status).toBe(200);
    expect(await jsonOf(res)).toEqual({ deleted: true, compacted: false, freedBytes: 0 });
    expect(error).toHaveBeenCalled();
  });
});

describe("POST /api/v1/rnpm/compact", () => {
  it("returns { ok: true, ...vacuumStats }", async () => {
    seedAviz({ identificator: "AV-COMPACT" });
    const res = await buildApp().request("/api/v1/rnpm/compact", {
      method: "POST",
      headers: DESKTOP_HEADERS,
    });
    expect(res.status).toBe(200);
    const body = await jsonOf<{ ok: boolean }>(res);
    expect(body.ok).toBe(true);
  });
});

describe("POST /api/v1/rnpm/search input validation", () => {
  // Happy-path POST /search calls executeSearch which talks to RNPM upstream
  // and a captcha provider. Tests here cover only the input-validation branches
  // where the response shape is { error: string } and no network is touched.

  it("returns 413 PAYLOAD_TOO_LARGE envelope when body exceeds search limit", async () => {
    const res = await buildApp().request("/api/v1/rnpm/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payload: "x".repeat(70_000) }),
    });
    expect(res.status).toBe(413);
    const body = await jsonOf<EnvelopeErrorBody>(res);
    expectEnvelopeError(body, "PAYLOAD_TOO_LARGE");
  });

  it("returns 400 + { error } on malformed JSON", async () => {
    const res = await buildApp().request("/api/v1/rnpm/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
    const body = await jsonOf<EnvelopeErrorBody>(res);
    expectEnvelopeError(body, "INVALID_JSON");
  });

  it("returns 400 + { error } on invalid type", async () => {
    const res = await buildApp().request("/api/v1/rnpm/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "invalid_type", params: {}, captchaKey: "x".repeat(20) }),
    });
    expect(res.status).toBe(400);
    const body = await jsonOf<EnvelopeErrorBody>(res);
    expectEnvelopeError(body, "INVALID_PARAMS");
  });

  it("returns 400 + { error } on missing captcha key", async () => {
    const res = await buildApp().request("/api/v1/rnpm/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "ipoteci", params: { foo: "bar" }, captchaKey: "" }),
    });
    expect(res.status).toBe(400);
    const body = await jsonOf<EnvelopeErrorBody>(res);
    expectEnvelopeError(body, "INVALID_CAPTCHA_KEY");
  });
});

describe("POST /api/v1/rnpm/bulk input validation", () => {
  it("returns 413 PAYLOAD_TOO_LARGE envelope when body exceeds bulk limit", async () => {
    const res = await buildApp().request("/api/v1/rnpm/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payload: "x".repeat(530_000) }),
    });
    expect(res.status).toBe(413);
    const body = await jsonOf<EnvelopeErrorBody>(res);
    expectEnvelopeError(body, "PAYLOAD_TOO_LARGE");
  });

  it("returns 400 + { error } on empty items list", async () => {
    const res = await buildApp().request("/api/v1/rnpm/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: [], captchaKey: "x".repeat(20) }),
    });
    expect(res.status).toBe(400);
    const body = await jsonOf<EnvelopeErrorBody>(res);
    expectEnvelopeError(body, "INVALID_PARAMS");
  });

  it("returns 400 + { error } on items > 200", async () => {
    const items = Array.from({ length: 201 }, () => ({ type: "ipoteci", params: {} }));
    const res = await buildApp().request("/api/v1/rnpm/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items, captchaKey: "x".repeat(20) }),
    });
    expect(res.status).toBe(400);
    const body = await jsonOf<EnvelopeErrorBody>(res);
    expectEnvelopeError(body, "INVALID_PARAMS");
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
    const body = await jsonOf<EnvelopeErrorBody>(res);
    expectEnvelopeError(body, "INVALID_PARAMS");
  });
});

describe("POST /api/v1/rnpm/captcha/balance input validation", () => {
  // Only validation branches — happy path requires a real captcha provider.
  it("returns 400 INVALID_CAPTCHA_KEY envelope when key field is missing", async () => {
    const res = await buildApp().request("/api/v1/rnpm/captcha/balance", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await jsonOf<EnvelopeErrorBody>(res);
    expectEnvelopeError(body, "INVALID_CAPTCHA_KEY");
  });

  it("returns 400 INVALID_JSON envelope on malformed JSON", async () => {
    const res = await buildApp().request("/api/v1/rnpm/captcha/balance", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not-json",
    });
    expect(res.status).toBe(400);
    const body = await jsonOf<EnvelopeErrorBody>(res);
    expectEnvelopeError(body, "INVALID_JSON");
  });

  it("returns 402 INSUFFICIENT_FUNDS cand provider raporteaza fonduri insuficiente", async () => {
    const { CaptchaInsufficientFundsError, getCaptchaBalance } = await import("../services/captchaSolver.ts");
    vi.mocked(getCaptchaBalance).mockRejectedValueOnce(
      new CaptchaInsufficientFundsError("Sold insuficient (2Captcha)")
    );

    const res = await buildApp().request("/api/v1/rnpm/captcha/balance", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ captchaKey: "0".repeat(32), captchaProvider: "2captcha" }),
    });

    expect(res.status).toBe(402);
    expect(res.headers.get("Retry-After")).toBe("0");
    const body = await jsonOf<EnvelopeErrorBody>(res);
    expectEnvelopeError(body, "INSUFFICIENT_FUNDS");
    expect(body.error.message).toContain("Sold insuficient");
  });

  it("returns 400 CAPTCHA_BALANCE_UNAVAILABLE pentru alte erori provider", async () => {
    const { getCaptchaBalance } = await import("../services/captchaSolver.ts");
    vi.mocked(getCaptchaBalance).mockRejectedValueOnce(new Error("Could not parse balance response"));

    const res = await buildApp().request("/api/v1/rnpm/captcha/balance", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ captchaKey: "0".repeat(32), captchaProvider: "2captcha" }),
    });

    expect(res.status).toBe(400);
    const body = await jsonOf<EnvelopeErrorBody>(res);
    expectEnvelopeError(body, "CAPTCHA_BALANCE_UNAVAILABLE");
    expect(body.error.message).toBe("Could not parse balance response");
  });
});

describe("POST /api/v1/rnpm/backups/restore input validation", () => {
  it("returns 400 + { error } when name field is missing", async () => {
    const res = await buildApp().request("/api/v1/rnpm/backups/restore", {
      method: "POST",
      headers: { "content-type": "application/json", "x-legal-dashboard-desktop": "1" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await jsonOf<EnvelopeErrorBody>(res);
    expectEnvelopeError(body, "INVALID_PARAMS");
  });

  it("returns 400 + { error } on malformed JSON", async () => {
    const res = await buildApp().request("/api/v1/rnpm/backups/restore", {
      method: "POST",
      headers: { "content-type": "application/json", "x-legal-dashboard-desktop": "1" },
      body: "{",
    });
    expect(res.status).toBe(400);
    const body = await jsonOf<EnvelopeErrorBody>(res);
    expectEnvelopeError(body, "INVALID_JSON");
  });
});

// v2.30.0: rutele captcha in web mode nu mai folosesc cheia din body; daca
// adminul nu a configurat cheia tenantului, primesc 501 explicit.
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
    const body = await jsonOf<EnvelopeErrorBody>(res);
    expectEnvelopeError(body, "CAPTCHA_NOT_CONFIGURED");
    expect(body.error.message).toMatch(/captcha|adminul/i);
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
    const body = await jsonOf<EnvelopeErrorBody>(res);
    expectEnvelopeError(body, "CAPTCHA_NOT_CONFIGURED");
  });

  it("POST /captcha/balance returns 501 in web mode", async () => {
    const res = await buildApp().request("/api/v1/rnpm/captcha/balance", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ captchaKey: "x".repeat(20) }),
    });
    expect(res.status).toBe(501);
    const body = await jsonOf<EnvelopeErrorBody>(res);
    expectEnvelopeError(body, "CAPTCHA_NOT_CONFIGURED");
  });
});

// v2.43.0 (rnpm-split): rutele NU mai sunt globale — opereaza pe fisierul /
// jail-ul per user al callerului, deci self-service = requireRole("admin",
// "user"). Gate-ul care ramane: userii inactivi/necunoscuti sunt refuzati.
describe("self-service gate on per-user rnpm routes (v2.43.0)", () => {
  beforeEach(() => {
    updateUserRole("local", "user");
  });

  it("rolul user ARE acces la rutele self-service (fisierul propriu)", async () => {
    // EXT-M-01: delete-all NU mai provisioneaza implicit fisierul unui owner
    // fara date (vechiul comportament era side-effect al getRnpmDb); compact
    // pe fisier inexistent = 404 by design. Seed explicit ca fluxul sa aiba
    // fisier real.
    seedAviz({ identificator: "AV-SELF" });
    const app = buildApp();
    const delAll = await app.request("/api/v1/rnpm/saved/all", { method: "DELETE", headers: DESKTOP_HEADERS });
    expect(delAll.status).toBe(200);
    const compact = await app.request("/api/v1/rnpm/compact", { method: "POST", headers: DESKTOP_HEADERS });
    expect(compact.status).toBe(200);
    const list = await app.request("/api/v1/rnpm/backups");
    expect(list.status).toBe(200);
    const del = await app.request("/api/v1/rnpm/backups", { method: "DELETE", headers: DESKTOP_HEADERS });
    expect(del.status).toBe(200);
  });

  it("user suspendat => 403 pe rutele self-service", async () => {
    updateUserStatus("local", "suspended");
    const app = buildApp();
    const res = await app.request("/api/v1/rnpm/backups");
    expect(res.status).toBe(403);
    const del = await app.request("/api/v1/rnpm/saved/all", { method: "DELETE", headers: DESKTOP_HEADERS });
    expect(del.status).toBe(403);
  });
});
