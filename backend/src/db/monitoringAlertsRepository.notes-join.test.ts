import Database from "better-sqlite3";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { insertAlert, listAlerts } from "./monitoringAlertsRepository.ts";
import { closeDb, getDb } from "./schema.ts";

let tmpRoot: string;
const OWNER = "tenant-notes";

function seedJob(notes: string | null): number {
  const info = getDb()
    .prepare(
      `INSERT INTO monitoring_jobs
         (owner_id, kind, target_json, target_hash, cadence_sec,
          alert_config_json, next_run_at, notes)
       VALUES (?, 'dosar_soap', '{}', ?, 14400, '{}', '2026-05-14T12:00:00.000Z', ?)`
    )
    .run(OWNER, `hash-${Math.random()}`, notes);
  return info.lastInsertRowid as number;
}

function seedRun(jobId: number): number {
  const info = getDb()
    .prepare(
      `INSERT INTO monitoring_runs (owner_id, job_id, started_at, status)
       VALUES (?, ?, ?, 'running')`
    )
    .run(OWNER, jobId, "2026-05-14T10:00:00.000Z");
  return info.lastInsertRowid as number;
}

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-notes-join-"));
  process.env.LEGAL_DASHBOARD_DB_PATH = path.join(tmpRoot, "legal-dashboard.db");
  new Database(process.env.LEGAL_DASHBOARD_DB_PATH).close();
  getDb();
});

afterEach(async () => {
  closeDb();
  // biome-ignore lint/performance/noDelete: process.env trebuie unset real, nu valoare undefined.
  delete process.env.LEGAL_DASHBOARD_DB_PATH;
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

describe("listAlerts - job_notes propagare", () => {
  it("returneaza job.notes pentru alerta atasata jobului cu notita", () => {
    const jobId = seedJob("Client VIP - anunta inainte de termen");
    const runId = seedRun(jobId);

    insertAlert({
      ownerId: OWNER,
      jobId,
      runId,
      kind: "termen_new",
      severity: "info",
      title: "Termen nou",
      dedupKey: "k1",
    });

    const result = listAlerts({ ownerId: OWNER, page: 1, pageSize: 10 });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].job_notes).toBe("Client VIP - anunta inainte de termen");
  });

  it("returneaza null cand jobul nu are notita", () => {
    const jobId = seedJob(null);
    const runId = seedRun(jobId);

    insertAlert({
      ownerId: OWNER,
      jobId,
      runId,
      kind: "termen_new",
      severity: "info",
      title: "T",
      dedupKey: "k2",
    });

    const result = listAlerts({ ownerId: OWNER, page: 1, pageSize: 10 });

    expect(result.rows[0].job_notes).toBeNull();
  });
});
