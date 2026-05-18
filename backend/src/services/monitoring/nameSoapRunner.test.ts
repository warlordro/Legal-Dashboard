import Database from "better-sqlite3";
import path from "node:path";
import os from "node:os";
import fsPromises from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../../db/schema.ts";
import { getLatestSnapshot } from "../../db/monitoringSnapshotsRepository.ts";
import { SNAPSHOT_PAYLOAD_MAX_BYTES } from "./diff/types.ts";
import { createNameSoapRunner, dosarMatchesAllNameTokens, tokenizeNameForMatch } from "./nameSoapRunner.ts";
import type { ScheduledJob } from "./scheduler.ts";
import type { Dosar } from "../../soap.ts";

let tmpRoot: string;

const OWNER = "local";
const NOW_ISO = "2026-04-28T10:00:00.000Z";

let hashCounter = 0;
function seedJob(opts?: {
  alertConfigJson?: string;
  targetJson?: string;
}): ScheduledJob {
  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO monitoring_jobs
         (owner_id, kind, target_json, target_hash, cadence_sec,
          alert_config_json, next_run_at)
       VALUES (?, 'name_soap', ?, ?, 14400, ?, '2026-04-28T12:00:00.000Z')`
    )
    .run(
      OWNER,
      opts?.targetJson ?? '{"name_normalized":"ion popescu"}',
      `name-hash-${++hashCounter}`,
      opts?.alertConfigJson ??
        JSON.stringify({
          notify_days_before: [7, 1],
          notify_on_new_termen: true,
          notify_on_solution: true,
          notify_on_dosar_disappeared: true,
        })
    );
  return db.prepare("SELECT * FROM monitoring_jobs WHERE id = ?").get(info.lastInsertRowid) as ScheduledJob;
}

function seedRunningRow(jobId: number): number {
  getDb()
    .prepare(
      `UPDATE monitoring_runs
         SET status = 'aborted',
             ended_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE job_id = ? AND status = 'running'`
    )
    .run(jobId);
  const info = getDb()
    .prepare(
      `INSERT INTO monitoring_runs (owner_id, job_id, started_at, status)
       VALUES (?, ?, ?, 'running')`
    )
    .run(OWNER, jobId, NOW_ISO);
  return info.lastInsertRowid as number;
}

function countSnapshots(jobId: number): number {
  return (
    getDb()
      .prepare("SELECT COUNT(*) AS n FROM monitoring_snapshots WHERE owner_id = ? AND job_id = ?")
      .get(OWNER, jobId) as {
      n: number;
    }
  ).n;
}

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-name-runner-"));
  process.env.LEGAL_DASHBOARD_DB_PATH = path.join(tmpRoot, "legal-dashboard.db");
  const seed = new Database(process.env.LEGAL_DASHBOARD_DB_PATH);
  seed.close();
  getDb();
});

afterEach(async () => {
  closeDb();
  // biome-ignore lint/performance/noDelete: process.env trebuie unset real, nu valoare undefined.
  delete process.env.LEGAL_DASHBOARD_DB_PATH;
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

function makeDosar(
  numar: string,
  stadiuProcesual = "fond",
  categorieCaz = "civil",
  institutie = "Judecatoria Test",
  // Default party-ul match-uieste targetul implicit "ion popescu" — strict
  // word filter (2026-05-03) cere ca MACAR o parte sa contina toate cuvintele
  // numelui monitorizat.
  parti: Array<{ nume: string; calitateParte: string }> = [{ nume: "Ion Popescu", calitateParte: "Reclamant" }]
): Dosar {
  return {
    numar,
    data: "2024-01-15",
    institutie,
    departament: "",
    categorieCaz,
    stadiuProcesual,
    obiect: "test",
    parti,
    sedinte: [],
  };
}

describe("nameSoapRunner - baseline", () => {
  it("empty prev snapshot -> persists enriched capture without alerts", async () => {
    const job = seedJob();
    const runId = seedRunningRow(job.id);
    const runner = createNameSoapRunner({
      searchDosare: async () => [makeDosar("1234/180/2024")],
    });

    const out = await runner.run({
      job,
      runId,
      nowIso: NOW_ISO,
      signal: new AbortController().signal,
    });

    expect(out.status).toBe("ok");
    expect(out.alertsCreated).toBe(0);
    const snap = getLatestSnapshot(job.owner_id, job.id);
    expect(snap).not.toBeNull();
    expect(JSON.parse(snap!.payload_json)).toMatchObject({
      version: 1,
      fetched_at: NOW_ISO,
      dosare: [
        {
          numar: "1234/180/2024",
          stadiu: "fond",
          categorie: "civil",
          instanta: "Judecatoria Test",
        },
      ],
    });
  });
});

describe("nameSoapRunner - diff", () => {
  it("new dosar after baseline -> emits dosar_new with stable dedup key", async () => {
    const job = seedJob();
    let secondTick = false;
    const runner = createNameSoapRunner({
      searchDosare: async () =>
        secondTick ? [makeDosar("1234/180/2024"), makeDosar("999/1/2025")] : [makeDosar("1234/180/2024")],
    });

    await runner.run({
      job,
      runId: seedRunningRow(job.id),
      nowIso: NOW_ISO,
      signal: new AbortController().signal,
    });
    secondTick = true;
    const out = await runner.run({
      job,
      runId: seedRunningRow(job.id),
      nowIso: "2026-04-28T11:00:00.000Z",
      signal: new AbortController().signal,
    });

    expect(out.status).toBe("ok");
    expect(out.alertsCreated).toBe(1);
    const alerts = getDb()
      .prepare("SELECT kind, dedup_key FROM monitoring_alerts WHERE job_id = ?")
      .all(job.id) as Array<{ kind: string; dedup_key: string }>;
    expect(alerts).toEqual([{ kind: "dosar_new", dedup_key: "name_soap|999/1/2025|dosar_new" }]);
  });

  it("three consecutive ticks leave exactly 1 snapshot for the job", async () => {
    const job = seedJob();
    const runner = createNameSoapRunner({
      searchDosare: async () => [makeDosar("1234/180/2024")],
    });

    for (const nowIso of [NOW_ISO, "2026-04-28T11:00:00.000Z", "2026-04-28T12:00:00.000Z"]) {
      const out = await runner.run({
        job,
        runId: seedRunningRow(job.id),
        nowIso,
        signal: new AbortController().signal,
      });
      expect(out.status).toBe("ok");
    }

    expect(countSnapshots(job.id)).toBe(1);
  });

  it("alert insert failure rolls back retention and keeps the previous snapshot", async () => {
    const job = seedJob();
    let secondTick = false;
    const runner = createNameSoapRunner({
      searchDosare: async () =>
        secondTick ? [makeDosar("1234/180/2024"), makeDosar("999/1/2026")] : [makeDosar("1234/180/2024")],
    });

    await runner.run({
      job,
      runId: seedRunningRow(job.id),
      nowIso: NOW_ISO,
      signal: new AbortController().signal,
    });
    const baseline = getLatestSnapshot(job.owner_id, job.id);
    expect(baseline).not.toBeNull();

    getDb()
      .prepare(
        [
          "CREATE TRIGGER fail_name_alert_insert",
          "BEFORE INSERT ON monitoring_alerts",
          "BEGIN SELECT RAISE(FAIL, 'forced name alert failure'); END",
        ].join(" ")
      )
      .run();

    secondTick = true;
    await expect(
      runner.run({
        job,
        runId: seedRunningRow(job.id),
        nowIso: "2026-04-28T11:00:00.000Z",
        signal: new AbortController().signal,
      })
    ).rejects.toThrow(/forced name alert failure/);

    getDb().prepare("DROP TRIGGER fail_name_alert_insert").run();

    const after = getLatestSnapshot(job.owner_id, job.id);
    expect(countSnapshots(job.id)).toBe(1);
    expect(after?.id).toBe(baseline!.id);
  });

  it("stadiu change entering filter -> emits relevance + stadiu alerts", async () => {
    const job = seedJob({
      alertConfigJson: JSON.stringify({
        notify_days_before: [7, 1],
        notify_on_new_termen: true,
        notify_on_solution: true,
        notify_on_dosar_disappeared: true,
        stadii: ["apel"],
      }),
    });
    let secondTick = false;
    const runner = createNameSoapRunner({
      searchDosare: async () =>
        secondTick ? [makeDosar("1234/180/2024", "apel")] : [makeDosar("1234/180/2024", "fond")],
    });

    await runner.run({
      job,
      runId: seedRunningRow(job.id),
      nowIso: NOW_ISO,
      signal: new AbortController().signal,
    });
    secondTick = true;
    const out = await runner.run({
      job,
      runId: seedRunningRow(job.id),
      nowIso: "2026-04-28T11:00:00.000Z",
      signal: new AbortController().signal,
    });

    expect(out.status).toBe("ok");
    const kinds = getDb()
      .prepare("SELECT kind FROM monitoring_alerts WHERE job_id = ? ORDER BY kind")
      .all(job.id)
      .map((r) => (r as { kind: string }).kind);
    expect(kinds).toEqual(["dosar_relevant_now", "stadiu_changed"]);
  });
});

describe("nameSoapRunner - source_partial (Batch 2.1)", () => {
  it("emits source_partial alert when one institutie fails + flag is on", async () => {
    process.env.MONITORING_PARTIAL_ALERTS_ENABLED = "1";
    try {
      const job = seedJob({
        targetJson: JSON.stringify({
          name_normalized: "ion popescu",
          institutie: ["Judecatoria A", "Judecatoria B"],
        }),
      });
      const runner = createNameSoapRunner({
        searchDosare: async (params) => {
          if (params.institutie === "Judecatoria B") {
            throw new Error("upstream 503");
          }
          return [makeDosar("1234/180/2024", "fond", "civil", "Judecatoria A")];
        },
      });

      const out = await runner.run({
        job,
        runId: seedRunningRow(job.id),
        nowIso: NOW_ISO,
        signal: new AbortController().signal,
      });
      expect(out.status).toBe("ok");
      const alert = getDb()
        .prepare(
          `SELECT kind, severity, detail_json FROM monitoring_alerts WHERE job_id = ? AND kind = 'source_partial'`
        )
        .get(job.id) as { kind: string; severity: string; detail_json: string } | undefined;
      expect(alert).toBeDefined();
      expect(alert!.severity).toBe("warning");
      const detail = JSON.parse(alert!.detail_json) as {
        failed_institutii: Array<{ institutie: string | null; error: string }>;
      };
      expect(detail.failed_institutii).toHaveLength(1);
      expect(detail.failed_institutii[0].institutie).toBe("Judecatoria B");
    } finally {
      // biome-ignore lint/performance/noDelete: process.env trebuie unset real, nu valoare undefined.
      delete process.env.MONITORING_PARTIAL_ALERTS_ENABLED;
    }
  });

  it("does NOT emit source_partial alert when flag is off (default)", async () => {
    // biome-ignore lint/performance/noDelete: process.env trebuie unset real, nu valoare undefined.
    delete process.env.MONITORING_PARTIAL_ALERTS_ENABLED;
    const job = seedJob({
      targetJson: JSON.stringify({
        name_normalized: "ion popescu",
        institutie: ["Judecatoria A", "Judecatoria B"],
      }),
    });
    const runner = createNameSoapRunner({
      searchDosare: async (params) => {
        if (params.institutie === "Judecatoria B") {
          throw new Error("upstream 503");
        }
        return [makeDosar("1234/180/2024", "fond", "civil", "Judecatoria A")];
      },
    });

    await runner.run({
      job,
      runId: seedRunningRow(job.id),
      nowIso: NOW_ISO,
      signal: new AbortController().signal,
    });

    const alert = getDb()
      .prepare(`SELECT kind FROM monitoring_alerts WHERE job_id = ? AND kind = 'source_partial'`)
      .get(job.id);
    expect(alert).toBeUndefined();
  });
});

describe("nameSoapRunner - SOAP error", () => {
  it("searchDosare throws -> returns SOAP_FAIL and writes no snapshot", async () => {
    const job = seedJob();
    const runner = createNameSoapRunner({
      searchDosare: async () => {
        throw new Error("upstream 503");
      },
    });

    const out = await runner.run({
      job,
      runId: seedRunningRow(job.id),
      nowIso: NOW_ISO,
      signal: new AbortController().signal,
    });

    expect(out.status).toBe("error");
    expect(out.errorCode).toBe("SOAP_FAIL");
    expect(getLatestSnapshot(job.owner_id, job.id)).toBeNull();
  });
});

describe("nameSoapRunner - SNAPSHOT_OVERSIZE plafon", () => {
  it("payload peste 3 MiB -> outcome error SNAPSHOT_OVERSIZE si niciun snapshot scris", async () => {
    const job = seedJob();
    const runId = seedRunningRow(job.id);
    const runner = createNameSoapRunner({
      searchDosare: async () => [
        makeDosar("1234/180/2024", "fond", "civil", "Judecatoria ".concat("X".repeat(SNAPSHOT_PAYLOAD_MAX_BYTES))),
      ],
    });

    const out = await runner.run({
      job,
      runId,
      nowIso: NOW_ISO,
      signal: new AbortController().signal,
    });

    expect(out.status).toBe("error");
    expect(out.errorCode).toBe("SNAPSHOT_OVERSIZE");
    expect(out.alertsCreated).toBe(1);
    expect(getLatestSnapshot(job.owner_id, job.id)).toBeNull();

    const alert = getDb()
      .prepare(
        `SELECT title, kind, severity, detail_json
           FROM monitoring_alerts
          WHERE job_id = ?`
      )
      .get(job.id) as { title: string; kind: string; severity: string; detail_json: string };
    expect(alert.kind).toBe("source_error");
    expect(alert.severity).toBe("warning");
    expect(alert.title).toBe(`Snapshot peste plafon (${SNAPSHOT_PAYLOAD_MAX_BYTES >> 20} MiB) - refuzat la scriere`);
    const detail = JSON.parse(alert.detail_json) as { error_code: string; payload_bytes: number; max_bytes: number };
    expect(detail.error_code).toBe("SNAPSHOT_OVERSIZE");
    expect(detail.payload_bytes).toBeGreaterThan(SNAPSHOT_PAYLOAD_MAX_BYTES);
    expect(detail.max_bytes).toBe(SNAPSHOT_PAYLOAD_MAX_BYTES);
  });

  it("payload de 2 MiB ramane sub plafonul de 3 MiB si se scrie normal", async () => {
    const job = seedJob();
    const runId = seedRunningRow(job.id);
    const runner = createNameSoapRunner({
      searchDosare: async () => [
        makeDosar("1234/180/2024", "fond", "civil", "Judecatoria ".concat("X".repeat(2 * 1024 * 1024))),
      ],
    });

    const out = await runner.run({
      job,
      runId,
      nowIso: NOW_ISO,
      signal: new AbortController().signal,
    });

    expect(out.status).toBe("ok");
    expect(getLatestSnapshot(job.owner_id, job.id)).not.toBeNull();
    const oversizeCount = (
      getDb()
        .prepare(
          `SELECT COUNT(*) AS n
             FROM monitoring_alerts
            WHERE job_id = ? AND kind = 'source_error' AND detail_json LIKE '%SNAPSHOT_OVERSIZE%'`
        )
        .get(job.id) as { n: number }
    ).n;
    expect(oversizeCount).toBe(0);
  });
});

describe("nameSoapRunner - strict word filter", () => {
  it("tokenizeNameForMatch trateaza '&' ca token de sine statator", () => {
    expect(tokenizeNameForMatch("Smith & Jones")).toEqual(["SMITH", "&", "JONES"]);
    expect(tokenizeNameForMatch("Smith&Jones")).toEqual(["SMITH", "&", "JONES"]);
    expect(tokenizeNameForMatch("ABC&XYZ srl")).toEqual(["ABC", "&", "XYZ", "SRL"]);
  });

  it("tokenizeNameForMatch strip-uieste diacritice + UPPERCASE", () => {
    expect(tokenizeNameForMatch("Țara Românească")).toEqual(["TARA", "ROMANEASCA"]);
  });

  it("dosarMatchesAllNameTokens cere TOATE cuvintele intr-o singura parte", () => {
    const target = "GLOBAL LEARNING LOGISTICS";
    const matchDosar: Dosar = {
      numar: "1/1/2024",
      data: "",
      institutie: "",
      departament: "",
      categorieCaz: "",
      stadiuProcesual: "",
      obiect: "",
      parti: [{ nume: "Global Learning Logistics SRL", calitateParte: "Reclamant" }],
      sedinte: [],
    };
    const partialDosar: Dosar = {
      ...matchDosar,
      parti: [{ nume: "Global Logistics SA", calitateParte: "Reclamant" }],
    };
    expect(dosarMatchesAllNameTokens(matchDosar, target)).toBe(true);
    expect(dosarMatchesAllNameTokens(partialDosar, target)).toBe(false);
  });

  it("dosarMatchesAllNameTokens accepta match in oricare dintre parti", () => {
    const target = "ION POPESCU";
    const dosar: Dosar = {
      numar: "1/1/2024",
      data: "",
      institutie: "",
      departament: "",
      categorieCaz: "",
      stadiuProcesual: "",
      obiect: "",
      parti: [
        { nume: "Acme SRL", calitateParte: "Reclamant" },
        { nume: "Ion Popescu", calitateParte: "Parat" },
      ],
      sedinte: [],
    };
    expect(dosarMatchesAllNameTokens(dosar, target)).toBe(true);
  });

  it("dosarMatchesAllNameTokens returneaza false pe parti goale", () => {
    const dosar: Dosar = {
      numar: "1/1/2024",
      data: "",
      institutie: "",
      departament: "",
      categorieCaz: "",
      stadiuProcesual: "",
      obiect: "",
      parti: [],
      sedinte: [],
    };
    expect(dosarMatchesAllNameTokens(dosar, "ION POPESCU")).toBe(false);
  });

  it("dosarMatchesAllNameTokens fail-closed cand targetul e doar sufix legal (SRL)", () => {
    // Target = "SRL" → dupa stripLegalSuffix devine [], deci nu mai avem
    // cuvinte de match. Returnam false ca sa nu trecem TOATE dosarele cu
    // o parte SRL (ar fi inundatie de pseudo-pozitive).
    const dosar: Dosar = {
      numar: "1/1/2024",
      data: "",
      institutie: "",
      departament: "",
      categorieCaz: "",
      stadiuProcesual: "",
      obiect: "",
      parti: [{ nume: "Acme Trading SRL", calitateParte: "Reclamant" }],
      sedinte: [],
    };
    expect(dosarMatchesAllNameTokens(dosar, "SRL")).toBe(false);
    expect(dosarMatchesAllNameTokens(dosar, "S.R.L.")).toBe(false);
    expect(dosarMatchesAllNameTokens(dosar, "  SRL  LLC  ")).toBe(false);
  });

  describe("dosarMatchesAllNameTokens (set equality)", () => {
    function dosarCuParte(nume: unknown): Dosar {
      return {
        numar: "1/1/2024",
        data: "",
        institutie: "",
        departament: "",
        categorieCaz: "",
        stadiuProcesual: "",
        obiect: "",
        parti: [{ nume, calitateParte: "Reclamant" }] as Dosar["parti"],
        sedinte: [],
      };
    }

    it("accepta match exact dupa strip de sufix legal", () => {
      expect(dosarMatchesAllNameTokens(dosarCuParte("PROFESIONAL CONSTRUCT SRL"), "PROFESIONAL CONSTRUCT SRL")).toBe(
        true
      );
    });

    it("respinge superset-ul NG PROFESIONAL CONSTRUCT pentru target PROFESIONAL CONSTRUCT", () => {
      expect(dosarMatchesAllNameTokens(dosarCuParte("NG PROFESIONAL CONSTRUCT SRL"), "PROFESIONAL CONSTRUCT SRL")).toBe(
        false
      );
    });

    it("pastreaza echivalenta sufixelor juridice punctate", () => {
      expect(dosarMatchesAllNameTokens(dosarCuParte("X S.R.L."), "X SRL")).toBe(true);
    });

    it("respinge tokenii duplicati in party", () => {
      expect(dosarMatchesAllNameTokens(dosarCuParte("X X"), "X")).toBe(false);
    });

    it("respinge targetul gol, parti goale, parti undefined si nume null fara throw", () => {
      expect(dosarMatchesAllNameTokens(dosarCuParte("ABC"), "")).toBe(false);
      expect(dosarMatchesAllNameTokens({ ...dosarCuParte("ABC"), parti: [] }, "ABC")).toBe(false);
      expect(dosarMatchesAllNameTokens({ ...dosarCuParte("ABC"), parti: undefined } as unknown as Dosar, "ABC")).toBe(
        false
      );
      expect(dosarMatchesAllNameTokens(dosarCuParte(null), "ABC")).toBe(false);
      expect(dosarMatchesAllNameTokens(dosarCuParte(undefined), "ABC")).toBe(false);
      expect(dosarMatchesAllNameTokens(dosarCuParte("ABC"), null as unknown as string)).toBe(false);
    });
  });

  it("filtru runner: SOAP returneaza dosare false-pozitive, ele NU ajung in snapshot", async () => {
    const job = seedJob({
      targetJson: '{"name_normalized":"GLOBAL LEARNING LOGISTICS"}',
    });
    const runner = createNameSoapRunner({
      searchDosare: async () => [
        // Match strict — ramane.
        makeDosar("1/1/2024", "fond", "civil", "Judecatoria Test", [
          { nume: "Global Learning Logistics SRL", calitateParte: "Reclamant" },
        ]),
        // False-pozitiv — lipseste "LEARNING" → filtrat afara.
        makeDosar("2/2/2024", "fond", "civil", "Judecatoria Test", [
          { nume: "Global Logistics SA", calitateParte: "Reclamant" },
        ]),
      ],
    });

    const out = await runner.run({
      job,
      runId: seedRunningRow(job.id),
      nowIso: NOW_ISO,
      signal: new AbortController().signal,
    });

    expect(out.status).toBe("ok");
    const snap = getLatestSnapshot(job.owner_id, job.id);
    const payload = JSON.parse(snap!.payload_json) as { dosare: Array<{ numar: string }> };
    expect(payload.dosare.map((d) => d.numar)).toEqual(["1/1/2024"]);
  });

  it("filtru runner: '&' este matched literal", async () => {
    const job = seedJob({
      targetJson: '{"name_normalized":"SMITH & JONES"}',
    });
    const runner = createNameSoapRunner({
      searchDosare: async () => [
        // Match — "&" e prezent.
        makeDosar("1/1/2024", "fond", "civil", "Judecatoria Test", [
          { nume: "Smith & Jones LLC", calitateParte: "Reclamant" },
        ]),
        // False-pozitiv — fara "&".
        makeDosar("2/2/2024", "fond", "civil", "Judecatoria Test", [
          { nume: "Smith Jones LLC", calitateParte: "Reclamant" },
        ]),
        // False-pozitiv — "AND" in loc de "&".
        makeDosar("3/3/2024", "fond", "civil", "Judecatoria Test", [
          { nume: "Smith and Jones LLC", calitateParte: "Reclamant" },
        ]),
      ],
    });

    const out = await runner.run({
      job,
      runId: seedRunningRow(job.id),
      nowIso: NOW_ISO,
      signal: new AbortController().signal,
    });

    expect(out.status).toBe("ok");
    const snap = getLatestSnapshot(job.owner_id, job.id);
    const payload = JSON.parse(snap!.payload_json) as { dosare: Array<{ numar: string }> };
    expect(payload.dosare.map((d) => d.numar)).toEqual(["1/1/2024"]);
  });
});

// v2.17.0 — partial-success on multi-institution targets. Pre-fix one flaky
// court (e.g. PortalJust 504 for Curtea de Apel Cluj) wiped the entire run
// even when 4 other courts returned legitimate diff-eligible data.
describe("nameSoapRunner - partial-success on multi-institution failures", () => {
  it("partial: one of three institutii fails; runner returns ok with the survivors", async () => {
    const job = seedJob({
      targetJson: JSON.stringify({
        name_normalized: "ION POPESCU",
        institutie: ["Judecatoria A", "Judecatoria B", "Judecatoria C"],
      }),
    });
    const runner = createNameSoapRunner({
      searchDosare: async (params) => {
        if (params.institutie === "Judecatoria B") {
          throw new Error("upstream 504");
        }
        const inst = params.institutie ?? "unknown";
        return [makeDosar(`1/${inst}/2024`, "fond", "civil", inst)];
      },
    });

    const out = await runner.run({
      job,
      runId: seedRunningRow(job.id),
      nowIso: NOW_ISO,
      signal: new AbortController().signal,
    });

    expect(out.status).toBe("ok");
    const snap = getLatestSnapshot(job.owner_id, job.id);
    const payload = JSON.parse(snap!.payload_json) as {
      dosare: Array<{ numar: string }>;
    };
    expect(payload.dosare.map((d) => d.numar).sort()).toEqual(["1/Judecatoria A/2024", "1/Judecatoria C/2024"]);
  });

  it("all institutii fail -> runner returns SOAP_FAIL", async () => {
    const job = seedJob({
      targetJson: JSON.stringify({
        name_normalized: "ION POPESCU",
        institutie: ["Judecatoria A", "Judecatoria B"],
      }),
    });
    const runner = createNameSoapRunner({
      searchDosare: async () => {
        throw new Error("upstream 504");
      },
    });

    const out = await runner.run({
      job,
      runId: seedRunningRow(job.id),
      nowIso: NOW_ISO,
      signal: new AbortController().signal,
    });

    expect(out.status).toBe("error");
    expect(out.errorCode).toBe("SOAP_FAIL");
    expect(String(out.errorMessage)).toContain("all institutions failed");
  });
});
