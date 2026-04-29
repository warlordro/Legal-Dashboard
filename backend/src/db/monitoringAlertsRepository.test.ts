// Tests for monitoring_alerts repository.
//
// Contract:
//   - insertAlert is idempotent on (job_id, dedup_key) — same key returns the
//     existing row, never duplicates it.
//   - insertAlert refuses to write when (jobId, ownerId) do not belong together
//     (tenant-isolation guard against attaching alerts onto another tenant's
//     job, since UNIQUE(job_id, dedup_key) is NOT owner-scoped at the DB level).
//   - Readback after upsert is owner-scoped — even if a foreign-owner row
//     somehow exists for the same (job_id, dedup_key), insertAlert never
//     returns it.
//
// Both guards defend the file-header invariant ("Owner_id scoping is enforced
// on every query") that becomes load-bearing in PR-5/PR-6 (alerts UI) and
// PR-9 (web-mode multi-tenant). Migration 0005 will add a DB-level trigger as
// belt-and-suspenders; this test locks in the in-repo contract today.

import Database from "better-sqlite3";
import path from "path";
import os from "os";
import fsPromises from "fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { insertAlert } from "./monitoringAlertsRepository.ts";
import { closeDb, getDb } from "./schema.ts";

let tmpRoot: string;

const OWNER_A = "tenant-a";
const OWNER_B = "tenant-b";

function seedJob(ownerId: string, hashSeed: string): number {
  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO monitoring_jobs
         (owner_id, kind, target_json, target_hash, cadence_sec,
          alert_config_json, next_run_at)
       VALUES (?, 'dosar_soap', '{}', ?, 14400, '{}', '2026-04-28T12:00:00.000Z')`,
    )
    .run(ownerId, hashSeed);
  return info.lastInsertRowid as number;
}

function seedRun(ownerId: string, jobId: number): number {
  const info = getDb()
    .prepare(
      `INSERT INTO monitoring_runs (owner_id, job_id, started_at, status)
       VALUES (?, ?, ?, 'running')`,
    )
    .run(ownerId, jobId, "2026-04-28T10:00:00.000Z");
  return info.lastInsertRowid as number;
}

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-alerts-"));
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

describe("insertAlert", () => {
  it("writes a row and returns it on the happy path", () => {
    const jobId = seedJob(OWNER_A, "h1");
    const runId = seedRun(OWNER_A, jobId);
    const row = insertAlert({
      ownerId: OWNER_A,
      jobId,
      runId,
      kind: "dosar_new",
      severity: "info",
      title: "Dosar nou",
      detail: { foo: "bar" },
      dedupKey: "k1",
    });
    expect(row.id).toBeGreaterThan(0);
    expect(row.owner_id).toBe(OWNER_A);
    expect(row.job_id).toBe(jobId);
    expect(row.run_id).toBe(runId);
    expect(row.kind).toBe("dosar_new");
    expect(row.title).toBe("Dosar nou");
    expect(row.detail_json).toBe('{"foo":"bar"}');
    expect(row.dedup_key).toBe("k1");
  });

  it("is idempotent on (job_id, dedup_key) — second call returns the same row", () => {
    const jobId = seedJob(OWNER_A, "h1");
    const runId = seedRun(OWNER_A, jobId);
    const first = insertAlert({
      ownerId: OWNER_A,
      jobId,
      runId,
      kind: "dosar_new",
      title: "first",
      dedupKey: "same",
    });
    const second = insertAlert({
      ownerId: OWNER_A,
      jobId,
      runId,
      kind: "dosar_new",
      title: "second-ignored", // ON CONFLICT DO NOTHING, original wins
      dedupKey: "same",
    });
    expect(second.id).toBe(first.id);
    expect(second.title).toBe("first");

    const count = (
      getDb()
        .prepare(`SELECT COUNT(*) AS n FROM monitoring_alerts`)
        .get() as { n: number }
    ).n;
    expect(count).toBe(1);
  });

  it("refuses to insert when (jobId, ownerId) belong to different tenants", () => {
    const jobIdA = seedJob(OWNER_A, "hA");
    const runIdA = seedRun(OWNER_A, jobIdA);
    expect(() =>
      insertAlert({
        ownerId: OWNER_B, // wrong owner for jobIdA
        jobId: jobIdA,
        runId: runIdA,
        kind: "dosar_new",
        title: "cross-tenant attempt",
        dedupKey: "k1",
      }),
    ).toThrow(/not found for owner/);

    // Nothing was written.
    const count = (
      getDb()
        .prepare(`SELECT COUNT(*) AS n FROM monitoring_alerts`)
        .get() as { n: number }
    ).n;
    expect(count).toBe(0);
  });

  it("refuses to insert when jobId does not exist at all", () => {
    expect(() =>
      insertAlert({
        ownerId: OWNER_A,
        jobId: 99999,
        runId: 1,
        kind: "dosar_new",
        title: "ghost job",
        dedupKey: "k1",
      }),
    ).toThrow(/not found for owner/);
  });

  it("readback is owner-scoped: refuses to surface another tenant's row even if (job_id, dedup_key) collides", () => {
    // Set up jobs for two tenants and seed a foreign-owner row directly via
    // raw SQL. The pre-flight guard only validates (job, owner) pairing; the
    // readback owner-scoping is the second line of defense for the case where
    // a stale row exists with mismatched owner_id (e.g. legacy data, or a
    // future writer that bypasses the guard).
    const jobIdA = seedJob(OWNER_A, "hA");
    const runIdA = seedRun(OWNER_A, jobIdA);

    // Foreign row: owner_id=B but job_id=A's job. This violates the invariant
    // we want to protect — simulate it via raw SQL to exercise the readback.
    getDb()
      .prepare(
        `INSERT INTO monitoring_alerts
           (owner_id, job_id, run_id, kind, severity, title, detail_json, dedup_key)
         VALUES (?, ?, ?, 'dosar_new', 'info', 'foreign', '{}', 'collide')`,
      )
      .run(OWNER_B, jobIdA, runIdA);

    // Now owner-A tries to insert with the same dedup_key. The INSERT
    // ON CONFLICT DO NOTHING is a no-op (foreign row blocks it), and the
    // owner-scoped readback finds nothing for owner-A, so we throw rather
    // than silently returning the foreign row.
    expect(() =>
      insertAlert({
        ownerId: OWNER_A,
        jobId: jobIdA,
        runId: runIdA,
        kind: "dosar_new",
        title: "owner-A attempt",
        dedupKey: "collide",
      }),
    ).toThrow(/row missing after upsert/);
  });
});
