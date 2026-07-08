import { afterEach, describe, expect, it, vi } from "vitest";
import type { AlertConfig } from "../../../schemas/monitoring.ts";
import type { Dosar } from "../../../soap.ts";
import {
  buildNameSoapSnapshot,
  diffNameSoap,
  type NameSoapPrevSnapshot,
  type NameSoapSnapshotDosar,
  type NameSoapSnapshotPayload,
  type NameSoapSnapshotPayloadV1,
} from "./nameSoap.ts";

const DEFAULT_ALERT_CONFIG: AlertConfig = {
  notify_days_before: [14, 7, 3, 1],
  notify_on_new_termen: true,
  notify_on_solution: true,
  notify_on_dosar_disappeared: true,
};

const NOW = "2026-05-18T10:00:00.000Z";
const JOB_CREATED_AT = "2026-01-01T00:00:00.000Z";

afterEach(() => {
  vi.restoreAllMocks();
});

function snapshot(dosare: NameSoapSnapshotDosar[]): NameSoapSnapshotPayload {
  return {
    version: 2,
    fetched_at: NOW,
    dosare,
  };
}

function snapshotV1(dosare: NameSoapSnapshotDosar[]): NameSoapSnapshotPayloadV1 {
  return {
    version: 1,
    fetched_at: NOW,
    dosare,
  };
}

function snapshotDosar(numar: string, latestSedintaAt: string | null): NameSoapSnapshotDosar {
  return {
    numar,
    stadiu: "fond",
    categorie: "civil",
    instanta: "Judecatoria Test",
    latest_sedinta_at: latestSedintaAt,
  };
}

function runDiff(input: {
  prevSnapshot?: NameSoapPrevSnapshot | null;
  current: NameSoapSnapshotDosar;
  jobCreatedAt?: string;
}) {
  return diffNameSoap({
    prevSnapshot: input.prevSnapshot ?? null,
    currentSnapshot: snapshot([input.current]),
    alertConfig: DEFAULT_ALERT_CONFIG,
    now: NOW,
    jobCreatedAt: input.jobCreatedAt ?? JOB_CREATED_AT,
    prevSnapshotId: input.prevSnapshot ? 1 : null,
  });
}

function makeDosar(sedinte: Dosar["sedinte"]): Dosar {
  return {
    numar: "100/325/2018",
    data: "",
    institutie: "Judecatoria Test",
    departament: "",
    categorieCaz: "civil",
    stadiuProcesual: "fond",
    obiect: "",
    parti: [],
    sedinte,
  };
}

describe("buildNameSoapSnapshot latest_sedinta_at", () => {
  it("stores max(data, dataPronuntare) and ignores empty/non-string candidates", () => {
    const out = buildNameSoapSnapshot(
      [
        makeDosar([
          { data: undefined, dataPronuntare: undefined } as unknown as Dosar["sedinte"][number],
          {
            complet: "C1",
            data: "",
            ora: "",
            solutie: "",
            solutieSumar: "",
            documentSedinta: "",
            numarDocument: "",
            dataPronuntare: "2026-05-10",
          },
          {
            complet: "C2",
            data: "2026-05-11",
            ora: "",
            solutie: "",
            solutieSumar: "",
            documentSedinta: "",
            numarDocument: "",
            dataPronuntare: "2026-05-09",
          },
        ]),
      ],
      NOW
    );

    expect(out.dosare[0]?.latest_sedinta_at).toBe("2026-05-11");
  });

  it("stores null when no sedinta date exists", () => {
    const out = buildNameSoapSnapshot(
      [makeDosar([{ data: undefined, dataPronuntare: undefined } as unknown as Dosar["sedinte"][number]])],
      NOW
    );

    expect(out.dosare[0]?.latest_sedinta_at).toBeNull();
  });

  it("stores null when sedinte array is empty", () => {
    const out = buildNameSoapSnapshot([makeDosar([])], NOW);

    expect(out.dosare[0]?.latest_sedinta_at).toBeNull();
  });

  it("ignores unparseable date strings without throwing and picks the latest parseable one", () => {
    const out = buildNameSoapSnapshot(
      [
        makeDosar([
          {
            complet: "C1",
            data: "not-a-date",
            ora: "",
            solutie: "",
            solutieSumar: "",
            documentSedinta: "",
            numarDocument: "",
            dataPronuntare: "2026-05-10",
          },
          {
            complet: "C2",
            data: "2026-05-12",
            ora: "",
            solutie: "",
            solutieSumar: "",
            documentSedinta: "",
            numarDocument: "",
            dataPronuntare: "still-not-a-date",
          },
        ]),
      ],
      NOW
    );

    expect(out.dosare[0]?.latest_sedinta_at).toBe("2026-05-12");
  });
});

describe("diffNameSoap isHistoricNoise + dosar_new suppression", () => {
  it("suppresses first-tick old dosar without sedinte", () => {
    const out = runDiff({ current: snapshotDosar("100/325/2018", null) });

    expect(out.alerts).toEqual([]);
  });

  it("suppresses first-tick old dosar whose latest sedinta is before job creation", () => {
    const out = runDiff({ current: snapshotDosar("100/325/2018", "2018-05-10") });

    expect(out.alerts).toEqual([]);
  });

  it("emits first-tick old dosar when it has activity after job creation", () => {
    const out = runDiff({ current: snapshotDosar("100/325/2018", "2026-05-15") });

    expect(out.alerts.map((a) => a.kind)).toEqual(["dosar_new"]);
  });

  it("emits first-tick current-year dosar even without sedinte", () => {
    const out = runDiff({ current: snapshotDosar("100/325/2026", null) });

    expect(out.alerts.map((a) => a.kind)).toEqual(["dosar_new"]);
  });

  it("does not suppress when dosarYear equals jobYear (boundary case)", () => {
    // Job creat in 2026, dosar din 2026: NICIODATA suprimat, indiferent de sedinte.
    const out = runDiff({
      current: snapshotDosar("500/325/2026", null),
      jobCreatedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(out.alerts.map((a) => a.kind)).toEqual(["dosar_new"]);
  });

  it("applies the same suppression when prev exists but the current dosar is new", () => {
    const out = runDiff({
      prevSnapshot: snapshot([snapshotDosar("200/325/2026", null)]),
      current: snapshotDosar("100/325/2018", null),
    });

    expect(out.alerts.filter((alert) => alert.kind === "dosar_new")).toEqual([]);
  });

  it("fails open for non-standard dosar numbers", () => {
    const out = runDiff({ current: snapshotDosar("no-format-string", null) });

    expect(out.alerts.map((a) => a.kind)).toEqual(["dosar_new"]);
  });

  it("treats empty latest_sedinta_at as historic absence", () => {
    const out = runDiff({ current: snapshotDosar("100/325/2018", "") });

    expect(out.alerts).toEqual([]);
  });

  it("logs and fails open when jobCreatedAt is invalid", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const out = runDiff({ current: snapshotDosar("100/325/2018", null), jobCreatedAt: "invalid-date" });

    expect(out.alerts.map((a) => a.kind)).toEqual(["dosar_new"]);
    expect(errorSpy).toHaveBeenCalledWith(
      "[diffNameSoap.isHistoricNoise] invalid date input",
      expect.objectContaining({
        dosar_numar: "100/325/2018",
        job_created_at: "invalid-date",
      })
    );
  });

  it("logs and fails open when latest_sedinta_at is invalid", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const out = runDiff({ current: snapshotDosar("100/325/2018", "not-a-date") });

    expect(out.alerts.map((a) => a.kind)).toEqual(["dosar_new"]);
    expect(errorSpy).toHaveBeenCalledWith(
      "[diffNameSoap.isHistoricNoise] invalid date input",
      expect.objectContaining({
        dosar_numar: "100/325/2018",
        job_created_at: JOB_CREATED_AT,
        latest_sedinta_at: "not-a-date",
      })
    );
  });
});

describe("diffNameSoap dosar_disappeared pre-v2 safety belt", () => {
  it("skips dosar_disappeared when prev snapshot is pre-v2 (post-upgrade burst guard)", () => {
    const prev = snapshotV1([snapshotDosar("100/325/2018", null)]);
    const out = diffNameSoap({
      prevSnapshot: prev,
      currentSnapshot: snapshot([]),
      alertConfig: DEFAULT_ALERT_CONFIG,
      now: NOW,
      jobCreatedAt: JOB_CREATED_AT,
      prevSnapshotId: 1,
    });
    expect(out.alerts).toEqual([]);
  });

  it("emits dosar_disappeared when prev snapshot is v2 (post-baseline)", () => {
    const prev = snapshot([snapshotDosar("100/325/2026", null)]);
    const out = diffNameSoap({
      prevSnapshot: prev,
      currentSnapshot: snapshot([]),
      alertConfig: DEFAULT_ALERT_CONFIG,
      now: NOW,
      jobCreatedAt: JOB_CREATED_AT,
      prevSnapshotId: 1,
    });
    expect(out.alerts.map((a) => a.kind)).toEqual(["dosar_disappeared"]);
  });
});

describe("diffNameSoap partial-failure carry-forward (v2.37.1, review cluster 1)", () => {
  it("nu emite dosar_disappeared pentru dosare la institutii picate si le pastreaza in snapshot", () => {
    // Productie: failedInstitutii contine CODUL enum PortalJust (target.institutie,
    // ex. TribunalulBUCURESTI fara spatiu) iar instanta din dosarul intors e NUMELE
    // afisat (Tribunalul Bucuresti cu spatiu). Cele doua vocabulare diverg — fixul
    // normalizeaza ambele parti la acelasi label canonic inainte de comparatie.
    const prevDosar: NameSoapSnapshotDosar = {
      numar: "1/3/2026",
      stadiu: "fond",
      categorie: "civil",
      instanta: "Tribunalul Bucuresti",
      latest_sedinta_at: null,
    };
    const out = diffNameSoap({
      prevSnapshot: snapshot([prevDosar]),
      currentSnapshot: snapshot([]),
      alertConfig: DEFAULT_ALERT_CONFIG,
      now: NOW,
      jobCreatedAt: JOB_CREATED_AT,
      prevSnapshotId: 7,
      failedInstitutii: ["TribunalulBUCURESTI"],
    });
    expect(out.alerts).toHaveLength(0);
    expect(out.newSnapshot.dosare.map((d) => d.numar)).toContain("1/3/2026");
  });

  it("emite dosar_disappeared normal cand institutia dosarului NU e in lista picata", () => {
    const prevDosar: NameSoapSnapshotDosar = {
      numar: "2/3/2026",
      stadiu: "fond",
      categorie: "civil",
      instanta: "Tribunalul Iasi",
      latest_sedinta_at: null,
    };
    const out = diffNameSoap({
      prevSnapshot: snapshot([prevDosar]),
      currentSnapshot: snapshot([]),
      alertConfig: DEFAULT_ALERT_CONFIG,
      now: NOW,
      jobCreatedAt: JOB_CREATED_AT,
      prevSnapshotId: 7,
      failedInstitutii: ["TribunalulBUCURESTI"],
    });
    expect(out.alerts.map((a) => a.kind)).toEqual(["dosar_disappeared"]);
    expect(out.newSnapshot.dosare).toHaveLength(0);
  });
});

describe("diffNameSoap dedup anchor per baseline (v2.37.1, review cluster 1)", () => {
  function dosarCu(stadiu: string): NameSoapSnapshotDosar {
    return { numar: "9/9/2026", stadiu, categorie: "civil", instanta: "Judecatoria Test", latest_sedinta_at: null };
  }

  it("a doua tranzitie de stadiu primeste o cheie dedup diferita", () => {
    const t1 = diffNameSoap({
      prevSnapshot: snapshot([dosarCu("Fond")]),
      currentSnapshot: snapshot([dosarCu("Apel")]),
      alertConfig: DEFAULT_ALERT_CONFIG,
      now: NOW,
      jobCreatedAt: JOB_CREATED_AT,
      prevSnapshotId: 1,
    });
    const t2 = diffNameSoap({
      prevSnapshot: snapshot([dosarCu("Apel")]),
      currentSnapshot: snapshot([dosarCu("Recurs")]),
      alertConfig: DEFAULT_ALERT_CONFIG,
      now: NOW,
      jobCreatedAt: JOB_CREATED_AT,
      prevSnapshotId: 2,
    });
    const k1 = t1.alerts.find((a) => a.kind === "stadiu_changed")?.dedupKey;
    const k2 = t2.alerts.find((a) => a.kind === "stadiu_changed")?.dedupKey;
    expect(k1).toBeDefined();
    expect(k2).toBeDefined();
    expect(k1).not.toEqual(k2);
  });

  it("retry pe ACELASI baseline pastreaza cheia identica (idempotent)", () => {
    const input = {
      prevSnapshot: snapshot([dosarCu("Fond")]),
      currentSnapshot: snapshot([dosarCu("Apel")]),
      alertConfig: DEFAULT_ALERT_CONFIG,
      now: NOW,
      jobCreatedAt: JOB_CREATED_AT,
      prevSnapshotId: 5,
    };
    const a = diffNameSoap(input).alerts.find((x) => x.kind === "stadiu_changed")?.dedupKey;
    const b = diffNameSoap(input).alerts.find((x) => x.kind === "stadiu_changed")?.dedupKey;
    expect(a).toEqual(b);
  });
});

describe("diffNameSoap title — monitored name vs found dossier number", () => {
  // The ${numar} in the title is the FOUND dossier, not the search term. With a
  // known monitored name we show it unquoted (user decision); without it we
  // mark the source so the number is not mistaken for the name. Mirrors the
  // real case (dosar 2109/3/2023 with a future sedinta => dosar_new fires).
  it("dosar_new: includes the monitored name when provided", () => {
    const out = diffNameSoap({
      prevSnapshot: null,
      currentSnapshot: snapshot([snapshotDosar("2109/3/2023", "2026-11-10T00:00:00")]),
      alertConfig: DEFAULT_ALERT_CONFIG,
      now: NOW,
      jobCreatedAt: JOB_CREATED_AT,
      prevSnapshotId: null,
      nameNormalized: "EURO ASFALT SRL",
    });
    expect(out.alerts.find((x) => x.kind === "dosar_new")?.title).toBe(
      "Dosar nou gasit pentru EURO ASFALT SRL: 2109/3/2023"
    );
  });

  it("dosar_new: falls back to a name-watch marker when the name is absent", () => {
    const out = diffNameSoap({
      prevSnapshot: null,
      currentSnapshot: snapshot([snapshotDosar("2109/3/2023", "2026-11-10T00:00:00")]),
      alertConfig: DEFAULT_ALERT_CONFIG,
      now: NOW,
      jobCreatedAt: JOB_CREATED_AT,
      prevSnapshotId: null,
    });
    expect(out.alerts.find((x) => x.kind === "dosar_new")?.title).toBe(
      "Dosar nou gasit (monitorizare pe nume): 2109/3/2023"
    );
  });

  it("dosar_disappeared: includes the monitored name when provided", () => {
    const out = diffNameSoap({
      prevSnapshot: snapshot([snapshotDosar("2109/3/2023", null)]),
      currentSnapshot: snapshot([]),
      alertConfig: DEFAULT_ALERT_CONFIG,
      now: NOW,
      jobCreatedAt: JOB_CREATED_AT,
      prevSnapshotId: 1,
      nameNormalized: "EURO ASFALT SRL",
    });
    expect(out.alerts.find((x) => x.kind === "dosar_disappeared")?.title).toBe(
      "Dosarul nu mai apare pentru EURO ASFALT SRL: 2109/3/2023"
    );
  });
});
