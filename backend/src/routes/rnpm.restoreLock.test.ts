// CodeRabbit 1.2 / review adversarial (2026-07-26): dovada pe MECANISMUL real, nu
// doar pe ordinea apelurilor.
//
// `rnpmStorageLimit.routes.test.ts` mock-uieste `assertRnpmStorageWithinLimit`, deci
// acolo se poate asserta doar ca gardul de restore ruleaza primul. Aici limita e
// REALA: `measureRnpmStorage` intra in `withMaintenanceRead`, iar `RWLock` e
// writer-preference. Tinem writer lock-ul ocupat (patternul din rnpmBackup.test.ts)
// si verificam ca 409-ul iese FARA sa asteptam eliberarea lui.
//
// Daca gardul ar fi asezat dupa verificarea de stocare — varianta initiala a
// planului — cererea s-ar bloca pe reader lock si raspunsul nu ar veni pana la
// `releaseWriter()`, moment in care `endRnpmRestore` a rulat deja si gardul ar vedea
// `false`. Adica exact fixul care arata corect si nu face nimic.

import Database from "better-sqlite3";
import { Hono } from "hono";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/rnpmSearchService.ts", () => ({
  executeSearch: vi.fn(async () => ({
    searchId: 1,
    total: 0,
    pagesTotal: 1,
    pageSize: 25,
    currentPage: 1,
    criteriu: "",
    documents: [],
    avizIds: [],
    detailsFailed: [],
    gcode: "g",
    nextRnpmPage: null,
    captchasUsed: 0,
  })),
  executeBulkSearch: vi.fn(async () => undefined),
  executeSplitSearch: vi.fn(async () => undefined),
}));

vi.mock("./rnpmGuards.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./rnpmGuards.ts")>();
  return { ...actual, withRnpmCaptchaGuards: vi.fn() };
});

import { withMaintenanceWrite } from "../db/backup.ts";
import { __resetRnpmActivityForTests, beginRnpmRestore, endRnpmRestore } from "../db/rnpmActivity.ts";
import { __resetRnpmDbForTests } from "../db/rnpmDb.ts";
import { closeDb, getDb } from "../db/schema.ts";
import { requestIdContext } from "../middleware/requestId.ts";
import { appErrorHandler } from "../util/appErrorHandler.ts";
import { rnpmRouter } from "./rnpm.ts";
import { withRnpmCaptchaGuards } from "./rnpmGuards.ts";

const captchaGuard = vi.mocked(withRnpmCaptchaGuards);

let tmpRoot: string;

function buildApp(): Hono {
  const app = new Hono();
  app.use("*", requestIdContext);
  app.use("*", async (c, next) => {
    c.set("ownerId", "u1");
    await next();
  });
  app.route("/api/v1/rnpm", rnpmRouter);
  app.onError(appErrorHandler);
  return app;
}

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-rnpm-restore-lock-"));
  process.env.LEGAL_DASHBOARD_DB_PATH = path.join(tmpRoot, "legal-dashboard.db");
  new Database(process.env.LEGAL_DASHBOARD_DB_PATH).close();
  getDb();
  __resetRnpmActivityForTests();
  captchaGuard.mockReset().mockResolvedValue({
    ok: true,
    source: "body",
    body: { type: "ipoteci", params: {}, captchaKey: "x".repeat(32) },
    captchaKey: "x".repeat(32),
  });
});

afterEach(async () => {
  __resetRnpmActivityForTests();
  __resetRnpmDbForTests();
  closeDb();
  // biome-ignore lint/performance/noDelete: env trebuie unset real, nu undefined.
  delete process.env.LEGAL_DASHBOARD_DB_PATH;
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

describe("CR-1.2 — gardul de restore raspunde inainte de reader lock-ul de stocare", () => {
  it("POST /search intoarce 409 cat timp writer lock-ul de mentenanta e inca tinut", async () => {
    // Writer lock ocupat = restore in zbor. Limita de stocare NU e mock-uita, deci
    // assertRnpmStorageWithinLimit ar astepta pe reader lock daca ar fi atinsa.
    let releaseWriter: () => void = () => undefined;
    const writer = withMaintenanceWrite(
      () =>
        new Promise<void>((resolve) => {
          releaseWriter = resolve;
        })
    );
    await new Promise((r) => setImmediate(r)); // lasa writer-ul sa achizitioneze lock-ul
    beginRnpmRestore("u1");

    try {
      // Fara timeout artificial: daca gardul ar fi dupa stocare, `res` nu s-ar
      // rezolva aici si testul ar expira — un red inconfundabil.
      const res = await buildApp().request("/api/v1/rnpm/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "ipoteci", params: {}, captchaKey: "x".repeat(32) }),
      });

      expect(res.status).toBe(409);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("RESTORE_IN_PROGRESS");
      expect(captchaGuard).not.toHaveBeenCalled();
    } finally {
      // Eliberarea lock-ului MODULULUI si pe esec de asertie — altfel un red aici
      // otraveste testele urmatoare (acelasi motiv ca in rnpmBackup.test.ts).
      endRnpmRestore("u1");
      releaseWriter();
      await writer;
    }
  });
});
