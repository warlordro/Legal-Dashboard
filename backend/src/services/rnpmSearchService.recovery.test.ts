// Recuperarea automata a avizelor caror detalii au esuat.
//
// Incident 2026-08-01, reprodus de doua ori: un episod tranzitoriu de lentoare la
// RNPM face ca detaliile sa expire, iar avizele afectate se pierd COMPLET — nu se
// salveaza deloc si apar in interfata cu status "Necunoscut". Masurat: 24 din 25
// de avize pierdute intr-o cautare, iar un minut mai tarziu aceeasi cautare a
// adus 25 din 25 in 6,6 secunde.
//
// De aceea o singura trecere de recuperare la finalul cautarii recupereaza
// practic tot, fara cost de captcha: cererile de detaliu merg pe uuid, nu pe
// gcode.
import Database from "better-sqlite3";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./captchaSolver.ts", () => ({
  solveRnpmCaptcha: vi.fn(async () => "stub-gcode"),
  CaptchaError: class CaptchaError extends Error {},
}));

import { __resetRnpmActivityForTests } from "../db/rnpmActivity.ts";
import { __resetRnpmDbForTests } from "../db/rnpmDb.ts";
import { closeDb, getDb } from "../db/schema.ts";
import { RnpmClient, type RnpmFullDetail, type RnpmSearchResult, type RnpmSearchType } from "./rnpmClient.ts";
import { executeSearch } from "./rnpmSearchService.ts";

function detailFor(activ: boolean): RnpmFullDetail {
  return { part1: { activ }, part2: null, part3: null, part4: null, istoric: [] } as unknown as RnpmFullDetail;
}

// Esueaza la PRIMA cerere pentru fiecare uuid, reuseste la a doua — profilul
// episodului tranzitoriu observat in productie.
class FlakyDetailClient extends RnpmClient {
  readonly attempts = new Map<string, number>();
  constructor(private readonly docCount: number) {
    super({ requestDelayMs: 0 });
  }
  override async search(type: RnpmSearchType, _p: unknown, page: number): Promise<RnpmSearchResult> {
    void type;
    return {
      total: this.docCount,
      pagesTotal: 1,
      pageSize: 25,
      currentPage: page,
      documents: Array.from({ length: this.docCount }, (_, i) => ({
        no: i + 1,
        identificator: { k: `uuid-${i}`, v: `ID-${i}` },
        utilizatorAutorizat: "TEST SRL",
        data: "01.01.2024",
        tip: "Aviz de ipoteca mobiliara - Aviz Initial",
        needsActualizare: false,
      })),
      criteriu: "",
      eai: false,
    } as unknown as RnpmSearchResult;
  }
  override async fetchFullDetail(uuid: string): Promise<RnpmFullDetail> {
    const n = (this.attempts.get(uuid) ?? 0) + 1;
    this.attempts.set(uuid, n);
    if (n === 1) throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    return detailFor(true);
  }
}

describe("recuperarea detaliilor esuate", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-rnpm-recovery-"));
    process.env.LEGAL_DASHBOARD_DB_PATH = path.join(tmpRoot, "legal-dashboard.db");
    const seed = new Database(process.env.LEGAL_DASHBOARD_DB_PATH);
    seed.close();
    getDb();
  });

  afterEach(async () => {
    __resetRnpmActivityForTests();
    __resetRnpmDbForTests();
    closeDb();
    // biome-ignore lint/performance/noDelete: process.env trebuie unset real, nu valoare undefined.
    delete process.env.LEGAL_DASHBOARD_DB_PATH;
    await fsPromises.rm(tmpRoot, { recursive: true, force: true });
  });

  it("aduce avizele esuate la o a doua trecere, fara interventia utilizatorului", async () => {
    const client = new FlakyDetailClient(3);

    const result = await executeSearch(
      { type: "ipoteci", ownerId: "t-recovery", params: {}, captchaKey: "stub", batchSize: 3 },
      client
    );

    // Toate recuperate: nimic raportat ca esuat, toate au id in baza.
    expect(result.detailsFailed).toEqual([]);
    expect(result.avizIds.filter((id) => id !== null)).toHaveLength(3);
    // `doc.activ` vine din detaliu; daca recuperarea nu reia acea parte, avizul
    // s-ar salva dar ar ramane afisat "Necunoscut" — exact simptomul reparat.
    expect(result.documents.map((d) => d.activ)).toEqual([true, true, true]);
    // Exact doua incercari per aviz: trecerea normala plus UNA de recuperare.
    expect([...client.attempts.values()]).toEqual([2, 2, 2]);
  });

  it("ce ramane esuat si dupa recuperare e raportat, nu ascuns", async () => {
    class AlwaysFailingClient extends FlakyDetailClient {
      override async fetchFullDetail(uuid: string): Promise<RnpmFullDetail> {
        const n = (this.attempts.get(uuid) ?? 0) + 1;
        this.attempts.set(uuid, n);
        throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      }
    }
    const client = new AlwaysFailingClient(2);

    const result = await executeSearch(
      { type: "ipoteci", ownerId: "t-recovery-fail", params: {}, captchaKey: "stub", batchSize: 2 },
      client
    );

    expect(result.detailsFailed).toEqual(["ID-0", "ID-1"]);
    expect(result.avizIds).toEqual([null, null]);
    // O singura recuperare, nu bucla.
    expect([...client.attempts.values()]).toEqual([2, 2]);
  });

  it("avizele fara identificator nu se reincearca — nu exista ce cere", async () => {
    class NoKeyClient extends FlakyDetailClient {
      override async search(): Promise<RnpmSearchResult> {
        return {
          total: 1,
          pagesTotal: 1,
          pageSize: 25,
          currentPage: 1,
          documents: [
            {
              no: 1,
              identificator: { k: null, v: "ID-fara-cheie" },
              utilizatorAutorizat: "TEST SRL",
              data: "01.01.2024",
              tip: "Aviz de ipoteca mobiliara - Aviz Initial",
              needsActualizare: false,
            },
          ],
          criteriu: "",
          eai: false,
        } as unknown as RnpmSearchResult;
      }
    }
    const client = new NoKeyClient(1);

    const result = await executeSearch(
      { type: "ipoteci", ownerId: "t-recovery-nokey", params: {}, captchaKey: "stub", batchSize: 1 },
      client
    );

    expect(result.detailsFailed).toEqual(["ID-fara-cheie"]);
    expect(client.attempts.size).toBe(0);
  });
});
