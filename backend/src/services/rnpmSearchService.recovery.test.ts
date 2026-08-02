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

import { solveRnpmCaptcha } from "./captchaSolver.ts";

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

// Liniile de audit sunt JSON pe stdout; recuperarea nu are voie sa taie tacut.
function captureAuditLines(): { lines: string[]; stop: () => void } {
  const lines: string[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    lines.push(String(line));
  });
  return { lines, stop: () => spy.mockRestore() };
}

function findPhase(lines: string[], phase: string): Record<string, unknown> | undefined {
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      if (parsed.phase === phase) return parsed;
    } catch {
      // linie care nu e audit JSON
    }
  }
  return undefined;
}

describe("recuperarea detaliilor esuate", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    vi.clearAllMocks();
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
    // biome-ignore lint/performance/noDelete: idem.
    delete process.env.RNPM_RECOVERY_BUDGET_MS;
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
    // Argumentul economic al recuperarii automate: detaliile merg pe uuid, nu pe
    // gcode, deci a doua trecere NU costa inca un captcha. Testul mock-uieste
    // solver-ul, deci fara aceasta asertie un cost nou ar trece neobservat.
    expect(vi.mocked(solveRnpmCaptcha)).toHaveBeenCalledTimes(1);
  });

  it("recuperarea nimereste pozitiile corecte cand avizele vin din pagini diferite", async () => {
    // `avizIds` e indexat global peste toate paginile, dar bucla normala lucreaza
    // cu indici locali per pagina. Recuperarea ruleaza dupa ce toate paginile sunt
    // adunate, deci foloseste indicele global — daca cele doua s-ar amesteca,
    // avizele recuperate ar ateriza pe randurile altor avize.
    class TwoPageClient extends FlakyDetailClient {
      constructor() {
        super(6);
      }
      override async search(_t: RnpmSearchType, _p: unknown, page: number): Promise<RnpmSearchResult> {
        const base = (page - 1) * 3;
        return {
          total: 6,
          pagesTotal: 2,
          pageSize: 3,
          currentPage: page,
          documents: Array.from({ length: 3 }, (_, i) => ({
            no: base + i + 1,
            identificator: { k: `uuid-${base + i}`, v: `ID-${base + i}` },
            utilizatorAutorizat: "TEST SRL",
            data: "01.01.2024",
            tip: "Aviz de ipoteca mobiliara - Aviz Initial",
            needsActualizare: false,
          })),
          criteriu: "",
          eai: false,
        } as unknown as RnpmSearchResult;
      }
      // Esueaza prima data DOAR pentru avizele de pe pagina a doua.
      override async fetchFullDetail(uuid: string): Promise<RnpmFullDetail> {
        const n = (this.attempts.get(uuid) ?? 0) + 1;
        this.attempts.set(uuid, n);
        const idx = Number(uuid.split("-")[1]);
        if (idx >= 3 && n === 1) throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
        return detailFor(true);
      }
    }

    const result = await executeSearch(
      // `detailConcurrency: 2` peste 3 documente/pagina forteaza mai multe transe
      // per pagina, deci indicele local si cel global chiar difera.
      {
        type: "ipoteci",
        ownerId: "t-recovery-pages",
        params: {},
        captchaKey: "stub",
        batchSize: 6,
        detailConcurrency: 2,
      },
      new TwoPageClient()
    );

    expect(result.documents.map((d) => d.identificator.v)).toEqual(["ID-0", "ID-1", "ID-2", "ID-3", "ID-4", "ID-5"]);
    expect(result.detailsFailed).toEqual([]);
    // Toate cele 6 randuri au id — inclusiv pozitiile 3-5, umplute de recuperare.
    expect(result.avizIds.filter((id) => id !== null)).toHaveLength(6);
    expect(new Set(result.avizIds).size).toBe(6);
  });

  it("abortul sosit in timpul recuperarii opreste cautarea", async () => {
    // Recuperarea e o trecere in plus peste ce cere clientul; daca el pleaca in
    // timpul ei, trebuie sa se opreasca la fel ca trecerea normala — altfel am
    // reintrodus exact scrierile-dupa-abort inchise separat.
    const controller = new AbortController();
    class AbortDuringRecovery extends FlakyDetailClient {
      override async fetchFullDetail(uuid: string): Promise<RnpmFullDetail> {
        const n = (this.attempts.get(uuid) ?? 0) + 1;
        this.attempts.set(uuid, n);
        if (n === 1) throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
        controller.abort();
        return detailFor(true);
      }
    }

    await expect(
      executeSearch(
        {
          type: "ipoteci",
          ownerId: "t-recovery-abort",
          params: {},
          captchaKey: "stub",
          batchSize: 2,
          signal: controller.signal,
        },
        new AbortDuringRecovery(2)
      )
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("recuperarea are buget propriu si raporteaza ce a sarit peste", async () => {
    // Recuperarea e best-effort: cand RNPM e in continuare lent, a doua trecere
    // nu are voie sa dubleze la nesfarsit durata cautarii. Ce sare peste ramane
    // raportat ca esuat — un plafon tacut ar arata identic cu "am acoperit tot".
    process.env.RNPM_RECOVERY_BUDGET_MS = "0";
    const client = new FlakyDetailClient(3);
    const audit = captureAuditLines();

    const result = await executeSearch(
      { type: "ipoteci", ownerId: "t-recovery-budget", params: {}, captchaKey: "stub", batchSize: 3 },
      client
    );
    audit.stop();

    expect([...client.attempts.values()]).toEqual([1, 1, 1]);
    expect(result.detailsFailed).toEqual(["ID-0", "ID-1", "ID-2"]);
    expect(findPhase(audit.lines, "details_recovery")).toMatchObject({ ok: 0, skipped: 3 });
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
