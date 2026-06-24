// Tests for the PR-4 diff engine — pure function that converts
// (prevSnapshot, currentDosar, alertConfig) → (newSnapshot, alerts[]).
//
// Why exhaustive tests live here: the scheduler in C2 just wires this into
// SOAP + DB; correctness of WHICH alerts fire WHEN is owned entirely by this
// file. Future regressions (PJI shipped a sister project that double-fired
// termen_new on cosmetic drift — see HARDENING.md L298-339) are caught at
// commit time only if the fixture coverage here is real.

import { describe, expect, it } from "vitest";
import type { AlertConfig } from "../../../schemas/monitoring.ts";
import type { Dosar } from "../../../soap.ts";
import { computeFilterFingerprint, diffDosarSoap, type DiffSnapshotPayload } from "./dosarSoap.ts";
import { buildSedintaKey, buildSedintaKeyWithoutSolutie } from "../sedintaKey.ts";

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
function baselineSnapshot(dosar: Dosar | null, alertConfig: AlertConfig = DEFAULT_ALERT_CONFIG): DiffSnapshotPayload {
  const out = diffDosarSoap({
    prevSnapshot: null,
    currentDosar: dosar,
    alertConfig,
    now: "2026-04-27T10:00:00.000Z",
    prevSnapshotId: null,
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
      prevSnapshotId: 100,
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
      prevSnapshotId: 100,
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
      sedinte: [makeSedinta({ data: "2026-04-19", complet: "C5" }), makeSedinta({ data: "2026-05-12", complet: "C7" })],
    });
    const prev = baselineSnapshot(dosar);
    const out = diffDosarSoap({
      prevSnapshot: prev,
      currentDosar: dosar,
      alertConfig: DEFAULT_ALERT_CONFIG,
      now: NOW,
      prevSnapshotId: 100,
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
      prevSnapshotId: 100,
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
      sedinte: [makeSedinta({ data: "2026-04-19", complet: "C5" }), makeSedinta({ data: "2026-05-12", complet: "C7" })],
    });
    const prev = baselineSnapshot(before);
    const out = diffDosarSoap({
      prevSnapshot: prev,
      currentDosar: after,
      alertConfig: DEFAULT_ALERT_CONFIG,
      now: NOW,
      prevSnapshotId: 100,
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
      prevSnapshotId: 100,
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
      prevSnapshotId: 100,
    });
    const b = diffDosarSoap({
      prevSnapshot: prev,
      currentDosar: after,
      alertConfig: DEFAULT_ALERT_CONFIG,
      now: "2099-01-01T00:00:00.000Z", // different now
      // SAME prevSnapshotId — same baseline, idempotent dedup key (#4).
      prevSnapshotId: 100,
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
      prevSnapshotId: 100,
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
      sedinte: [makeSedinta({ data: "2026-04-19", complet: "C5" }), makeSedinta({ data: "2026-04-26", complet: "C5" })],
    });
    const after = makeDosar({
      sedinte: [makeSedinta({ data: "2026-05-12", complet: "C5" }), makeSedinta({ data: "2026-05-19", complet: "C5" })],
    });
    const prev = baselineSnapshot(before);
    const out = diffDosarSoap({
      prevSnapshot: prev,
      currentDosar: after,
      alertConfig: DEFAULT_ALERT_CONFIG,
      now: NOW,
      prevSnapshotId: 100,
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
      sedinte: [makeSedinta({ data: "2026-04-19", complet: "C5", solutie: "Admite apelul" })],
    });
    const prev = baselineSnapshot(before);
    const out = diffDosarSoap({
      prevSnapshot: prev,
      currentDosar: after,
      alertConfig: DEFAULT_ALERT_CONFIG,
      now: NOW,
      prevSnapshotId: 100,
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
      prevSnapshotId: 100,
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
      prevSnapshotId: 100,
    });
    expect(out.alerts).toEqual([]);
  });
});

// --- termen_dupa_solutie (postponement merge) -----------------------------

// v2.15.0 — cazul "amanare" la PortalJust: o sedinta primeste solutie
// ("amana", "amana cauza", "amana pronuntarea") iar in acelasi tick apare
// si o noua sedinta pe acelasi (stadiu, complet). Pre-v2.15.0 emiteam doua
// alerte separate (solutie_aparuta + termen_new) ceea ce dubla intrarile
// din inbox. Acum se contopesc intr-o singura alerta `termen_dupa_solutie`
// cu detaliile ambelor evenimente in `from`/`to`.
describe("diffDosarSoap — termen_dupa_solutie (postponement merge)", () => {
  it("solutie + new termen on same complet: 1 termen_dupa_solutie (NOT 2 alerts)", () => {
    const before = makeDosar({
      sedinte: [makeSedinta({ data: "2026-05-04", complet: "C5", solutie: "" })],
    });
    const after = makeDosar({
      sedinte: [
        makeSedinta({
          data: "2026-05-04",
          complet: "C5",
          solutie: "Amana cauza",
          solutieSumar: "Se amana judecarea",
          numarDocument: "DOC-123",
          dataPronuntare: "2026-05-04",
        }),
        makeSedinta({ data: "2026-05-19", complet: "C5", solutie: "" }),
      ],
    });
    const prev = baselineSnapshot(before);
    const out = diffDosarSoap({
      prevSnapshot: prev,
      currentDosar: after,
      alertConfig: DEFAULT_ALERT_CONFIG,
      now: NOW,
      prevSnapshotId: 100,
    });
    expect(out.alerts).toHaveLength(1);
    expect(out.alerts[0]?.kind).toBe("termen_dupa_solutie");
    expect(out.alerts[0]?.severity).toBe("info");
    expect(out.alerts[0]?.title).toContain("04.05.2026");
    expect(out.alerts[0]?.title).toContain("19.05.2026");
    expect(out.alerts[0]?.detail).toMatchObject({
      from: {
        data: "2026-05-04",
        complet: "C5",
        solutie: "Amana cauza",
        solutie_sumar: "Se amana judecarea",
        numar_document: "DOC-123",
        data_pronuntare: "2026-05-04",
      },
      to: {
        data: "2026-05-19",
        complet: "C5",
      },
    });
  });

  it("dedup_key is deterministic across re-runs against the same prev_snapshot", () => {
    const before = makeDosar({
      sedinte: [makeSedinta({ data: "2026-05-04", complet: "C5", solutie: "" })],
    });
    const after = makeDosar({
      sedinte: [
        makeSedinta({ data: "2026-05-04", complet: "C5", solutie: "Amana" }),
        makeSedinta({ data: "2026-05-19", complet: "C5", solutie: "" }),
      ],
    });
    const prev = baselineSnapshot(before);
    const a = diffDosarSoap({
      prevSnapshot: prev,
      currentDosar: after,
      alertConfig: DEFAULT_ALERT_CONFIG,
      now: NOW,
      prevSnapshotId: 100,
    });
    const b = diffDosarSoap({
      prevSnapshot: prev,
      currentDosar: after,
      alertConfig: DEFAULT_ALERT_CONFIG,
      now: "2099-01-01T00:00:00.000Z",
      prevSnapshotId: 100,
    });
    expect(a.alerts[0]?.kind).toBe("termen_dupa_solutie");
    expect(a.alerts[0]?.dedupKey).toBe(b.alerts[0]?.dedupKey);
    expect(a.alerts[0]?.dedupKey).toContain("termen_dupa_solutie|");
  });

  it("solutie + new termen on DIFFERENT complet: stays as 2 separate alerts (no merge)", () => {
    const before = makeDosar({
      sedinte: [makeSedinta({ data: "2026-05-04", complet: "C5", solutie: "" })],
    });
    const after = makeDosar({
      sedinte: [
        makeSedinta({ data: "2026-05-04", complet: "C5", solutie: "Admite" }),
        makeSedinta({ data: "2026-05-19", complet: "C7", solutie: "" }),
      ],
    });
    const prev = baselineSnapshot(before);
    const out = diffDosarSoap({
      prevSnapshot: prev,
      currentDosar: after,
      alertConfig: DEFAULT_ALERT_CONFIG,
      now: NOW,
      prevSnapshotId: 100,
    });
    const kinds = out.alerts.map((a) => a.kind).sort();
    expect(kinds).toEqual(["solutie_aparuta", "termen_new"]);
  });

  it("notify_on_new_termen=false: emits standalone solutie_aparuta only (no merge)", () => {
    const before = makeDosar({
      sedinte: [makeSedinta({ data: "2026-05-04", complet: "C5", solutie: "" })],
    });
    const after = makeDosar({
      sedinte: [
        makeSedinta({ data: "2026-05-04", complet: "C5", solutie: "Amana" }),
        makeSedinta({ data: "2026-05-19", complet: "C5", solutie: "" }),
      ],
    });
    const prev = baselineSnapshot(before);
    const out = diffDosarSoap({
      prevSnapshot: prev,
      currentDosar: after,
      alertConfig: { ...DEFAULT_ALERT_CONFIG, notify_on_new_termen: false },
      now: NOW,
      prevSnapshotId: 100,
    });
    expect(out.alerts.map((a) => a.kind)).toEqual(["solutie_aparuta"]);
  });

  it("notify_on_solution=false: emits termen_new only (no merge, no solutie alert)", () => {
    const before = makeDosar({
      sedinte: [makeSedinta({ data: "2026-05-04", complet: "C5", solutie: "" })],
    });
    const after = makeDosar({
      sedinte: [
        makeSedinta({ data: "2026-05-04", complet: "C5", solutie: "Amana" }),
        makeSedinta({ data: "2026-05-19", complet: "C5", solutie: "" }),
      ],
    });
    const prev = baselineSnapshot(before);
    const out = diffDosarSoap({
      prevSnapshot: prev,
      currentDosar: after,
      alertConfig: { ...DEFAULT_ALERT_CONFIG, notify_on_solution: false },
      now: NOW,
      prevSnapshotId: 100,
    });
    expect(out.alerts.map((a) => a.kind)).toEqual(["termen_new"]);
  });

  it("termen_changed pairing wins over termen_dupa_solutie when prev sedinta exists", () => {
    // Pre-tick: 04.05 (no solutie) + 12.05 (no solutie). Post-tick: 04.05
    // (solutie) + 19.05 (no solutie). The 12.05 sedinta is missing — it
    // should pair 1:1 with 19.05 as termen_changed (pure reschedule). The
    // solutie on 04.05 emits a separate solutie_aparuta (no remaining new
    // termen on the same bucket to merge with).
    const before = makeDosar({
      sedinte: [
        makeSedinta({ data: "2026-05-04", complet: "C5", solutie: "" }),
        makeSedinta({ data: "2026-05-12", complet: "C5", solutie: "" }),
      ],
    });
    const after = makeDosar({
      sedinte: [
        makeSedinta({ data: "2026-05-04", complet: "C5", solutie: "Amana" }),
        makeSedinta({ data: "2026-05-19", complet: "C5", solutie: "" }),
      ],
    });
    const prev = baselineSnapshot(before);
    const out = diffDosarSoap({
      prevSnapshot: prev,
      currentDosar: after,
      alertConfig: DEFAULT_ALERT_CONFIG,
      now: NOW,
      prevSnapshotId: 100,
    });
    const kinds = out.alerts.map((a) => a.kind).sort();
    expect(kinds).toEqual(["solutie_aparuta", "termen_changed"]);
  });

  it("idempotent re-tick: prev=post-merge snapshot, same dosar → 0 alerts", () => {
    const before = makeDosar({
      sedinte: [makeSedinta({ data: "2026-05-04", complet: "C5", solutie: "" })],
    });
    const after = makeDosar({
      sedinte: [
        makeSedinta({ data: "2026-05-04", complet: "C5", solutie: "Amana" }),
        makeSedinta({ data: "2026-05-19", complet: "C5", solutie: "" }),
      ],
    });
    const prev = baselineSnapshot(before);
    const tick1 = diffDosarSoap({
      prevSnapshot: prev,
      currentDosar: after,
      alertConfig: DEFAULT_ALERT_CONFIG,
      now: NOW,
      prevSnapshotId: 100,
    });
    expect(tick1.alerts).toHaveLength(1);
    // Next tick observes the same Dosar — diff against tick1's snapshot must
    // be silent. Without it, scheduler retries / cron replays would re-emit.
    const tick2 = diffDosarSoap({
      prevSnapshot: tick1.newSnapshot,
      currentDosar: after,
      alertConfig: DEFAULT_ALERT_CONFIG,
      now: "2026-05-05T10:00:00.000Z",
      prevSnapshotId: 200,
    });
    expect(tick2.alerts).toEqual([]);
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
      prevSnapshotId: 100,
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
      prevSnapshotId: 100,
    });
    const after2 = diffDosarSoap({
      prevSnapshot: after1.newSnapshot,
      currentDosar: null,
      alertConfig: DEFAULT_ALERT_CONFIG,
      now: "2026-04-29T10:00:00.000Z",
      prevSnapshotId: 200,
    });
    expect(after2.alerts).toEqual([]);
  });

  it("reappearance: prev.lastDosarPresent=false → present fires dosar_new only (no termen_new flood)", () => {
    const dosar = makeDosar({
      sedinte: [makeSedinta({ data: "2026-04-19", complet: "C5" }), makeSedinta({ data: "2026-05-12", complet: "C7" })],
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
      prevSnapshotId: 100,
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
      prevSnapshotId: 100,
    });
    expect(out.alerts).toEqual([]);
    // Snapshot still updates so we don't re-fire on next tick.
    expect(out.newSnapshot.lastDosarPresent).toBe(false);
  });

  // Constatare adversiala #4: ancora dedup pentru tranzitii e prev_snapshot_id
  // (stabil pe acelasi baseline), nu runId (unic per executie). Doua diff-uri
  // contra aceluiasi prev (replay / manual-trigger / retry tranzitoriu) trebuie
  // sa produca aceeasi cheie dedup ca insertAlert sa absoarba duplicatul.
  it("dosar_disappeared dedup key is stable across re-runs against the same prev_snapshot", () => {
    const dosar = makeDosar({ sedinte: [makeSedinta({ data: "2026-04-19" })] });
    const prev = baselineSnapshot(dosar);
    const a = diffDosarSoap({
      prevSnapshot: prev,
      currentDosar: null,
      alertConfig: DEFAULT_ALERT_CONFIG,
      now: NOW,
      prevSnapshotId: 100,
    });
    const b = diffDosarSoap({
      prevSnapshot: prev,
      currentDosar: null,
      alertConfig: DEFAULT_ALERT_CONFIG,
      now: "2099-01-01T00:00:00.000Z",
      prevSnapshotId: 100,
    });
    expect(a.alerts[0]?.kind).toBe("dosar_disappeared");
    expect(b.alerts[0]?.kind).toBe("dosar_disappeared");
    expect(a.alerts[0]?.dedupKey).toBe(b.alerts[0]?.dedupKey);
    expect(a.alerts[0]?.dedupKey).toBe("dosar_disappeared|s100");
  });

  it("dosar_new dedup key is stable across re-runs against the same prev_snapshot", () => {
    const disappeared: DiffSnapshotPayload = {
      sedintaKeys: [],
      lastDosarPresent: false,
      sedinteWithSolution: {},
      filterFingerprint: computeFilterFingerprint(DEFAULT_ALERT_CONFIG),
    };
    const dosar = makeDosar({ sedinte: [makeSedinta({ data: "2026-04-19" })] });
    const a = diffDosarSoap({
      prevSnapshot: disappeared,
      currentDosar: dosar,
      alertConfig: DEFAULT_ALERT_CONFIG,
      now: NOW,
      prevSnapshotId: 42,
    });
    const b = diffDosarSoap({
      prevSnapshot: disappeared,
      currentDosar: dosar,
      alertConfig: DEFAULT_ALERT_CONFIG,
      now: "2099-01-01T00:00:00.000Z",
      prevSnapshotId: 42,
    });
    expect(a.alerts[0]?.dedupKey).toBe(b.alerts[0]?.dedupKey);
    expect(a.alerts[0]?.dedupKey).toBe("dosar_new|s42");
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
      sedinte: [makeSedinta({ data: "2026-04-19", complet: "C5" }), makeSedinta({ data: "2026-05-12", complet: "C7" })],
    });
    const out = diffDosarSoap({
      prevSnapshot: prev,
      currentDosar: after,
      alertConfig: { ...DEFAULT_ALERT_CONFIG, stadii: ["Apel"] },
      now: NOW,
      prevSnapshotId: 100,
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
      prevSnapshotId: 100,
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
      prevSnapshotId: 100,
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
      prevSnapshotId: 100,
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
      prevSnapshotId: 100,
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
      prevSnapshotId: 100,
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
      prevSnapshotId: 100,
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
