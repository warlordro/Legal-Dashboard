// dosarSoapRunner — orchestration glue between scheduler ↔ SOAP ↔ diff ↔ DB.
//
// Coverage focus:
//   - happy path: empty prev snapshot → no alerts (baseline tick), snapshot persisted
//   - diff produces alerts → insertAlert called once per alert, alertsCreated counted
//   - SOAP throw on unrelated error → { status: "error", errorCode: "SOAP_FAIL" }
//   - external abort during SOAP → { status: "aborted" }, no snapshot/alert writes
//   - wallclock budget exceeded → { status: "timeout", errorCode: "WALLCLOCK_BUDGET" }
//   - dosar disappeared (search returns []) → snapshot lastDosarPresent=false
//
// SOAP itself is injected (deps.searchDosare). The real impl in C6 will
// wire production `cautareDosare`. Keeping the dep injectable lets these
// tests run with no network and lets the manual-trigger route reuse the
// same factory.

import Database from "better-sqlite3";
import path from "path";
import os from "os";
import fsPromises from "fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  closeDb,
  getDb,
} from "../../db/schema.ts";
import {
  getLatestSnapshot,
} from "../../db/monitoringSnapshotsRepository.ts";
import { createDosarSoapRunner } from "./dosarSoapRunner.ts";
import type { ScheduledJob } from "./scheduler.ts";
import type { Dosar } from "../../soap.ts";

let tmpRoot: string;

const OWNER = "local";
const NOW_ISO = "2026-04-28T10:00:00.000Z";

let _hashCounter = 0;
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
       VALUES (?, 'dosar_soap', ?, ?, 14400, ?, '2026-04-28T12:00:00.000Z')`,
    )
    .run(
      OWNER,
      opts?.targetJson ?? '{"numar_dosar":"1234/180/2024"}',
      `hash-${++_hashCounter}`,
      opts?.alertConfigJson ??
        JSON.stringify({
          notify_days_before: [7, 1],
          notify_on_new_termen: true,
          notify_on_solution: true,
          notify_on_dosar_disappeared: true,
        }),
    );
  return db
    .prepare(`SELECT * FROM monitoring_jobs WHERE id = ?`)
    .get(info.lastInsertRowid) as ScheduledJob;
}

function seedRunningRow(jobId: number): number {
  const info = getDb()
    .prepare(
      `INSERT INTO monitoring_runs (owner_id, job_id, started_at, status)
       VALUES (?, ?, ?, 'running')`,
    )
    .run(OWNER, jobId, NOW_ISO);
  return info.lastInsertRowid as number;
}

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-runner-"));
  process.env.LEGAL_DASHBOARD_DB_PATH = path.join(
    tmpRoot,
    "legal-dashboard.db",
  );
  const seed = new Database(process.env.LEGAL_DASHBOARD_DB_PATH);
  seed.close();
  getDb();
});

afterEach(async () => {
  closeDb();
  delete process.env.LEGAL_DASHBOARD_DB_PATH;
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

function makeDosar(numar: string, sedinte: Dosar["sedinte"] = []): Dosar {
  return {
    numar,
    data: "2024-01-15",
    institutie: "Judecatoria Test",
    departament: "",
    categorieCaz: "civil",
    stadiuProcesual: "fond",
    obiect: "test",
    parti: [],
    sedinte,
  };
}

describe("dosarSoapRunner — happy path baseline", () => {
  it("empty prev snapshot → emits no alerts, persists baseline snapshot", async () => {
    const job = seedJob();
    const runId = seedRunningRow(job.id);

    const runner = createDosarSoapRunner({
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

    const snap = getLatestSnapshot(job.id);
    expect(snap).not.toBeNull();
    expect(snap!.observed_at).toBe(NOW_ISO);
    const payload = JSON.parse(snap!.payload_json);
    expect(payload.lastDosarPresent).toBe(true);
    expect(Array.isArray(payload.sedintaKeys)).toBe(true);

    const alertCount = (
      getDb()
        .prepare(`SELECT COUNT(*) AS n FROM monitoring_alerts WHERE job_id = ?`)
        .get(job.id) as { n: number }
    ).n;
    expect(alertCount).toBe(0);
  });
});

describe("dosarSoapRunner — diff emits alerts", () => {
  it("new termen between snapshots → termen_new alert persisted", async () => {
    const sedinta = {
      complet: "C1",
      data: "2026-05-01",
      ora: "10:00",
      solutie: "",
      solutieSumar: "",
      documentSedinta: "",
      numarDocument: "",
      dataPronuntare: "",
    };

    // Stateful closure flips between baseline (no sedinte) and updated
    // (one sedinta) so the second tick computes a real diff.
    let returnSedinte = false;
    const runner = createDosarSoapRunner({
      searchDosare: async () =>
        returnSedinte
          ? [makeDosar("1234/180/2024", [sedinta])]
          : [makeDosar("1234/180/2024")],
    });

    const job = seedJob();
    const r1 = seedRunningRow(job.id);
    await runner.run({
      job,
      runId: r1,
      nowIso: NOW_ISO,
      signal: new AbortController().signal,
    });

    returnSedinte = true;
    const r2 = seedRunningRow(job.id);
    const second = await runner.run({
      job,
      runId: r2,
      nowIso: "2026-04-28T10:05:00.000Z",
      signal: new AbortController().signal,
    });

    expect(second.status).toBe("ok");
    expect(second.alertsCreated).toBeGreaterThanOrEqual(1);

    const alerts = getDb()
      .prepare(
        `SELECT kind FROM monitoring_alerts WHERE job_id = ? ORDER BY id`,
      )
      .all(job.id) as { kind: string }[];
    expect(alerts.some((a) => a.kind === "termen_new")).toBe(true);
  });
});

describe("dosarSoapRunner — SOAP error", () => {
  it("searchDosare throws → returns error outcome, no snapshot written", async () => {
    const job = seedJob();
    const runId = seedRunningRow(job.id);

    const runner = createDosarSoapRunner({
      searchDosare: async () => {
        throw new Error("upstream 503");
      },
    });
    const out = await runner.run({
      job,
      runId,
      nowIso: NOW_ISO,
      signal: new AbortController().signal,
    });

    expect(out.status).toBe("error");
    expect(out.errorCode).toBe("SOAP_FAIL");
    expect(out.errorMessage).toContain("upstream 503");
    expect(getLatestSnapshot(job.id)).toBeNull();
  });
});

describe("dosarSoapRunner — abort during SOAP", () => {
  it("external abort propagates → status='aborted', no writes", async () => {
    const job = seedJob();
    const runId = seedRunningRow(job.id);
    const ctrl = new AbortController();

    const runner = createDosarSoapRunner({
      searchDosare: async (_params, opts) => {
        // Wait until the test aborts the signal, then throw an AbortError.
        await new Promise<void>((_resolve, reject) => {
          opts!.signal!.addEventListener("abort", () => {
            reject(
              Object.assign(new Error("aborted"), { name: "AbortError" }),
            );
          });
        });
        return [];
      },
    });

    const promise = runner.run({
      job,
      runId,
      nowIso: NOW_ISO,
      signal: ctrl.signal,
    });
    // Yield, then abort.
    await new Promise((r) => setImmediate(r));
    ctrl.abort();

    const out = await promise;
    expect(out.status).toBe("aborted");
    expect(getLatestSnapshot(job.id)).toBeNull();
  });
});

describe("dosarSoapRunner — wallclock budget", () => {
  it("internal 10-min budget fires → status='timeout'", async () => {
    const job = seedJob();
    const runId = seedRunningRow(job.id);

    // Inject a fake AbortSignal as the budget-equivalent: the runner is
    // supposed to compose AbortSignal.timeout(10min) with the external
    // signal. We can't sleep 10min in a test, so we override the budget
    // factory via a hidden seam: pass an explicit short budget.
    const runner = createDosarSoapRunner({
      searchDosare: async (_params, opts) => {
        await new Promise<void>((_resolve, reject) => {
          opts!.signal!.addEventListener("abort", () => {
            reject(
              Object.assign(new Error("timeout"), { name: "TimeoutError" }),
            );
          });
        });
        return [];
      },
      budgetMs: 25, // testing seam — production uses 600_000
    });

    const out = await runner.run({
      job,
      runId,
      nowIso: NOW_ISO,
      signal: new AbortController().signal,
    });

    expect(out.status).toBe("timeout");
    expect(out.errorCode).toBe("WALLCLOCK_BUDGET");
    expect(getLatestSnapshot(job.id)).toBeNull();
  });
});


describe("dosarSoapRunner — dosar disappeared", () => {
  it("empty SOAP result → snapshot lastDosarPresent=false", async () => {
    const job = seedJob();
    const runId = seedRunningRow(job.id);

    const runner = createDosarSoapRunner({
      searchDosare: async () => [],
    });
    const out = await runner.run({
      job,
      runId,
      nowIso: NOW_ISO,
      signal: new AbortController().signal,
    });

    expect(out.status).toBe("ok");
    const snap = getLatestSnapshot(job.id);
    expect(snap).not.toBeNull();
    expect(JSON.parse(snap!.payload_json).lastDosarPresent).toBe(false);
  });
});

// Tier 5 #T1 (PR-4 hardening): atomic snapshot+alert boundary.
// Regression guard for C2: the runner persists the new snapshot AND emits
// alerts inside a single db.transaction(). If alert inserts fail mid-loop
// (disk-full, OS kill, FK violation), the snapshot must roll back too —
// otherwise the next tick diffs against the new snapshot and the missed
// alerts are silently dropped.
//
// Force-failure mechanism: a SQL trigger on monitoring_alerts that RAISE(FAIL)
// after the first insert for this job. Cleaner than module-mocking because it
// exercises the *real* transaction unwind path SQLite would use in prod.
describe("dosarSoapRunner — snapshot+alert atomic on partial failure (#T1)", () => {
  it("alert insert fails mid-loop → snapshot rolled back, 0 alerts persisted", async () => {
    const sedintaA = {
      complet: "C1",
      data: "2026-05-01",
      ora: "10:00",
      solutie: "",
      solutieSumar: "",
      documentSedinta: "",
      numarDocument: "",
      dataPronuntare: "",
    };
    const sedintaB = { ...sedintaA, complet: "C2", data: "2026-05-02" };

    let secondTick = false;
    const runner = createDosarSoapRunner({
      searchDosare: async () =>
        secondTick
          ? [makeDosar("1234/180/2024", [sedintaA, sedintaB])]
          : [makeDosar("1234/180/2024")],
    });

    const job = seedJob();
    const r1 = seedRunningRow(job.id);
    await runner.run({
      job,
      runId: r1,
      nowIso: NOW_ISO,
      signal: new AbortController().signal,
    });

    // Capture baseline snapshot id so we can prove it stays the latest after
    // the transactional rollback (vs. a new aborted snapshot leaking through).
    const baselineSnap = getLatestSnapshot(job.id);
    expect(baselineSnap).not.toBeNull();
    const baselineId = baselineSnap!.id;

    // Trigger fires AFTER the first INSERT for this job, so the *second*
    // alert insert raises. The transaction must unwind everything emitted
    // by this run — both the new snapshot AND the first alert.
    const triggerSql = [
      "CREATE TRIGGER fail_second_alert",
      "BEFORE INSERT ON monitoring_alerts",
      "FOR EACH ROW",
      "WHEN (SELECT COUNT(*) FROM monitoring_alerts WHERE job_id = NEW.job_id) >= 1",
      "BEGIN SELECT RAISE(FAIL, 'forced regression test failure'); END",
    ].join(" ");
    getDb().prepare(triggerSql).run();

    secondTick = true;
    const r2 = seedRunningRow(job.id);
    let threw = false;
    try {
      await runner.run({
        job,
        runId: r2,
        nowIso: "2026-04-28T10:05:00.000Z",
        signal: new AbortController().signal,
      });
    } catch {
      threw = true;
    }

    // Drop the trigger so cleanup has no side effects on later tests.
    getDb().prepare("DROP TRIGGER fail_second_alert").run();

    expect(threw).toBe(true);

    // Atomic boundary holds: latest snapshot is still the baseline (no new
    // snapshot row from the failed run), and 0 alerts persisted.
    const snapAfter = getLatestSnapshot(job.id);
    expect(snapAfter).not.toBeNull();
    expect(snapAfter!.id).toBe(baselineId);

    const alertCount = (
      getDb()
        .prepare(`SELECT COUNT(*) AS n FROM monitoring_alerts WHERE job_id = ?`)
        .get(job.id) as { n: number }
    ).n;
    expect(alertCount).toBe(0);
  });
});
