// executeSplitSearch — verifies the v2.18.0 dispatcher behavior:
//
// 1. EVERY tier-1 sub-type is iterated even when one in the middle hits
//    `limit_exceeded` (no early exit, no skip-on-failure of subsequent items).
// 2. When a tier-1 sub-type is rejected for `limit_exceeded` AND the category
//    has enumerable destinations (specifice/ipoteci), tier-2 split runs over
//    EVERY destination from DESTINATII_BY_CATEGORY[type].
// 3. The gap (= tier1SubTotal - SUM(tier2 subTotals)) is computed and surfaced
//    in splitStats so the UI can disclose unrecovered records.
// 4. Categories without enumerable destinations (creante/obligatiuni/fiducii)
//    fall back to the v2.17.0 fail-clean behavior (status: "blocked",
//    gapReason: "terminal_cap", no nested split attempted).
// 5. v2.20.0: gapReason classifier — terminal_cap (no axis), silent_refusal
//    (RNPM total>0 but documents:[]), residual_unclassified (tier-1 - SUM(tier-2) > 0).
//
// Captcha is stubbed via vi.mock at module boundary to avoid real network.

import Database from "better-sqlite3";
import path from "path";
import os from "os";
import fsPromises from "fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./captchaSolver.ts", () => ({
  solveRnpmCaptcha: vi.fn(async () => "stub-gcode"),
  // Re-export the surface we depend on but never reach in this test.
  CaptchaError: class CaptchaError extends Error {},
}));

import { closeDb, getDb } from "../db/schema.ts";
import { executeSplitSearch } from "./rnpmSearchService.ts";
import {
  RnpmClient,
  RnpmError,
  type RnpmSearchResult,
  type RnpmSearchType,
  type RnpmFullDetail,
} from "./rnpmClient.ts";
import { DESTINATII_INSCRIERII, DESTINATII_IPOTECI } from "./rnpmDestinations.ts";

// Mirror al frontend/src/components/rnpm/rnpm-form-constants.ts pentru fixtures
// in test. Sub-tipurile reale sunt sursa de adevar pe frontend; aici avem nevoie
// doar de liste lungimea-corecta ca executeSplitSearch sa itereze realist.
const TIP_AVIZ_BY_CATEGORY_BACKEND: Record<RnpmSearchType, string[]> = {
  ipoteci: [
    "aviz initial",
    "cesiune a creantei",
    "extindere",
    "intentie",
    "modificator",
    "nulitate",
    "prelungire",
    "reducere",
    "stingere",
    "transformare",
    "executare",
    "preluare",
    "schimbarea rangului",
    "mentinere",
    "cesiunea rangului ipotecii",
    "reactivare",
    "actualizare",
    "indreptare a erorii materiale",
  ],
  specifice: [
    "aviz initial",
    "modificare",
    "stingere",
    "nulitate",
    "prelungire",
    "reactivare",
    "indreptare a erorii materiale",
  ],
  fiducii: [
    "aviz initial",
    "acceptare",
    "modificare",
    "nulitate",
    "stingere",
    "reactivare",
    "indreptare a erorii materiale",
  ],
  creante: [
    "aviz initial",
    "modificare",
    "extindere",
    "reducere",
    "stingere",
    "nulitate",
    "prelungire",
    "reactivare",
    "indreptare a erorii materiale",
  ],
  obligatiuni: [
    "aviz initial",
    "modificare",
    "extindere",
    "reducere",
    "stingere",
    "nulitate",
    "prelungire",
    "reactivare",
    "indreptare a erorii materiale",
  ],
};

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-rnpm-split-"));
  process.env.LEGAL_DASHBOARD_DB_PATH = path.join(tmpRoot, "legal-dashboard.db");
  const seed = new Database(process.env.LEGAL_DASHBOARD_DB_PATH);
  seed.close();
  getDb();
});

afterEach(async () => {
  closeDb();
  delete process.env.LEGAL_DASHBOARD_DB_PATH;
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

// Minimal fake RnpmClient — only `search` and `fetchFullDetail` are touched
// from executeSearch. fetchFullDetail returns null parts so the persistence
// path saves an aviz row but no detail rows; the test does not assert on
// per-aviz contents, only on the splitStats shape and dispatcher iteration.
class StubClient extends RnpmClient {
  searchCalls: { type: RnpmSearchType; tipInscriere?: string; destinatie?: string; page: number }[] = [];

  constructor(
    private readonly handler: (params: {
      type: RnpmSearchType;
      tipIdx: string | undefined;
      destinatie: string | undefined;
      page: number;
    }) => RnpmSearchResult | RnpmError
  ) {
    super({ requestDelayMs: 0 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override async search(type: RnpmSearchType, params: any, page = 1): Promise<RnpmSearchResult> {
    const tipIdx = params?.tipInscriere?.value as string | undefined;
    const destinatie = params?.destinatieInscriere?.value as string | undefined;
    this.searchCalls.push({ type, tipInscriere: tipIdx, destinatie, page });
    const out = this.handler({ type, tipIdx, destinatie, page });
    if (out instanceof RnpmError) throw out;
    return out;
  }

  override async fetchFullDetail(): Promise<RnpmFullDetail> {
    return { part1: null, part2: null, part3: null, part4: null, istoric: [] };
  }

  override async sleep(): Promise<void> {
    /* no-op for tests */
  }
}

function emptyResult(): RnpmSearchResult {
  return { total: 0, pagesTotal: 1, pageSize: 25, currentPage: 1, documents: [], criteriu: "", eai: false };
}

function singleDocResult(idx: string): RnpmSearchResult {
  return {
    total: 1,
    pagesTotal: 1,
    pageSize: 25,
    currentPage: 1,
    documents: [
      {
        no: 1,
        identificator: { v: `aviz-${idx}`, k: `uuid-${idx}` },
        utilizatorAutorizat: "",
        data: "",
        tip: "",
        needsActualizare: false,
      },
    ],
    criteriu: "",
    eai: false,
  };
}

describe("executeSplitSearch — v2.18.0 nested destination dispatcher", () => {
  it("iterates EVERY tier-1 sub-type even when one in the middle hits limit_exceeded (specifice + tier-2)", async () => {
    const ipotSubTypes = TIP_AVIZ_BY_CATEGORY_BACKEND.specifice;
    expect(ipotSubTypes.length).toBeGreaterThanOrEqual(3);

    // Tier-1 sub-type at index 1 (1-based "2") will hit limit_exceeded with total=1826.
    // Tier-2 split over destinatii: first 3 destinatii return 500 docs each (total covered 1500),
    // rest return empty. Final gap should be 1826 - 1500 = 326.
    const REJECT_TIER1_IDX = "2";
    const tier2Docs = 500;
    const stub = new StubClient(({ tipIdx, destinatie }) => {
      if (destinatie != null) {
        // v2.18.0 fix: destinatieInscriere e index 1-based (la fel ca tipInscriere).
        const destIdx = Number.parseInt(destinatie, 10) - 1;
        if (destIdx >= 0 && destIdx < 3) {
          return {
            total: tier2Docs,
            pagesTotal: 1,
            pageSize: tier2Docs,
            currentPage: 1,
            documents: Array.from({ length: tier2Docs }, (_, i) => ({
              no: i + 1,
              identificator: { v: `t2-${destIdx}-${i}`, k: null }, // k=null skips fetchFullDetail
              utilizatorAutorizat: "",
              data: "",
              tip: "",
              needsActualizare: false,
            })),
            criteriu: "",
            eai: false,
          };
        }
        return emptyResult();
      }
      if (tipIdx === REJECT_TIER1_IDX) {
        // Simulate the upstream silent reject: total > MAX_TOTAL_RESULTS, documents empty.
        return { total: 1826, pagesTotal: 74, pageSize: 25, currentPage: 1, documents: [], criteriu: "", eai: false };
      }
      // Other tier-1 sub-types return one doc each — verifies iteration continues.
      return singleDocResult(tipIdx ?? "?");
    });

    const progress: Array<{ phase: string; label: string; nestedPhase?: string }> = [];

    const result = await executeSplitSearch(
      {
        type: "specifice",
        baseParams: {},
        subTypeLabels: ipotSubTypes,
        captchaKey: "stub-key",
      },
      (p) => progress.push({ phase: p.phase, label: p.label, nestedPhase: p.nested?.phase }),
      stub
    );

    // Dispatcher iteration: every tier-1 sub-type must have been searched at least once.
    const tier1Indices = new Set(stub.searchCalls.filter((c) => c.destinatie == null).map((c) => c.tipInscriere));
    for (let i = 1; i <= ipotSubTypes.length; i++) {
      expect(tier1Indices.has(String(i))).toBe(true);
    }

    // Tier-2: every destination index from DESTINATII_INSCRIERII must have been searched
    // for the rejected tier-1 sub-type. (Advisor flag 2c — guard against missing some.)
    // v2.18.0 fix: destinatie e trimis ca index 1-based, NU label.
    const tier2Destinations = new Set(
      stub.searchCalls
        .filter((c) => c.destinatie != null && c.tipInscriere === REJECT_TIER1_IDX)
        .map((c) => c.destinatie)
    );
    for (let i = 1; i <= DESTINATII_INSCRIERII.length; i++) {
      expect(tier2Destinations.has(String(i))).toBe(true);
    }

    // splitStats: rejected tier-1 entry should now be "partial" (gap > 0)
    const rejectedLabel = ipotSubTypes[1];
    const rejected = result.splitStats.find((s) => s.label === rejectedLabel);
    expect(rejected).toBeDefined();
    expect(rejected!.status).toBe("partial");
    expect(rejected!.subTotal).toBe(1826);
    expect(rejected!.count).toBe(tier2Docs * 3);
    expect(rejected!.nested).toBeDefined();
    expect(rejected!.nested!.length).toBe(DESTINATII_INSCRIERII.length);
    // Gap = tier1Total (1826) - SUM(tier2 subTotals) = 1826 - 1500 = 326
    expect(rejected!.gap).toBe(326);
    // v2.20.0: gapReason populat pentru "partial" cu gap > 0.
    expect(rejected!.gapReason).toBe("residual_unclassified");

    // Other tier-1 entries succeeded as "ok" — dispatcher did not abort.
    const okEntries = result.splitStats.filter((s) => s.status === "ok");
    expect(okEntries.length).toBe(ipotSubTypes.length - 1);
  });

  it("falls back to fail-clean (blocked + terminal_cap) when category has no enumerable destinations (creante)", async () => {
    const subTypes = TIP_AVIZ_BY_CATEGORY_BACKEND.creante;
    const REJECT_IDX = "1";
    const stub = new StubClient(({ tipIdx, destinatie }) => {
      // creante has no destinatii — backend MUST NOT call client.search with destinatieInscriere.
      expect(destinatie).toBeUndefined();
      if (tipIdx === REJECT_IDX) {
        return { total: 9999, pagesTotal: 400, pageSize: 25, currentPage: 1, documents: [], criteriu: "", eai: false };
      }
      return emptyResult();
    });

    const result = await executeSplitSearch(
      { type: "creante", baseParams: {}, subTypeLabels: subTypes, captchaKey: "stub-key" },
      () => {
        /* progress ignored */
      },
      stub
    );

    const blocked = result.splitStats.find((s) => s.label === subTypes[0]);
    expect(blocked!.status).toBe("blocked");
    expect(blocked!.subTotal).toBe(9999);
    expect(blocked!.nested).toBeUndefined();
    expect(blocked!.gap).toBeUndefined();
    // v2.20.0: terminal_cap = nicio axa de split disponibila pentru aceasta categorie.
    expect(blocked!.gapReason).toBe("terminal_cap");
  });

  it("classifies tier-1 silent reject as blocked + silent_refusal (specifice cu total>0 si documents:[])", async () => {
    const subTypes = TIP_AVIZ_BY_CATEGORY_BACKEND.specifice;
    const REJECT_IDX = "1";
    // Tier-1 idx 1 returneaza total=600 (sub cap) DAR documents:[] -> silent reject.
    // Pentru ca total < MAX_TOTAL_RESULTS, executeSearch nu emite limit_exceeded;
    // executeSplitSearch detecteaza scenariul direct si seteaza gapReason: silent_refusal.
    const stub = new StubClient(({ tipIdx, destinatie }) => {
      if (destinatie != null) return emptyResult();
      if (tipIdx === REJECT_IDX) {
        return { total: 600, pagesTotal: 24, pageSize: 25, currentPage: 1, documents: [], criteriu: "", eai: false };
      }
      return emptyResult();
    });

    const result = await executeSplitSearch(
      { type: "specifice", baseParams: {}, subTypeLabels: subTypes, captchaKey: "stub-key" },
      () => {
        /* ignored */
      },
      stub
    );

    const blocked = result.splitStats.find((s) => s.label === subTypes[0]);
    expect(blocked!.status).toBe("blocked");
    expect(blocked!.subTotal).toBe(600);
    expect(blocked!.count).toBe(0);
    expect(blocked!.gapReason).toBe("silent_refusal");
    // Nicio chemare tier-2 nu trebuie facuta pentru acest sub-tip — silent_refusal nu beneficiaza de split.
    const tier2Calls = stub.searchCalls.filter((c) => c.destinatie != null && c.tipInscriere === REJECT_IDX);
    expect(tier2Calls.length).toBe(0);
  });

  it("v2.20.3 Grupul I: fail-fast dupa K=3 silent_refusal consecutive (skipped restul cu reason)", async () => {
    const subTypes = TIP_AVIZ_BY_CATEGORY_BACKEND.ipoteci; // 18 sub-tipuri
    expect(subTypes.length).toBeGreaterThanOrEqual(6);

    // Primii 3 tier-1 returneaza total>0 + documents:[] (silent_refusal).
    // Al 4-lea trebuie sa NU fie chemat — fail-fast a sarit toata coada.
    const stub = new StubClient(({ tipIdx }) => {
      const idx = Number.parseInt(tipIdx ?? "0", 10);
      if (idx >= 1 && idx <= 3) {
        return { total: 600, pagesTotal: 24, pageSize: 25, currentPage: 1, documents: [], criteriu: "", eai: false };
      }
      // Idx >= 4 nu ar trebui sa primeasca call — daca primeste, testul cade pe assert.
      return singleDocResult(tipIdx ?? "?");
    });

    const result = await executeSplitSearch(
      { type: "ipoteci", baseParams: {}, subTypeLabels: subTypes, captchaKey: "stub-key" },
      () => {
        /* progress ignored */
      },
      stub
    );

    // Verifica ca DOAR primii 3 tier-1 au fost cautati (nu si idx 4..18).
    const tier1Calls = stub.searchCalls.filter((c) => c.destinatie == null);
    const tier1Indices = new Set(tier1Calls.map((c) => c.tipInscriere));
    expect(tier1Indices.has("1")).toBe(true);
    expect(tier1Indices.has("2")).toBe(true);
    expect(tier1Indices.has("3")).toBe(true);
    expect(tier1Indices.has("4")).toBe(false);
    expect(tier1Indices.has("5")).toBe(false);

    // splitStats: 3 entries blocked + silent_refusal, restul "error" cu fail-fast reason.
    expect(result.splitStats.length).toBe(subTypes.length);
    for (let i = 0; i < 3; i++) {
      expect(result.splitStats[i].status).toBe("blocked");
      expect(result.splitStats[i].gapReason).toBe("silent_refusal");
    }
    for (let i = 3; i < subTypes.length; i++) {
      expect(result.splitStats[i].status).toBe("error");
      expect(result.splitStats[i].reason).toMatch(/fail-fast/i);
    }
  });

  it("v2.20.3 Grupul I: 2 silent_refusal + 1 success NU declanseaza fail-fast (counter reset)", async () => {
    const subTypes = TIP_AVIZ_BY_CATEGORY_BACKEND.ipoteci;
    // Primii 2 silent_refusal, idx=3 success cu 1 doc, idx=4 silent_refusal — counter
    // a fost resetat la idx=3, deci la idx=4 contorul e 1, nu 3. Trebuie sa se cheme
    // toti 18.
    const stub = new StubClient(({ tipIdx }) => {
      const idx = Number.parseInt(tipIdx ?? "0", 10);
      if (idx === 1 || idx === 2 || idx === 4) {
        return { total: 500, pagesTotal: 20, pageSize: 25, currentPage: 1, documents: [], criteriu: "", eai: false };
      }
      return singleDocResult(tipIdx ?? "?");
    });

    const result = await executeSplitSearch(
      { type: "ipoteci", baseParams: {}, subTypeLabels: subTypes, captchaKey: "stub-key" },
      () => {
        /* progress ignored */
      },
      stub
    );

    // Toate 18 tier-1 au fost cautate (counter a fost resetat de success la idx 3).
    const tier1Indices = new Set(stub.searchCalls.filter((c) => c.destinatie == null).map((c) => c.tipInscriere));
    for (let i = 1; i <= subTypes.length; i++) {
      expect(tier1Indices.has(String(i))).toBe(true);
    }

    // Si splitStats are 18 entries, niciuna cu reason fail-fast.
    expect(result.splitStats.length).toBe(subTypes.length);
    const failFast = result.splitStats.filter((s) => s.reason?.match(/fail-fast/i));
    expect(failFast.length).toBe(0);
  });

  // ===========================================================================
  // v2.20.3 Grupul N — Edge case tests pentru robustness pe combinatii rare.
  // Acopera: abort mid-tier-2, mixed gapReasons in acelasi result, single-sub-
  // type, all-empty, tier-2 error path.
  // ===========================================================================

  it("v2.20.3 Grupul N: abort mid-tier-2 propagates AbortError, splitStats reflecta partial state", async () => {
    const subTypes = TIP_AVIZ_BY_CATEGORY_BACKEND.specifice;
    const REJECT_TIER1_IDX = "1";
    const ac = new AbortController();
    let tier2CallCount = 0;

    const stub = new StubClient(({ tipIdx, destinatie }) => {
      if (destinatie != null) {
        tier2CallCount++;
        if (tier2CallCount === 2) {
          // Aborteaza dupa al 2-lea call tier-2 — al 3-lea call va lovi
          // throwIfAborted la inceputul iteratiei.
          ac.abort();
        }
        return {
          total: 100,
          pagesTotal: 1,
          pageSize: 100,
          currentPage: 1,
          documents: Array.from({ length: 100 }, (_, k) => ({
            no: k + 1,
            identificator: { v: `t2-${destinatie}-${k}`, k: null },
            utilizatorAutorizat: "",
            data: "",
            tip: "",
            needsActualizare: false,
          })),
          criteriu: "",
          eai: false,
        };
      }
      if (tipIdx === REJECT_TIER1_IDX) {
        return { total: 1700, pagesTotal: 68, pageSize: 25, currentPage: 1, documents: [], criteriu: "", eai: false };
      }
      return emptyResult();
    });

    await expect(
      executeSplitSearch(
        { type: "specifice", baseParams: {}, subTypeLabels: subTypes, captchaKey: "stub-key", signal: ac.signal },
        () => {
          /* ignored */
        },
        stub
      )
    ).rejects.toThrow(/Aborted/);

    // Cel putin 2 destinatii au fost cautate inainte de abort (al treilea call
    // ar fi fost blocat de throwIfAborted la inceputul buclei tier-2).
    const tier2Calls = stub.searchCalls.filter((c) => c.destinatie != null);
    expect(tier2Calls.length).toBeGreaterThanOrEqual(2);
    expect(tier2Calls.length).toBeLessThan(DESTINATII_INSCRIERII.length);
  });

  it("v2.20.3 Grupul N: mixed gapReasons in acelasi result (terminal_cap + silent_refusal + residual_unclassified)", async () => {
    // ipoteci: 18 sub-tipuri.
    //   idx 1 = silent_refusal pur (total>0 sub-cap, docs=[]).
    //   idx 2 = limit_exceeded -> tier-2 cu DEST 1 succes (400 docs), restul empty -> residual_unclassified (gap 1300).
    //   idx 3 = limit_exceeded -> TOATE destinatiile tier-2 returneaza total>1500 -> nested.gapReason=terminal_cap pe fiecare.
    //   idx 4..18 = ok cu 1 doc.
    const subTypes = TIP_AVIZ_BY_CATEGORY_BACKEND.ipoteci;
    const stub = new StubClient(({ tipIdx, destinatie }) => {
      if (destinatie != null) {
        if (tipIdx === "3") {
          // Toate destinatiile pentru tier-1 idx 3 -> tier-2 limit_exceeded -> terminal_cap pe nested.
          return { total: 2000, pagesTotal: 80, pageSize: 25, currentPage: 1, documents: [], criteriu: "", eai: false };
        }
        if (tipIdx === "2") {
          if (destinatie === "1") {
            return {
              total: 400,
              pagesTotal: 1,
              pageSize: 400,
              currentPage: 1,
              documents: Array.from({ length: 400 }, (_, k) => ({
                no: k + 1,
                identificator: { v: `t2-2-${k}`, k: null },
                utilizatorAutorizat: "",
                data: "",
                tip: "",
                needsActualizare: false,
              })),
              criteriu: "",
              eai: false,
            };
          }
          return emptyResult();
        }
        return emptyResult();
      }
      const idx = Number.parseInt(tipIdx ?? "0", 10);
      if (idx === 1) {
        // silent_refusal: total > 0 dar sub cap -> documents:[].
        return { total: 600, pagesTotal: 24, pageSize: 25, currentPage: 1, documents: [], criteriu: "", eai: false };
      }
      if (idx === 2 || idx === 3) {
        // tier-1 over cap -> trigger limit_exceeded in executeSearch.
        return { total: 1700, pagesTotal: 68, pageSize: 25, currentPage: 1, documents: [], criteriu: "", eai: false };
      }
      return singleDocResult(tipIdx ?? "?");
    });

    const result = await executeSplitSearch(
      { type: "ipoteci", baseParams: {}, subTypeLabels: subTypes, captchaKey: "stub-key" },
      () => {
        /* ignored */
      },
      stub
    );

    const idx0 = result.splitStats[0]; // silent_refusal direct la tier-1
    const idx1 = result.splitStats[1]; // residual_unclassified (tier-1 1700 - tier-2 400 = 1300)
    const idx2 = result.splitStats[2]; // tier-1 partial cu nested entries terminal_cap

    // idx 0: silent_refusal pur la tier-1.
    expect(idx0.status).toBe("blocked");
    expect(idx0.gapReason).toBe("silent_refusal");

    // idx 1: residual_unclassified (tier-1 1700 minus tier-2 SUM 400 = gap 1300).
    expect(idx1.status).toBe("partial");
    expect(idx1.gapReason).toBe("residual_unclassified");
    expect(idx1.gap).toBe(1300);

    // idx 2: tier-1 a triggered nested split, dar TOATE destinatiile au returnat
    // limit_exceeded la tier-2 -> nested status=blocked + gapReason=terminal_cap.
    expect(idx2.nested).toBeDefined();
    expect(idx2.nested!.every((n) => n.gapReason === "terminal_cap")).toBe(true);

    // Restul = ok.
    for (let i = 3; i < subTypes.length; i++) {
      expect(result.splitStats[i].status).toBe("ok");
    }
  });

  it("v2.20.3 Grupul N: single-sub-type input ruleaza fara split (subN=1)", async () => {
    const stub = new StubClient(({ tipIdx }) => {
      if (tipIdx === "1") return singleDocResult("1");
      throw new Error("unexpected tipInscriere index");
    });

    const result = await executeSplitSearch(
      { type: "creante", baseParams: {}, subTypeLabels: ["aviz initial"], captchaKey: "stub-key" },
      () => {
        /* ignored */
      },
      stub
    );

    expect(result.splitStats.length).toBe(1);
    expect(result.splitStats[0].status).toBe("ok");
    expect(result.documents.length).toBe(1);
    // Captchasusage acumulat din result.captchasUsed (Grupul M).
    expect(result.captchasUsed).toBeGreaterThanOrEqual(1);
  });

  it("v2.20.3 Grupul N: all-empty subtypes returneaza splitStats integral cu status=empty", async () => {
    const subTypes = TIP_AVIZ_BY_CATEGORY_BACKEND.creante;
    const stub = new StubClient(() => emptyResult());

    const result = await executeSplitSearch(
      { type: "creante", baseParams: {}, subTypeLabels: subTypes, captchaKey: "stub-key" },
      () => {
        /* ignored */
      },
      stub
    );

    expect(result.splitStats.length).toBe(subTypes.length);
    expect(result.splitStats.every((s) => s.status === "empty")).toBe(true);
    expect(result.documents.length).toBe(0);
    expect(result.upstreamTotal).toBe(0);
  });

  it("v2.20.3 Grupul N: tier-2 generic error pe o destinatie -> nested status=error, restul continua", async () => {
    const subTypes = TIP_AVIZ_BY_CATEGORY_BACKEND.ipoteci;
    const REJECT_TIER1_IDX = "1";
    const stub = new StubClient(({ tipIdx, destinatie }) => {
      if (destinatie != null) {
        if (destinatie === "3") {
          // Eroare generica (nu RnpmError limit_exceeded, nu AbortError) -> nested status=error.
          throw new Error("Network blip pe destinatia 3");
        }
        return emptyResult();
      }
      if (tipIdx === REJECT_TIER1_IDX) {
        // tier-1 over cap -> trigger limit_exceeded in executeSearch -> tier-2 starts.
        return { total: 1700, pagesTotal: 68, pageSize: 25, currentPage: 1, documents: [], criteriu: "", eai: false };
      }
      return emptyResult();
    });

    const result = await executeSplitSearch(
      { type: "ipoteci", baseParams: {}, subTypeLabels: subTypes, captchaKey: "stub-key" },
      () => {
        /* ignored */
      },
      stub
    );

    const tier1 = result.splitStats[0];
    expect(tier1.nested).toBeDefined();
    const errorDest = tier1.nested!.find((n) => n.status === "error");
    expect(errorDest).toBeDefined();
    expect(errorDest!.reason).toMatch(/Network blip/);

    // Restul destinatiilor au continuat (status empty) — fara early-exit pe error.
    const emptyDests = tier1.nested!.filter((n) => n.status === "empty");
    expect(emptyDests.length).toBe(DESTINATII_IPOTECI.length - 1);
  });

  it("ipoteci tier-2 covers exactly DESTINATII_IPOTECI (10) entries", async () => {
    const subTypes = TIP_AVIZ_BY_CATEGORY_BACKEND.ipoteci;
    const REJECT_IDX = "1";
    const stub = new StubClient(({ tipIdx, destinatie }) => {
      if (destinatie != null) return emptyResult();
      if (tipIdx === REJECT_IDX) {
        return { total: 1700, pagesTotal: 68, pageSize: 25, currentPage: 1, documents: [], criteriu: "", eai: false };
      }
      return emptyResult();
    });

    await executeSplitSearch(
      { type: "ipoteci", baseParams: {}, subTypeLabels: subTypes, captchaKey: "stub-key" },
      () => {
        /* ignored */
      },
      stub
    );

    const tier2 = stub.searchCalls.filter((c) => c.tipInscriere === REJECT_IDX && c.destinatie != null);
    expect(tier2.length).toBe(DESTINATII_IPOTECI.length);
    // v2.18.0 fix: destinatie trimis ca index 1-based, NU label.
    const setIndices = new Set(tier2.map((c) => c.destinatie));
    for (let i = 1; i <= DESTINATII_IPOTECI.length; i++) {
      expect(setIndices.has(String(i))).toBe(true);
    }
  });
});
