// iccjRunner — monitoring glue between scheduler ↔ ICCJ live-proxy ↔ diff ↔ DB.
//
// Focus: the ICCJ-specific behaviors layered on the shared diff/snapshot/alert
// machinery (which dosarSoapRunner.test.ts already covers in depth):
//   - happy path: baseline snapshot persisted, status ok
//   - FALSE-EMPTY GUARD (Codex #3): fetch throws (IccjSourceError) → status
//     'error'/ICCJ_FAIL, NO snapshot written (never mistaken for "disappeared")
//   - genuine "not found": fetch returns null → snapshot lastDosarPresent=false
//   - diff across two ticks emits a termen_new alert

import path from "node:path";
import os from "node:os";
import fsPromises from "node:fs/promises";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../../db/schema.ts";
import { getLatestSnapshot } from "../../db/monitoringSnapshotsRepository.ts";
import { createIccjRunner } from "./iccjRunner.ts";
import { IccjSourceError } from "../iccj/iccjClient.ts";
import type { ScheduledJob } from "./scheduler.ts";
import type { Dosar } from "../../soap.ts";

let tmpRoot: string;
const OWNER = "local";
const NOW_ISO = "2026-06-06T10:00:00.000Z";
let _hashCounter = 0;

function seedIccjJob(): ScheduledJob {
  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO monitoring_jobs (owner_id, kind, target_json, target_hash, cadence_sec, alert_config_json, next_run_at)
       VALUES (?, 'iccj', ?, ?, 14400, ?, '2026-06-06T12:00:00.000Z')`
    )
    .run(
      OWNER,
      '{"numar_dosar":"1085/1/2026"}',
      `hash-${++_hashCounter}`,
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
      "UPDATE monitoring_runs SET status='aborted', ended_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE job_id=? AND status='running'"
    )
    .run(jobId);
  return getDb()
    .prepare("INSERT INTO monitoring_runs (owner_id, job_id, started_at, status) VALUES (?, ?, ?, 'running')")
    .run(OWNER, jobId, NOW_ISO).lastInsertRowid as number;
}

function makeDosar(numar: string, sedinte: Dosar["sedinte"] = []): Dosar {
  return {
    numar,
    data: "04.06.2026",
    institutie: "Inalta Curte de Casatie si Justitie",
    departament: "Sectia Penala",
    categorieCaz: "penal",
    stadiuProcesual: "Recurs",
    obiect: "test",
    parti: [],
    sedinte,
  };
}

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-iccj-runner-"));
  process.env.LEGAL_DASHBOARD_DB_PATH = path.join(tmpRoot, "legal-dashboard.db");
  new Database(process.env.LEGAL_DASHBOARD_DB_PATH).close();
  getDb();
});

afterEach(async () => {
  closeDb();
  // biome-ignore lint/performance/noDelete: process.env trebuie unset real.
  delete process.env.LEGAL_DASHBOARD_DB_PATH;
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

describe("iccjRunner — happy path", () => {
  it("baseline snapshot persisted, no alerts", async () => {
    const job = seedIccjJob();
    const runId = seedRunningRow(job.id);
    const runner = createIccjRunner({ fetchCurrentDosar: async () => makeDosar("1085/1/2026") });
    const out = await runner.run({ job, runId, nowIso: NOW_ISO, signal: new AbortController().signal });
    expect(out.status).toBe("ok");
    expect(out.alertsCreated).toBe(0);
    const snap = getLatestSnapshot(job.owner_id, job.id);
    expect(snap).not.toBeNull();
    expect(JSON.parse(snap!.payload_json).lastDosarPresent).toBe(true);
  });
});

describe("iccjRunner — false-empty guard (Codex #3)", () => {
  it("fetch throws IccjSourceError → status error/ICCJ_FAIL, NO snapshot written", async () => {
    const job = seedIccjJob();
    const runId = seedRunningRow(job.id);
    const runner = createIccjRunner({
      fetchCurrentDosar: async () => {
        throw new IccjSourceError("ambiguous empty/error after session refresh");
      },
    });
    const out = await runner.run({ job, runId, nowIso: NOW_ISO, signal: new AbortController().signal });
    expect(out.status).toBe("error");
    expect(out.errorCode).toBe("ICCJ_FAIL");
    // The critical guard: a source failure NEVER writes a (false-empty) snapshot.
    expect(getLatestSnapshot(job.owner_id, job.id)).toBeNull();
  });
});

describe("iccjRunner — genuine not-found", () => {
  it("fetch returns null → snapshot lastDosarPresent=false", async () => {
    const job = seedIccjJob();
    const runId = seedRunningRow(job.id);
    const runner = createIccjRunner({ fetchCurrentDosar: async () => null });
    const out = await runner.run({ job, runId, nowIso: NOW_ISO, signal: new AbortController().signal });
    expect(out.status).toBe("ok");
    const snap = getLatestSnapshot(job.owner_id, job.id);
    expect(snap).not.toBeNull();
    expect(JSON.parse(snap!.payload_json).lastDosarPresent).toBe(false);
  });
});

describe("iccjRunner — diff emits alerts", () => {
  it("new termen between ticks → termen_new alert persisted", async () => {
    const sedinta = {
      complet: "CC5-NCPC",
      data: "2026-06-20",
      ora: "10:00",
      solutie: "",
      solutieSumar: "",
      documentSedinta: "",
      numarDocument: "",
      dataPronuntare: "",
    };
    let withSedinta = false;
    const runner = createIccjRunner({
      fetchCurrentDosar: async () => (withSedinta ? makeDosar("1085/1/2026", [sedinta]) : makeDosar("1085/1/2026")),
    });
    const job = seedIccjJob();
    await runner.run({ job, runId: seedRunningRow(job.id), nowIso: NOW_ISO, signal: new AbortController().signal });
    withSedinta = true;
    const second = await runner.run({
      job,
      runId: seedRunningRow(job.id),
      nowIso: "2026-06-06T10:05:00.000Z",
      signal: new AbortController().signal,
    });
    expect(second.status).toBe("ok");
    const alerts = getDb().prepare("SELECT kind FROM monitoring_alerts WHERE job_id = ?").all(job.id) as {
      kind: string;
    }[];
    expect(alerts.some((a) => a.kind === "termen_new")).toBe(true);
  });
});
