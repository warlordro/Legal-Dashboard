import { afterEach, describe, expect, it, vi } from "vitest";
import type { AlertConfig } from "../../../schemas/monitoring.ts";
import type { Dosar } from "../../../soap.ts";
import {
  buildNameSoapSnapshot,
  diffNameSoap,
  type NameSoapSnapshotDosar,
  type NameSoapSnapshotPayload,
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
  prevSnapshot?: NameSoapSnapshotPayload | null;
  current: NameSoapSnapshotDosar;
  jobCreatedAt?: string;
}) {
  return diffNameSoap({
    prevSnapshot: input.prevSnapshot ?? null,
    currentSnapshot: snapshot([input.current]),
    alertConfig: DEFAULT_ALERT_CONFIG,
    now: NOW,
    jobCreatedAt: input.jobCreatedAt ?? JOB_CREATED_AT,
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
