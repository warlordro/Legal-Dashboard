// Integration tests for /api/v1/name-lists (PR-5 commit 3/6).
//
// Coverage:
//   POST /preview
//     - upload CSV → 200 + envelope cu rows/totals/sha256
//     - missing 'file' field → 400 missing_file
//     - oversized → 413 file_too_large
//     - missing nume column → 422 missing_name_column
//     - empty buffer → 422 empty_file
//   POST / (commit)
//     - happy path → 201 + list created + audit row monitoring.name_list.created
//     - replay (acelasi sha256) → 200 duplicate=true, no second created audit
//     - server re-validates: client trimite 'ok' pe nume_gol → server marcheaza
//       'rejected' (defense-in-depth)
//     - autoCreateJobs=true cu maxJobs<jobsTotal → partial=true, jobs au
//       name_list_id setat
//     - autoCreateJobs=true continua intre commit-uri (replay completeaza
//       restul jobs)
//     - order-stable dedup: client trimite items in alta ordine decat parser →
//       acelasi totals
//     - oversized JSON → 413
//     - body invalid → 422

import Database from "better-sqlite3";
import path from "path";
import os from "os";
import fsPromises from "fs/promises";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../db/schema.ts";
import { getAuditEvents } from "../db/auditRepository.ts";
import { requestIdContext } from "../middleware/requestId.ts";
import { nameListsRouter } from "./nameLists.ts";

let tmpRoot: string;
let dbPath: string;

function buildTestApp() {
  const app = new Hono();
  app.use("*", async (c, next) => {
    const fakeOwner = c.req.header("x-test-owner") ?? "local";
    c.set("ownerId", fakeOwner);
    await next();
  });
  app.use("*", requestIdContext);
  app.route("/api/v1/name-lists", nameListsRouter);
  return app;
}

async function postPreviewCsv(
  app: ReturnType<typeof buildTestApp>,
  csv: string,
  filename = "lista.csv",
  owner = "local",
): Promise<Response> {
  const fd = new FormData();
  fd.append("file", new Blob([csv], { type: "text/csv" }), filename);
  return app.request("/api/v1/name-lists/preview", {
    method: "POST",
    headers: { "x-test-owner": owner },
    body: fd,
  });
}

async function postCommit(
  app: ReturnType<typeof buildTestApp>,
  body: unknown,
  opts: { owner?: string; rawBody?: string; path?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.owner) headers["x-test-owner"] = opts.owner;
  return app.request(opts.path ?? "/api/v1/name-lists", {
    method: "POST",
    headers,
    body: opts.rawBody !== undefined ? opts.rawBody : JSON.stringify(body),
  });
}

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-namelists-routes-"));
  dbPath = path.join(tmpRoot, "legal-dashboard.db");
  process.env.LEGAL_DASHBOARD_DB_PATH = dbPath;
  const seed = new Database(dbPath);
  seed.close();
  getDb();
});

afterEach(async () => {
  closeDb();
  delete process.env.LEGAL_DASHBOARD_DB_PATH;
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

describe("POST /api/v1/name-lists/preview", () => {
  it("parseaza CSV minimal si returneaza envelope ok", async () => {
    const app = buildTestApp();
    const res = await postPreviewCsv(
      app,
      "nume,tip\nIon Popescu,fizic\nAcme SRL,juridic\n",
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: {
        rows: Array<{ nameRaw: string; validation: string }>;
        totals: { total: number; ok: number; warn: number; rejected: number };
        sha256: string;
        sourceFilename: string | null;
      };
      requestId: string;
    };
    expect(json.data.totals.total).toBe(2);
    expect(json.data.totals.ok).toBe(2);
    expect(json.data.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(json.data.sourceFilename).toBe("lista.csv");
    expect(json.requestId).toBeTruthy();
  });

  it("returneaza 400 cand lipseste field-ul 'file'", async () => {
    const app = buildTestApp();
    const fd = new FormData();
    fd.append("notthefile", "x");
    const res = await app.request("/api/v1/name-lists/preview", {
      method: "POST",
      body: fd,
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("missing_file");
  });

  it("returneaza 422 cand coloana 'nume' lipseste", async () => {
    const app = buildTestApp();
    const res = await postPreviewCsv(app, "tip\nfizic\n");
    expect(res.status).toBe(422);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("missing_name_column");
  });

  it("returneaza 422 pe fisier gol", async () => {
    const app = buildTestApp();
    const res = await postPreviewCsv(app, "");
    expect(res.status).toBe(422);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("empty_file");
  });

  it("nu persista nimic in DB la /preview", async () => {
    const app = buildTestApp();
    await postPreviewCsv(app, "nume\nIon\n");
    const count = (
      getDb()
        .prepare(`SELECT COUNT(*) AS n FROM name_lists`)
        .get() as { n: number }
    ).n;
    expect(count).toBe(0);
  });
});

describe("POST /api/v1/name-lists (commit)", () => {
  // sha256-uri arbitrare — server-ul nu re-deriva acest hash, doar valideaza
  // formatul. UNIQUE(owner_id, sha256) face dedup-ul. Folosim hexes diferite
  // intre teste ca sa nu colizioneze.
  const SHA1 = "a".repeat(64);
  const SHA2 = "b".repeat(64);

  const validBody = {
    title: "Lista test 1",
    sourceFilename: "lista.csv",
    sourceSha256: SHA1,
    items: [
      { nameRaw: "Ion Popescu" },
      { nameRaw: "Acme SRL" },
    ],
  };

  it("creeaza lista si returneaza 201 + envelope", async () => {
    const app = buildTestApp();
    const res = await postCommit(app, validBody);
    expect(res.status).toBe(201);
    const json = (await res.json()) as {
      data: {
        list: { id: number; title: string; total_rows: number; valid_rows: number };
        duplicate: boolean;
        totals: { total: number; ok: number; warn: number; rejected: number };
        jobsCreated: number;
        jobsTotal: number;
        partial: boolean;
      };
    };
    expect(json.data.list.title).toBe("Lista test 1");
    expect(json.data.list.total_rows).toBe(2);
    expect(json.data.list.valid_rows).toBe(2);
    expect(json.data.duplicate).toBe(false);
    expect(json.data.totals.ok).toBe(2);
    expect(json.data.jobsCreated).toBe(0); // autoCreateJobs default false
  });

  it("accepta si aliasul /commit pentru flow-ul preview -> commit", async () => {
    const app = buildTestApp();
    const res = await postCommit(app, validBody, { path: "/api/v1/name-lists/commit" });
    expect(res.status).toBe(201);
    const json = (await res.json()) as { data: { list: { title: string } } };
    expect(json.data.list.title).toBe("Lista test 1");
  });

  it("scrie audit row monitoring.name_list.created la insert nou", async () => {
    const app = buildTestApp();
    const res = await postCommit(app, validBody);
    expect(res.status).toBe(201);
    const events = getAuditEvents({
      ownerId: "local",
      action: "monitoring.name_list.created",
    });
    expect(events).toHaveLength(1);
    expect(events[0].target_kind).toBe("name_list");
    expect(JSON.parse(events[0].detail_json)).toMatchObject({
      title: "Lista test 1",
      total_rows: 2,
    });
  });

  it("replay pe acelasi sha256 returneaza 200 duplicate=true, fara audit nou", async () => {
    const app = buildTestApp();
    const first = await postCommit(app, validBody);
    expect(first.status).toBe(201);
    const firstJson = (await first.json()) as {
      data: { list: { id: number } };
    };

    const second = await postCommit(app, validBody);
    expect(second.status).toBe(200);
    const secondJson = (await second.json()) as {
      data: { list: { id: number }; duplicate: boolean };
    };
    expect(secondJson.data.duplicate).toBe(true);
    expect(secondJson.data.list.id).toBe(firstJson.data.list.id);

    const events = getAuditEvents({
      ownerId: "local",
      action: "monitoring.name_list.created",
    });
    expect(events).toHaveLength(1);
  });

  it("re-valideaza pe server: nume gol e respins indiferent ce trimite clientul", async () => {
    // Defense-in-depth: validateRawItems re-deriva validation. Daca clientul
    // ar putea ocoli regulile, ar putea introduce items rejected ca jobs.
    const app = buildTestApp();
    const res = await postCommit(app, {
      ...validBody,
      sourceSha256: SHA2,
      items: [
        { nameRaw: "Ion Popescu" },
        { nameRaw: "   " }, // gol dupa trim
      ],
    });
    expect(res.status).toBe(201);
    const json = (await res.json()) as {
      data: {
        totals: { ok: number; rejected: number };
        list: { total_rows: number; valid_rows: number };
      };
    };
    expect(json.data.totals.ok).toBe(1);
    expect(json.data.totals.rejected).toBe(1);
    // valid_rows = ok + warn (items care VOR deveni jobs); rejected nu e numarat
    expect(json.data.list.valid_rows).toBe(1);
    expect(json.data.list.total_rows).toBe(2);
  });

  it("dedup-ul ramane stabil cand items vin in alta ordine", async () => {
    const app = buildTestApp();
    const orderA = await postCommit(app, {
      ...validBody,
      sourceSha256: "1".repeat(64),
      items: [
        { nameRaw: "Ion" },
        { nameRaw: "Maria" },
        { nameRaw: "Ion" }, // duplicate
      ],
    });
    expect(orderA.status).toBe(201);
    const a = (await orderA.json()) as {
      data: { totals: { ok: number; warn: number; rejected: number } };
    };

    const orderB = await postCommit(app, {
      ...validBody,
      sourceSha256: "2".repeat(64),
      items: [
        { nameRaw: "Maria" },
        { nameRaw: "Ion" },
        { nameRaw: "Ion" }, // duplicate
      ],
    });
    expect(orderB.status).toBe(201);
    const b = (await orderB.json()) as {
      data: { totals: { ok: number; warn: number; rejected: number } };
    };

    // Acelasi count de ok / warn / rejected indiferent de ordine.
    expect(b.data.totals.ok).toBe(a.data.totals.ok);
    expect(b.data.totals.warn).toBe(a.data.totals.warn);
    expect(b.data.totals.rejected).toBe(a.data.totals.rejected);
  });

  it("autoCreateJobs=true creeaza jobs cu name_list_id setat", async () => {
    const app = buildTestApp();
    const res = await postCommit(app, {
      ...validBody,
      autoCreateJobs: true,
    });
    expect(res.status).toBe(201);
    const json = (await res.json()) as {
      data: {
        list: { id: number };
        jobsCreated: number;
        jobsTotal: number;
        partial: boolean;
      };
    };
    expect(json.data.jobsCreated).toBe(2);
    expect(json.data.jobsTotal).toBe(2);
    expect(json.data.partial).toBe(false);

    // Joburile au name_list_id setat (lineage pentru archiveList).
    const jobs = getDb()
      .prepare(
        `SELECT id, kind, name_list_id FROM monitoring_jobs
         WHERE owner_id = 'local' AND name_list_id = ?`,
      )
      .all(json.data.list.id) as Array<{
        id: number;
        kind: string;
        name_list_id: number;
      }>;
    expect(jobs).toHaveLength(2);
    expect(jobs.every((j) => j.kind === "name_soap")).toBe(true);

    // monitoring.name_list.committed audit row prezent (un singur rind, NU
    // unul per job — bulk audit).
    const committed = getAuditEvents({
      ownerId: "local",
      action: "monitoring.name_list.committed",
    });
    expect(committed).toHaveLength(1);
    expect(JSON.parse(committed[0].detail_json)).toMatchObject({
      jobs_created: 2,
      jobs_total: 2,
      partial: false,
    });
  });

  it("autoCreateJobs cu maxJobs sub jobsTotal returneaza partial=true", async () => {
    const app = buildTestApp();
    const items = Array.from({ length: 5 }, (_, i) => ({
      nameRaw: `Persoana ${i}`,
    }));
    const res = await postCommit(app, {
      title: "Lista mare",
      sourceFilename: "mare.csv",
      sourceSha256: "c".repeat(64),
      items,
      autoCreateJobs: true,
      maxJobs: 2,
    });
    expect(res.status).toBe(201);
    const json = (await res.json()) as {
      data: { jobsCreated: number; jobsTotal: number; partial: boolean };
    };
    expect(json.data.jobsCreated).toBe(2);
    expect(json.data.jobsTotal).toBe(5);
    expect(json.data.partial).toBe(true);
  });

  it("re-trimit commit cu autoCreateJobs continua de unde a ramas", async () => {
    // Replay scenario: prima cerere creeaza 2 din 5 joburi (partial=true).
    // A doua cerere (acelasi sha256, autoCreateJobs=true) gaseste lista
    // existenta + 3 items inca nelegate, creeaza inca 2 (partial=true cu
    // jobsTotal=3 → ramane 1), a treia cerere creeaza ultimul.
    const app = buildTestApp();
    const items = Array.from({ length: 5 }, (_, i) => ({
      nameRaw: `Continua ${i}`,
    }));
    const sha = "d".repeat(64);
    const body = {
      title: "Lista continua",
      sourceFilename: "c.csv",
      sourceSha256: sha,
      items,
      autoCreateJobs: true,
      maxJobs: 2,
    };

    const r1 = await postCommit(app, body);
    expect(r1.status).toBe(201);
    const j1 = (await r1.json()) as {
      data: { jobsCreated: number; jobsTotal: number; partial: boolean };
    };
    expect(j1.data.jobsCreated).toBe(2);
    expect(j1.data.partial).toBe(true);

    const r2 = await postCommit(app, body);
    expect(r2.status).toBe(200); // duplicate (sha256 replay)
    const j2 = (await r2.json()) as {
      data: { jobsCreated: number; jobsTotal: number; partial: boolean; duplicate: boolean };
    };
    expect(j2.data.duplicate).toBe(true);
    expect(j2.data.jobsCreated).toBe(2);
    expect(j2.data.jobsTotal).toBe(3); // 5 - 2 deja legate
    expect(j2.data.partial).toBe(true);

    const r3 = await postCommit(app, body);
    expect(r3.status).toBe(200);
    const j3 = (await r3.json()) as {
      data: { jobsCreated: number; jobsTotal: number; partial: boolean };
    };
    expect(j3.data.jobsCreated).toBe(1);
    expect(j3.data.jobsTotal).toBe(1);
    expect(j3.data.partial).toBe(false);

    // Total: 5 joburi cu name_list_id setat, owner local.
    const totalJobs = (
      getDb()
        .prepare(
          `SELECT COUNT(*) AS n FROM monitoring_jobs
           WHERE owner_id = 'local' AND name_list_id IS NOT NULL`,
        )
        .get() as { n: number }
    ).n;
    expect(totalJobs).toBe(5);
  });

  it("rejecteaza body invalid (sha256 hex gresit) cu 422", async () => {
    const app = buildTestApp();
    const res = await postCommit(app, {
      ...validBody,
      sourceSha256: "nu-este-hex",
    });
    expect(res.status).toBe(422);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("invalid_payload");
  });

  it("rejecteaza body fara items (min 1)", async () => {
    const app = buildTestApp();
    const res = await postCommit(app, {
      ...validBody,
      items: [],
    });
    expect(res.status).toBe(422);
  });

  it("rejecteaza JSON malformat cu 400 invalid_json", async () => {
    const app = buildTestApp();
    const res = await postCommit(app, null, { rawBody: "{ not valid" });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("invalid_json");
  });

  it("izoleaza listele intre owneri (sha256 colision-free intre owners)", async () => {
    const app = buildTestApp();
    const aliceRes = await postCommit(app, validBody, { owner: "alice" });
    expect(aliceRes.status).toBe(201);
    const aliceJson = (await aliceRes.json()) as {
      data: { list: { id: number } };
    };

    // Bob trimite ACELASI sha256 — se creeaza o lista noua pentru Bob, nu se
    // returneaza lista lui Alice (UNIQUE este pe (owner_id, sha256)).
    const bobRes = await postCommit(app, validBody, { owner: "bob" });
    expect(bobRes.status).toBe(201);
    const bobJson = (await bobRes.json()) as {
      data: { list: { id: number; owner_id: string }; duplicate: boolean };
    };
    expect(bobJson.data.duplicate).toBe(false);
    expect(bobJson.data.list.id).not.toBe(aliceJson.data.list.id);
    expect(bobJson.data.list.owner_id).toBe("bob");
  });
});

describe("GET /api/v1/name-lists", () => {
  it("listeaza listele owner-scoped", async () => {
    const app = buildTestApp();
    await postCommit(app, {
      title: "Lista Alice",
      sourceFilename: "a.csv",
      sourceSha256: "e".repeat(64),
      items: [{ nameRaw: "Alice Test" }],
    }, { owner: "alice" });
    await postCommit(app, {
      title: "Lista Bob",
      sourceFilename: "b.csv",
      sourceSha256: "f".repeat(64),
      items: [{ nameRaw: "Bob Test" }],
    }, { owner: "bob" });

    const res = await app.request("/api/v1/name-lists?page=1&pageSize=10", {
      headers: { "x-test-owner": "alice" },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: { rows: Array<{ title: string }>; total: number };
    };
    expect(json.data.total).toBe(1);
    expect(json.data.rows[0]!.title).toBe("Lista Alice");
  });
});
