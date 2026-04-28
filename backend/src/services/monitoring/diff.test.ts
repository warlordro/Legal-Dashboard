// Tests for the PR-4 diff engine — pure function that converts
// (prevSnapshot, currentDosar, alertConfig) → (newSnapshot, alerts[]).
//
// Why exhaustive tests live here: the scheduler in C2 just wires this into
// SOAP + DB; correctness of WHICH alerts fire WHEN is owned entirely by this
// file. Future regressions (PJI shipped a sister project that double-fired
// termen_new on cosmetic drift — see HARDENING.md L298-339) are caught at
// commit time only if the fixture coverage here is real.

import { describe, expect, it } from "vitest";
import type { AlertConfig } from "../../schemas/monitoring.ts";
import type { Dosar } from "../../soap.ts";
import {
  computeFilterFingerprint,
  diffDosarSoap,
  type DiffSnapshotPayload,
} from "./diff.ts";
import { buildSedintaKey, buildSedintaKeyWithoutSolutie } from "./sedintaKey.ts";

// --- fixture helpers ------------------------------------------------------

const DEFAULT_ALERT_CONFIG: AlertConfig = {
  notify_days_before: [14, 7, 3, 1],
  notify_on_new_termen: true,
  notify_on_solution: true,
  notify_on_dosar_disappeared: true,
};

function makeDosar(overrides: Partial<Dosar> = {}): Dosar {
  return {
    numar: "1234/180/2024",
    data: "2026-01-15",
    institutie: "Judecatoria Bacau",
    departament: "",
    categorieCaz: "Civil",
    stadiuProcesual: "Apel",
    obiect: "obiect generic",
    parti: [],
    sedinte: [],
    ...overrides,
  };
}

function makeSedinta(overrides: Partial<Dosar["sedinte"][number]> = {}): Dosar["sedinte"][number] {
  return {
    complet: "C5",
    data: "2026-04-19",
    ora: "10:00",
    solutie: "",
    solutieSumar: "",
    documentSedinta: "",
    numarDocument: "",
    dataPronuntare: "",
    ...overrides,
  };
}

// Build a "post-baseline" snapshot — what diff would have written after a
// clean first observation of `dosar`. Lets later tests skip an explicit
// first-tick step.
function baselineSnapshot(
  dosar: Dosar | null,
  alertConfig: AlertConfig = DEFAULT_ALERT_CONFIG,
): DiffSnapshotPayload {
  const out = diffDosarSoap({
    prevSnapshot: null,
    currentDosar: dosar,
    alertConfig,
    now: "2026-04-27T10:00:00.000Z",
  });
  return out.newSnapshot;
}

const NOW = "2026-04-28T10:00:00.000Z";

// --- baseline (no prev snapshot) ------------------------------------------

describe("diffDosarSoap — first run / baseline", () => {
  it("prev=null + dosar absent: snapshot lastDosarPresent=false, no alerts", () => {
    const out = diffDosarSoap({
      prevSnapshot: null,
      currentDosar: null,
      alertConfig: DEFAULT_ALERT_CONFIG,
      now: NOW,
    });
    expect(out.alerts).toEqual([]);
    expect(out.newSnapshot.lastDosarPresent).toBe(false);
    expect(out.newSnapshot.sedintaKeys).toEqual([]);
    expect(out.resetReason).toBe(null);
  });

  it("prev=null + dosar present: catalog all sedinte, no alerts (no flood)", () => {
    const dosar = makeDosar({
      sedinte: [
        makeSedinta({ data: "2026-04-19", ora: "10:00", complet: "C5" }),
        makeSedinta({ data: "2026-05-12", ora: "11:00", complet: "C7" }),
      ],
    });
    const out = diffDosarSoap({
      prevSnapshot: null,
      currentDosar: dosar,
      alertConfig: DEFAULT_ALERT_CONFIG,
      now: NOW,
    });
    expect(out.alerts).toEqual([]);
    expect(out.newSnapshot.lastDosarPresent).toBe(true);
    expect(out.newSnapshot.sedintaKeys).toHaveLength(2);
    expect(out.resetReason).toBe(null);
  });
});

// --- stable case (no changes) ---------------------------------------------

describe("diffDosarSoap — stable observation", () => {
  it("same sedinte, same solutii: zero alerts", () => {
    const dosar = makeDosar({
      sedinte: [
        makeSedinta({ data: "2026-04-19", complet: "C5" }),
        makeSedinta({ data: "2026-05-12", complet: "C7" }),
      ],
    });
    const prev = baselineSnapshot(dosar);
    const out = diffDosarSoap({
      prevSnapshot: prev,
      currentDosar: dosar,
      alertConfig: DEFAULT_ALERT_CONFIG,
      now: NOW,
    });
    expect(out.alerts).toEqual([]);
    expect(out.newSnapshot.sedintaKeys).toEqual(prev.sedintaKeys);
  });

  it("cosmetic drift in ora ('10:0' vs '10:00') doesn't trigger alerts", () => {
    const dosar1 = makeDosar({ sedinte: [makeSedinta({ ora: "10:0" })] });
    const dosar2 = makeDosar({ sedinte: [makeSedinta({ ora: "10:00" })] });
    const prev = baselineSnapshot(dosar1);
    const out = diffDosarSoap({
      prevSnapshot: prev,
      currentDosar: dosar2,
      alertConfig: DEFAULT_ALERT_CONFIG,
      now: NOW,
    });
    expect(out.alerts).toEqual([]);
  });
});

// --- termen_new -----------------------------------------------------------

describe("diffDosarSoap — termen_new", () => {
  it("new sedinta added: 1 termen_new alert", () => {
    const before = makeDosar({
      sedinte: [makeSedinta({ data: "2026-04-19", complet: "C5" })],
    });
    const after = makeDosar({
      sedinte: [
        makeSedinta({ data: "2026-04-19", complet: "C5" }),
        makeSedinta({ data: "2026-05-12", complet: "C7" }),
      ],
    });
    const prev = baselineSnapshot(before);
    const out = diffDosarSoap({
      prevSnapshot: prev,
      currentDosar: after,
      alertConfig: DEFAULT_ALERT_CONFIG,
      now: NOW,
    });
    expect(out.alerts).toHaveLength(1);
    expect(out.alerts[0]?.kind).toBe("termen_new");
    expect(out.alerts[0]?.dedupKey).toContain("termen_new");
  });

  it("notify_on_new_termen=false suppresses termen_new", () => {
    const before = makeDosar({ sedinte: [] });
    const after = makeDosar({ sedinte: [makeSedinta()] });
    const prev = baselineSnapshot(before);
    const out = diffDosarSoap({
      prevSnapshot: prev,
      currentDosar: after,
      alertConfig: { ...DEFAULT_ALERT_CONFIG, notify_on_new_termen: false },
      now: NOW,
    });
    expect(out.alerts).toEqual([]);
    expect(out.newSnapshot.sedintaKeys).toHaveLength(1);
  });

  it("dedup_key is deterministic across re-runs", () => {
    const before = makeDosar({ sedinte: [] });
    const after = makeDosar({ sedinte: [makeSedinta({ data: "2026-04-19" })] });
    const prev = baselineSnapshot(before);
    const a = diffDosarSoap({
      prevSnapshot: prev,
      currentDosar: after,
      alertConfig: DEFAULT_ALERT_CONFIG,
      now: NOW,
    });
    const b = diffDosarSoap({
      prevSnapshot: prev,
      currentDosar: after,
      alertConfig: DEFAULT_ALERT_CONFIG,
      now: "2099-01-01T00:00:00.000Z", // different now
    });
    expect(a.alerts[0]?.dedupKey).toBe(b.alerts[0]?.dedupKey);
  });
});

// --- termen_changed -------------------------------------------------------

describe("diffDosarSoap — termen_changed", () => {
  it("same (stadiu, complet) on different data: 1 termen_changed (NOT termen_new)", () => {
    const before = makeDosar({
      sedinte: [makeSedinta({ data: "2026-04-19", complet: "C5" })],
    });
    const after = makeDosar({
      sedinte: [makeSedinta({ data: "2026-05-12", complet: "C5" })],
    });
    const prev = baselineSnapshot(before);
    const out = diffDosarSoap({
      prevSnapshot: prev,
      currentDosar: after,
      alertConfig: DEFAULT_ALERT_CONFIG,
      now: NOW,
    });
    expect(out.alerts).toHaveLength(1);
    expect(out.alerts[0]?.kind).toBe("termen_changed");
    expect(out.alerts[0]?.detail).toMatchObject({
      from: { data: "2026-04-19", complet: "C5" },
      to: { data: "2026-05-12", complet: "C5" },
    });
  });

  it("ambiguous pairing (multiple same-complet sedinte change): falls back to termen_new", () => {
    const before = makeDosar({
      sedinte: [
        makeSedinta({ data: "2026-04-19", complet: "C5" }),
        makeSedinta({ data: "2026-04-26", complet: "C5" }),
      ],
    });
    const after = makeDosar({
      sedinte: [
        makeSedinta({ data: "2026-05-12", complet: "C5" }),
        makeSedinta({ data: "2026-05-19", complet: "C5" }),
      ],
    });
    const prev = baselineSnapshot(before);
    const out = diffDosarSoap({
      prevSnapshot: prev,
      currentDosar: after,
      alertConfig: DEFAULT_ALERT_CONFIG,
      now: NOW,
    });
    expect(out.alerts.every((a) => a.kind === "termen_new")).toBe(true);
    expect(out.alerts).toHaveLength(2);
  });
});

// --- solutie_aparuta ------------------------------------------------------

describe("diffDosarSoap — solutie_aparuta", () => {
  it("same sedinta, solutie went from empty to non-empty: 1 solutie_aparuta", () => {
    const before = makeDosar({
      sedinte: [makeSedinta({ data: "2026-04-19", complet: "C5", solutie: "" })],
    });
    const after = makeDosar({
      sedinte: [
        makeSedinta({ data: "2026-04-19", complet: "C5", solutie: "Admite apelul" }),
      ],
    });
    const prev = baselineSnapshot(before);
    const out = diffDosarSoap({
      prevSnapshot: prev,
      currentDosar: after,
      alertConfig: DEFAULT_ALERT_CONFIG,
      now: NOW,
    });
    expect(out.alerts).toHaveLength(1);
    expect(out.alerts[0]?.kind).toBe("solutie_aparuta");
    // dedup keys against keyWithoutSolutie so re-emitting the same solutie is a no-op
    const expectedSubKey = buildSedintaKeyWithoutSolutie({
      stadiuProcesual: "Apel",
      data: "2026-04-19",
      ora: "10:00",
      complet: "C5",
      solutie: "",
    });
    expect(out.alerts[0]?.dedupKey).toContain(expectedSubKey);
  });

  it("does not also fire termen_new for the same sedinta (would double-alert)", () => {
    const before = makeDosar({
      sedinte: [makeSedinta({ data: "2026-04-19", complet: "C5", solutie: "" })],
    });
    const after = makeDosar({
      sedinte: [makeSedinta({ data: "2026-04-19", complet: "C5", solutie: "Admite" })],
    });
    const prev = baselineSnapshot(before);
    const out = diffDosarSoap({
      prevSnapshot: prev,
      currentDosar: after,
      alertConfig: DEFAULT_ALERT_CONFIG,
      now: NOW,
    });
    const kinds = out.alerts.map((a) => a.kind);
    expect(kinds).toEqual(["solutie_aparuta"]);
  });

  it("notify_on_solution=false suppresses solutie_aparuta", () => {
    const before = makeDosar({ sedinte: [makeSedinta({ solutie: "" })] });
    const after = makeDosar({ sedinte: [makeSedinta({ solutie: "Admite" })] });
    const prev = baselineSnapshot(before);
    const out = diffDosarSoap({
      prevSnapshot: prev,
      currentDosar: after,
      alertConfig: { ...DEFAULT_ALERT_CONFIG, notify_on_solution: false },
      now: NOW,
    });
    expect(out.alerts).toEqual([]);
  });
});

// --- dosar_disappeared / dosar_new (re-appearance) ------------------------

describe("diffDosarSoap — dosar_disappeared + reappearance", () => {
  it("present → null: 1 dosar_disappeared, lastDosarPresent flips to false", () => {
    const dosar = makeDosar({
      sedinte: [makeSedinta({ data: "2026-04-19", complet: "C5" })],
    });
    const prev = baselineSnapshot(dosar);
    const out = diffDosarSoap({
      prevSnapshot: prev,
      currentDosar: null,
      alertConfig: DEFAULT_ALERT_CONFIG,
      now: NOW,
    });
    expect(out.alerts).toHaveLength(1);
    expect(out.alerts[0]?.kind).toBe("dosar_disappeared");
    expect(out.newSnapshot.lastDosarPresent).toBe(false);
    expect(out.newSnapshot.sedintaKeys).toEqual([]);
  });

  it("dosar still missing on next tick: no duplicate alert", () => {
    const dosar = makeDosar({ sedinte: [makeSedinta()] });
    const after1 = diffDosarSoap({
      prevSnapshot: baselineSnapshot(dosar),
      currentDosar: null,
      alertConfig: DEFAULT_ALERT_CONFIG,
      now: NOW,
    });
    const after2 = diffDosarSoap({
      prevSnapshot: after1.newSnapshot,
      currentDosar: null,
      alertConfig: DEFAULT_ALERT_CONFIG,
      now: "2026-04-29T10:00:00.000Z",
    });
    expect(after2.alerts).toEqual([]);
  });

  it("reappearance: prev.lastDosarPresent=false → present fires dosar_new only (no termen_new flood)", () => {
    const dosar = makeDosar({
      sedinte: [
        makeSedinta({ data: "2026-04-19", complet: "C5" }),
        makeSedinta({ data: "2026-05-12", complet: "C7" }),
      ],
    });
    // After dosar_disappeared, lastDosarPresent=false but we still have prior sedintaKeys.
    const disappeared: DiffSnapshotPayload = {
      sedintaKeys: [],
      lastDosarPresent: false,
      sedinteWithSolution: {},
      filterFingerprint: computeFilterFingerprint(DEFAULT_ALERT_CONFIG),
    };
    const out = diffDosarSoap({
      prevSnapshot: disappeared,
      currentDosar: dosar,
      alertConfig: DEFAULT_ALERT_CONFIG,
      now: NOW,
    });
    expect(out.alerts.map((a) => a.kind)).toEqual(["dosar_new"]);
    expect(out.newSnapshot.lastDosarPresent).toBe(true);
    expect(out.newSnapshot.sedintaKeys).toHaveLength(2);
  });

  it("notify_on_dosar_disappeared=false suppresses dosar_disappeared", () => {
    const dosar = makeDosar({ sedinte: [makeSedinta()] });
    const out = diffDosarSoap({
      prevSnapshot: baselineSnapshot(dosar),
      currentDosar: null,
      alertConfig: { ...DEFAULT_ALERT_CONFIG, notify_on_dosar_disappeared: false },
      now: NOW,
    });
    expect(out.alerts).toEqual([]);
    // Snapshot still updates so we don't re-fire on next tick.
    expect(out.newSnapshot.lastDosarPresent).toBe(false);
  });
});

// --- filter changed reset -------------------------------------------------

describe("diffDosarSoap — filter changed reset", () => {
  it("changing alertConfig.stadii rebaselines without firing alerts", () => {
    const dosar = makeDosar({
      sedinte: [makeSedinta({ data: "2026-04-19", complet: "C5" })],
    });
    const prev = baselineSnapshot(dosar);
    const after = makeDosar({
      sedinte: [
        makeSedinta({ data: "2026-04-19", complet: "C5" }),
        makeSedinta({ data: "2026-05-12", complet: "C7" }),
      ],
    });
    const out = diffDosarSoap({
      prevSnapshot: prev,
      currentDosar: after,
      alertConfig: { ...DEFAULT_ALERT_CONFIG, stadii: ["Apel"] },
      now: NOW,
    });
    expect(out.alerts).toEqual([]);
    expect(out.resetReason).toBe("filter_changed");
    expect(out.newSnapshot.sedintaKeys).toHaveLength(2);
  });

  it("changing categorii also resets", () => {
    const dosar = makeDosar({ sedinte: [makeSedinta()] });
    const prev = baselineSnapshot(dosar);
    const out = diffDosarSoap({
      prevSnapshot: prev,
      currentDosar: dosar,
      alertConfig: { ...DEFAULT_ALERT_CONFIG, categorii: ["Civil"] },
      now: NOW,
    });
    expect(out.resetReason).toBe("filter_changed");
    expect(out.alerts).toEqual([]);
  });

  it("filter unchanged: resetReason=null", () => {
    const dosar = makeDosar({ sedinte: [makeSedinta()] });
    const prev = baselineSnapshot(dosar);
    const out = diffDosarSoap({
      prevSnapshot: prev,
      currentDosar: dosar,
      alertConfig: DEFAULT_ALERT_CONFIG,
      now: NOW,
    });
    expect(out.resetReason).toBe(null);
  });
});

// --- pre-diff filter (stadii/categorii) -----------------------------------

describe("diffDosarSoap — pre-diff filter (dosar excluded by alertConfig)", () => {
  it("alertConfig.stadii excludes dosar.stadiuProcesual: snapshot lastDosarPresent=false", () => {
    const dosar = makeDosar({
      stadiuProcesual: "Fond",
      sedinte: [makeSedinta()],
    });
    const out = diffDosarSoap({
      prevSnapshot: null,
      currentDosar: dosar,
      alertConfig: { ...DEFAULT_ALERT_CONFIG, stadii: ["Apel"] },
      now: NOW,
    });
    expect(out.newSnapshot.lastDosarPresent).toBe(false);
    expect(out.newSnapshot.sedintaKeys).toEqual([]);
    expect(out.alerts).toEqual([]);
  });

  it("alertConfig.categorii excludes dosar.categorieCaz: snapshot lastDosarPresent=false", () => {
    const dosar = makeDosar({
      categorieCaz: "Penal",
      sedinte: [makeSedinta()],
    });
    const out = diffDosarSoap({
      prevSnapshot: null,
      currentDosar: dosar,
      alertConfig: { ...DEFAULT_ALERT_CONFIG, categorii: ["Civil"] },
      now: NOW,
    });
    expect(out.newSnapshot.lastDosarPresent).toBe(false);
  });

  it("filter normalization: case + diacritics in stadii match dosar.stadiuProcesual", () => {
    const dosar = makeDosar({
      stadiuProcesual: "Apel",
      sedinte: [makeSedinta()],
    });
    const out = diffDosarSoap({
      prevSnapshot: null,
      currentDosar: dosar,
      alertConfig: { ...DEFAULT_ALERT_CONFIG, stadii: ["APEL"] },
      now: NOW,
    });
    expect(out.newSnapshot.lastDosarPresent).toBe(true);
  });
});

// --- snapshot integrity ---------------------------------------------------

describe("diffDosarSoap — snapshot shape", () => {
  it("sedintaKeys + sedinteWithSolution are kept in sync", () => {
    const dosar = makeDosar({
      sedinte: [
        makeSedinta({ data: "2026-04-19", complet: "C5", solutie: "" }),
        makeSedinta({ data: "2026-05-12", complet: "C7", solutie: "Admite" }),
      ],
    });
    const out = diffDosarSoap({
      prevSnapshot: null,
      currentDosar: dosar,
      alertConfig: DEFAULT_ALERT_CONFIG,
      now: NOW,
    });
    const k1 = buildSedintaKey({
      stadiuProcesual: "Apel",
      data: "2026-04-19",
      ora: "10:00",
      complet: "C5",
      solutie: "",
    });
    const k2 = buildSedintaKey({
      stadiuProcesual: "Apel",
      data: "2026-05-12",
      ora: "10:00",
      complet: "C7",
      solutie: "Admite",
    });
    expect(out.newSnapshot.sedintaKeys).toEqual(expect.arrayContaining([k1, k2]));
    const sub1 = buildSedintaKeyWithoutSolutie({
      stadiuProcesual: "Apel",
      data: "2026-04-19",
      ora: "10:00",
      complet: "C5",
      solutie: "",
    });
    const sub2 = buildSedintaKeyWithoutSolutie({
      stadiuProcesual: "Apel",
      data: "2026-05-12",
      ora: "10:00",
      complet: "C7",
      solutie: "Admite",
    });
    expect(out.newSnapshot.sedinteWithSolution[sub1]).toBe(false);
    expect(out.newSnapshot.sedinteWithSolution[sub2]).toBe(true);
  });

  it("filterFingerprint is stable across calls with same alertConfig fields", () => {
    const a = computeFilterFingerprint({ ...DEFAULT_ALERT_CONFIG, stadii: ["Apel", "Fond"] });
    const b = computeFilterFingerprint({ ...DEFAULT_ALERT_CONFIG, stadii: ["Fond", "Apel"] });
    // Order-independent — two equivalent filter sets must hash identically
    expect(a).toBe(b);
  });

  it("filterFingerprint differs when stadii contents differ", () => {
    const a = computeFilterFingerprint({ ...DEFAULT_ALERT_CONFIG, stadii: ["Apel"] });
    const b = computeFilterFingerprint({ ...DEFAULT_ALERT_CONFIG, stadii: ["Fond"] });
    expect(a).not.toBe(b);
  });

  it("filterFingerprint ignores notify_* toggles + email_to + notify_days_before", () => {
    const a = computeFilterFingerprint(DEFAULT_ALERT_CONFIG);
    const b = computeFilterFingerprint({
      ...DEFAULT_ALERT_CONFIG,
      notify_on_new_termen: false,
      notify_on_solution: false,
      notify_on_dosar_disappeared: false,
      notify_days_before: [30, 1],
      email_to: "x@y.com",
    });
    // Only stadii + categorii participate in fingerprint — toggles must not
    // trigger a snapshot reset.
    expect(a).toBe(b);
  });
});
