import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import Database from "better-sqlite3";
import path from "node:path";
import os from "node:os";
import fsPromises from "node:fs/promises";
import { closeDb, getDb } from "../db/schema.ts";
import { rnpmRouter } from "./rnpm.ts";

let tmpRoot: string;
let dbPath: string;
let app: Hono;
let db: Database.Database;

interface FilterRouteBody {
  matchedAvizIds: number[];
  matchedCount: number;
  totalInSearch: number;
  missingDetails: number;
  truncated: boolean;
  code?: string;
  error?: string;
}

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-route-"));
  dbPath = path.join(tmpRoot, "legal-dashboard.db");
  process.env.LEGAL_DASHBOARD_DB_PATH = dbPath;
  const seed = new Database(dbPath);
  seed.close();
  db = getDb();
  app = new Hono();
  app.route("/api/rnpm", rnpmRouter);
});

afterEach(async () => {
  Reflect.deleteProperty(process.env, "RNPM_RESULTS_FILTER_DISABLED");
  closeDb();
  Reflect.deleteProperty(process.env, "LEGAL_DASHBOARD_DB_PATH");
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

function seedSearchWithAviz(): { searchId: number; avizId: number } {
  const s = db
    .prepare(
      `INSERT INTO rnpm_searches (owner_id, search_type, params_json, total_results, criteriu)
       VALUES ('local', 'ipoteci', '{}', 0, '')`
    )
    .run();
  const searchId = Number(s.lastInsertRowid);
  const a = db
    .prepare(
      `INSERT INTO rnpm_avize (owner_id, search_id, search_type, identificator, tip, detail_fetched, data, uuid)
       VALUES ('local', ?, 'ipoteci', 'AV-001', 'Aviz', 1, '01.01.2024', lower(hex(randomblob(8))))`
    )
    .run(searchId);
  const avizId = Number(a.lastInsertRowid);
  db.prepare(
    "INSERT INTO rnpm_debitori (aviz_id, owner_id, tip_persoana, denumire, cod, cnp) VALUES (?, 'local', 'PJ', 'Popescu', '', '')"
  ).run(avizId);
  return { searchId, avizId };
}

describe("POST /api/rnpm/search/:searchId/filter", () => {
  it("happy path - 200 cu matchedAvizIds si counters", async () => {
    const { searchId, avizId } = seedSearchWithAviz();
    const res = await app.request(`/api/rnpm/search/${searchId}/filter`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q: "popescu" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as FilterRouteBody;
    expect(body.matchedAvizIds).toEqual([avizId]);
    expect(body.matchedCount).toBe(1);
    expect(body.totalInSearch).toBe(1);
    expect(body.missingDetails).toBe(0);
    expect(body.truncated).toBe(false);
  });

  it("body invalid JSON -> 400", async () => {
    const { searchId } = seedSearchWithAviz();
    const res = await app.request(`/api/rnpm/search/${searchId}/filter`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as FilterRouteBody).error).toMatch(/JSON invalid/);
  });

  it("q lipsa -> 400", async () => {
    const { searchId } = seedSearchWithAviz();
    const res = await app.request(`/api/rnpm/search/${searchId}/filter`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("q sub 2 caractere -> 400", async () => {
    const { searchId } = seedSearchWithAviz();
    const res = await app.request(`/api/rnpm/search/${searchId}/filter`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q: "x" }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as FilterRouteBody).error).toMatch(/Minim 2 caractere/);
  });

  it("q doar whitespace -> 400 (trim apoi min 2)", async () => {
    const { searchId } = seedSearchWithAviz();
    const res = await app.request(`/api/rnpm/search/${searchId}/filter`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q: "    " }),
    });
    expect(res.status).toBe(400);
  });

  it("q peste 200 caractere -> 400", async () => {
    const { searchId } = seedSearchWithAviz();
    const res = await app.request(`/api/rnpm/search/${searchId}/filter`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q: "x".repeat(201) }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as FilterRouteBody).error).toMatch(/Termen prea lung/);
  });

  it("q cu control chars este sanitizat", async () => {
    const { searchId, avizId } = seedSearchWithAviz();
    const dirty = "pope\u200Bscu";
    const res = await app.request(`/api/rnpm/search/${searchId}/filter`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q: dirty }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as FilterRouteBody;
    expect(body.matchedAvizIds).toEqual([avizId]);
  });

  it("searchId non-numeric -> 400", async () => {
    const res = await app.request("/api/rnpm/search/not-a-number/filter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q: "test" }),
    });
    expect(res.status).toBe(400);
  });

  it("searchId inexistent -> 404 'Search inexistent'", async () => {
    const res = await app.request("/api/rnpm/search/99999/filter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q: "test" }),
    });
    expect(res.status).toBe(404);
    expect(((await res.json()) as FilterRouteBody).error).toBe("Search inexistent");
  });

  it("kill switch RNPM_RESULTS_FILTER_DISABLED=1 -> 503 cu code FILTER_DISABLED", async () => {
    const { searchId } = seedSearchWithAviz();
    process.env.RNPM_RESULTS_FILTER_DISABLED = "1";
    const res = await app.request(`/api/rnpm/search/${searchId}/filter`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q: "popescu" }),
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as FilterRouteBody;
    expect(body.code).toBe("FILTER_DISABLED");
    expect(JSON.stringify(body)).not.toContain("RNPM_RESULTS_FILTER_DISABLED");
  });

  it("log emit qLen NU raw q", async () => {
    const { searchId } = seedSearchWithAviz();
    const captured: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => {
      captured.push(typeof msg === "string" ? msg : JSON.stringify(msg));
    };
    try {
      const res = await app.request(`/api/rnpm/search/${searchId}/filter`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: "popescu" }),
      });
      expect(res.status).toBe(200);
    } finally {
      console.log = origLog;
    }
    const filterLog = captured.find((l) => l.includes('"action":"rnpm.results.filter"'));
    expect(filterLog).toBeDefined();
    expect(filterLog).toContain('"qLen":7');
    expect(filterLog).not.toContain('"q":"popescu"');
    expect(filterLog).not.toContain('"popescu"');
  });

  it("searchId al altui owner -> 404 (NU 403, anti-enumeration)", async () => {
    const other = db
      .prepare(
        `INSERT INTO rnpm_searches (owner_id, search_type, params_json, total_results, criteriu)
         VALUES ('other-tenant', 'ipoteci', '{}', 0, '')`
      )
      .run();
    const otherSearchId = Number(other.lastInsertRowid);
    const res = await app.request(`/api/rnpm/search/${otherSearchId}/filter`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q: "popescu" }),
    });
    expect(res.status).toBe(404);
    expect(((await res.json()) as FilterRouteBody).error).toBe("Search inexistent");
  });

  it("matchedCount > 1500 -> truncated=true, matchedAvizIds capped la limit configurat", async () => {
    const { searchId, avizId } = seedSearchWithAviz();
    const res = await app.request(`/api/rnpm/search/${searchId}/filter`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q: "popescu" }),
    });
    const body = (await res.json()) as FilterRouteBody;
    expect(body).toHaveProperty("truncated");
    expect(typeof body.truncated).toBe("boolean");
    expect(body.matchedAvizIds).toContain(avizId);
  });
});
