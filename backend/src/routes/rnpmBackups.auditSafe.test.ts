// Rev. 4 (Codex): mutatia e COMISA cand ruta de restore ajunge la audit — un
// esec al scrierii de audit nu are voie sa rastoarne rezultatul in 409/500
// (clientul ar repeta un restore distructiv). Fisier SEPARAT de contractul
// principal: vi.mock pe recordAudit e per-fisier si ar fi otravit rutele care
// il folosesc legitim (aviz.delete etc.). recordAuditSafe ramane REAL — apelul
// lui intern catre recordAudit e intra-modul, neatins de mock (exact de aceea
// green-ul trece: ruta nu mai atinge exportul mock-uit).

import Database from "better-sqlite3";
import path from "node:path";
import os from "node:os";
import fsPromises from "node:fs/promises";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/auditRepository.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/auditRepository.ts")>();
  return {
    ...actual,
    // recordAudit (exportul folosit direct de rute) ESUEAZA mereu — simuleaza
    // un SQLITE_BUSY tranzitoriu pe scrierea de audit.
    recordAudit: vi.fn(() => {
      throw new Error("SQLITE_BUSY simulat pe audit");
    }),
  };
});

import { __resetRnpmActivityForTests } from "../db/rnpmActivity.ts";
import { __resetRnpmDbForTests, getRnpmDb } from "../db/rnpmDb.ts";
import { closeDb, getDb } from "../db/schema.ts";
import { insertUser } from "../db/userRepository.ts";
import { requestIdContext } from "../middleware/requestId.ts";
import { appErrorHandler } from "../util/appErrorHandler.ts";
import { __resetRnpmBackupCooldownForTests, rnpmRouter } from "./rnpm.ts";

const DESKTOP = { "x-legal-dashboard-desktop": "1" } as const;
const JSON_DESKTOP = { "content-type": "application/json", ...DESKTOP } as const;

let tmpRoot: string;

function buildApp(actAs: string) {
  const app = new Hono();
  app.onError(appErrorHandler);
  app.use("*", async (c, next) => {
    c.set("ownerId", actAs);
    await next();
  });
  app.use("*", requestIdContext);
  app.route("/api/rnpm", rnpmRouter);
  return app;
}

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-rnpmbk-audit-"));
  process.env.LEGAL_DASHBOARD_DB_PATH = path.join(tmpRoot, "legal-dashboard.db");
  const seed = new Database(process.env.LEGAL_DASHBOARD_DB_PATH);
  seed.close();
  getDb();
  insertUser({ id: "u1", email: "u1@x", displayName: "U1" });
  __resetRnpmBackupCooldownForTests();
});

afterEach(async () => {
  __resetRnpmActivityForTests();
  __resetRnpmDbForTests();
  closeDb();
  // biome-ignore lint/performance/noDelete: process.env trebuie unset real.
  delete process.env.LEGAL_DASHBOARD_DB_PATH;
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

describe("POST /api/rnpm/backups/restore — auditul nu rastoarna rezultatul (Rev. 4)", () => {
  it("restore REUSIT ramane 200 chiar daca scrierea de audit pica", async () => {
    getRnpmDb("u1")
      .prepare(
        "INSERT INTO rnpm_searches (owner_id, search_type, params_json) VALUES ('u1','dupa_nume','{\"m\":\"pre\"}')"
      )
      .run();
    const app = buildApp("u1");
    const create = await app.request("/api/rnpm/backups/create", { method: "POST", headers: DESKTOP });
    expect(create.status).toBe(200);
    const { name } = (await create.json()) as { name: string };
    getRnpmDb("u1")
      .prepare(
        "INSERT INTO rnpm_searches (owner_id, search_type, params_json) VALUES ('u1','dupa_nume','{\"m\":\"post\"}')"
      )
      .run();
    __resetRnpmDbForTests();

    const res = await app.request("/api/rnpm/backups/restore", {
      method: "POST",
      headers: JSON_DESKTOP,
      body: JSON.stringify({ name }),
    });

    // Mutatia s-a comis — raspunsul nu are voie sa o rastoarne.
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
    // Fisierul chiar e cel restaurat (1 rand, nu 2) — gardul real.
    expect((getRnpmDb("u1").prepare("SELECT COUNT(*) AS n FROM rnpm_searches").get() as { n: number }).n).toBe(1);
  });
});
