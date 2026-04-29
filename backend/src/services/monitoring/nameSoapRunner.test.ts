import Database from "better-sqlite3";
import path from "path";
import os from "os";
import fsPromises from "fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../../db/schema.ts";
import { getLatestSnapshot } from "../../db/monitoringSnapshotsRepository.ts";
import { createNameSoapRunner } from "./nameSoapRunner.ts";
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
       VALUES (?, 'name_soap', ?, ?, 14400, ?, '2026-04-28T12:00:00.000Z')`,
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
        }),
    );
  return db
    .prepare(`SELECT * FROM monitoring_jobs WHERE id = ?`)
    .get(info.lastInsertRowid) as ScheduledJob;
}

function seedRunningRow(jobId: number): number {
  getDb()
    .prepare(
      `UPDATE monitoring_runs
         SET status = 'aborted',
             ended_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE job_id = ? AND status = 'running'`,
    )
    .run(jobId);
  const info = getDb()
    .prepare(
      `INSERT INTO monitoring_runs (owner_id, job_id, started_at, status)
       VALUES (?, ?, ?, 'running')`,
    )
    .run(OWNER, jobId, NOW_ISO);
  return info.lastInsertRowid as number;
}

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-name-runner-"));
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

function makeDosar(
  numar: string,
  stadiuProcesual = "fond",
  categorieCaz = "civil",
  institutie = "Judecatoria Test",
): Dosar {
  return {
    numar,
    data: "2024-01-15",
    institutie,
    departament: "",
    categorieCaz,
    stadiuProcesual,
    obiect: "test",
    parti: [],
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
        secondTick
          ? [makeDosar("1234/180/2024"), makeDosar("999/1/2025")]
          : [makeDosar("1234/180/2024")],
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
    expect(alerts).toEqual([
      { kind: "dosar_new", dedup_key: "name_soap|999/1/2025|dosar_new" },
    ]);
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
        secondTick
          ? [makeDosar("1234/180/2024", "apel")]
          : [makeDosar("1234/180/2024", "fond")],
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
