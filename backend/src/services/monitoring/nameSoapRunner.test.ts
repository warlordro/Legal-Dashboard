import Database from "better-sqlite3";
import path from "path";
import os from "os";
import fsPromises from "fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../../db/schema.ts";
import { getLatestSnapshot } from "../../db/monitoringSnapshotsRepository.ts";
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
  return db.prepare(`SELECT * FROM monitoring_jobs WHERE id = ?`).get(info.lastInsertRowid) as ScheduledJob;
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

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-name-runner-"));
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
      .prepare(`SELECT kind, dedup_key FROM monitoring_alerts WHERE job_id = ?`)
      .all(job.id) as Array<{ kind: string; dedup_key: string }>;
    expect(alerts).toEqual([{ kind: "dosar_new", dedup_key: "name_soap|999/1/2025|dosar_new" }]);
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
      .prepare(`SELECT kind FROM monitoring_alerts WHERE job_id = ? ORDER BY kind`)
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
      delete process.env.MONITORING_PARTIAL_ALERTS_ENABLED;
    }
  });

  it("does NOT emit source_partial alert when flag is off (default)", async () => {
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
