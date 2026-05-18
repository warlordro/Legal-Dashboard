// Tests for monitoring_snapshots repository.
//
// Contract:
//   - insertSnapshot writes a row, returns its id
//   - getLatestSnapshot returns null when no snapshot exists for the job
//   - getLatestSnapshot returns the most recent row (observed_at DESC, id DESC tiebreaker)
//   - Snapshots are scoped per job_id (job A snapshots don't leak into job B)
//   - payload_hash and payload_json round-trip exactly (no normalization)
//
// The runner consumes this repo: load latest → diff → insert new. The diff
// engine itself is pure (services/monitoring/diff.ts); the repo is the only
// place raw SQL touches the snapshots table per CLAUDE.md raw-SQL rule.

import Database from "better-sqlite3";
import path from "node:path";
import os from "node:os";
import fsPromises from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { deletePriorSnapshots, getLatestSnapshot, insertSnapshot } from "./monitoringSnapshotsRepository.ts";
import { closeDb, getDb } from "./schema.ts";

let tmpRoot: string;

const OWNER = "local";

function seedJob(hashSeed: string, ownerId = OWNER): number {
  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO monitoring_jobs
         (owner_id, kind, target_json, target_hash, cadence_sec,
          alert_config_json, next_run_at)
       VALUES (?, 'dosar_soap', '{}', ?, 14400, '{}', '2026-04-28T12:00:00.000Z')`
    )
    .run(ownerId, hashSeed);
  return info.lastInsertRowid as number;
}

// Tier 3 #9: every snapshot now carries a run_id FK. Tests seed a running
// row per job so the FK resolves and the constraint can be exercised.
function seedRun(jobId: number, ownerId = OWNER): number {
  const info = getDb()
    .prepare(
      `INSERT INTO monitoring_runs (owner_id, job_id, started_at, status)
       VALUES (?, ?, ?, 'running')`
    )
    .run(ownerId, jobId, "2026-04-28T10:00:00.000Z");
  return info.lastInsertRowid as number;
}

function countSnapshots(ownerId: string, jobId: number): number {
  return (
    getDb()
      .prepare("SELECT COUNT(*) AS n FROM monitoring_snapshots WHERE owner_id = ? AND job_id = ?")
      .get(ownerId, jobId) as { n: number }
  ).n;
}

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-snap-"));
  process.env.LEGAL_DASHBOARD_DB_PATH = path.join(tmpRoot, "legal-dashboard.db");
  const seed = new Database(process.env.LEGAL_DASHBOARD_DB_PATH);
  seed.close();
  getDb();
});

afterEach(async () => {
  vi.restoreAllMocks();
  closeDb();
  // biome-ignore lint/performance/noDelete: process.env trebuie unset real, nu valoare undefined.
  delete process.env.LEGAL_DASHBOARD_DB_PATH;
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

describe("insertSnapshot", () => {
  it("writes a row and returns its id", () => {
    const jobId = seedJob("h1");
    const runId = seedRun(jobId);
    const id = insertSnapshot({
      ownerId: OWNER,
      jobId,
      runId,
      observedAt: "2026-04-28T10:00:00.000Z",
      payloadHash: "deadbeef",
      payloadJson: '{"sedintaKeys":[]}',
    });
    expect(id).toBeGreaterThan(0);

    const row = getDb().prepare("SELECT * FROM monitoring_snapshots WHERE id = ?").get(id) as {
      owner_id: string;
      job_id: number;
      run_id: number;
      observed_at: string;
      payload_hash: string;
      payload_json: string;
    };
    expect(row.owner_id).toBe(OWNER);
    expect(row.job_id).toBe(jobId);
    expect(row.run_id).toBe(runId);
    expect(row.observed_at).toBe("2026-04-28T10:00:00.000Z");
    expect(row.payload_hash).toBe("deadbeef");
    expect(row.payload_json).toBe('{"sedintaKeys":[]}');
  });

  // Tier 3 #9: PRAGMA foreign_keys=ON is set in schema.ts; an INSERT with a
  // run_id pointing at a non-existent monitoring_runs row must be rejected.
  // This is the regression-guard against accidentally adding an unenforced
  // column (which would defeat the whole point of #9).
  it("rejects inserts with a run_id that doesn't point to an existing run", () => {
    const jobId = seedJob("h1");
    expect(() =>
      insertSnapshot({
        ownerId: OWNER,
        jobId,
        runId: 99999, // no row with this id
        observedAt: "2026-04-28T10:00:00.000Z",
        payloadHash: "x",
        payloadJson: "{}",
      })
    ).toThrow(/FOREIGN KEY/i);
  });

  it("preserves the snapshot when its run row is deleted (ON DELETE SET NULL)", () => {
    const jobId = seedJob("h1");
    const runId = seedRun(jobId);
    const id = insertSnapshot({
      ownerId: OWNER,
      jobId,
      runId,
      observedAt: "2026-04-28T10:00:00.000Z",
      payloadHash: "x",
      payloadJson: "{}",
    });
    getDb().prepare("DELETE FROM monitoring_runs WHERE id = ?").run(runId);
    const row = getDb().prepare("SELECT run_id FROM monitoring_snapshots WHERE id = ?").get(id) as {
      run_id: number | null;
    };
    expect(row.run_id).toBeNull();
  });

  // Constatare adversiala #2 — tenant-isolation guard simetric cu insertAlert.
  // Fara guard, un caller care primeste un job_id al altui tenant ar putea
  // atasa un snapshot in numele lui, iar getLatestSnapshot(owner=A) l-ar
  // returna in tickul urmator -> diff cross-tenant contaminat.
  it("refuses to insert when (jobId, ownerId) belong to different tenants", () => {
    const ownerA = "tenant-a";
    const ownerB = "tenant-b";
    const jobIdA = getDb()
      .prepare(
        `INSERT INTO monitoring_jobs
           (owner_id, kind, target_json, target_hash, cadence_sec,
            alert_config_json, next_run_at)
         VALUES (?, 'dosar_soap', '{}', ?, 14400, '{}', '2026-04-28T12:00:00.000Z')`
      )
      .run(ownerA, "hA").lastInsertRowid as number;
    const runIdA = getDb()
      .prepare(
        `INSERT INTO monitoring_runs (owner_id, job_id, started_at, status)
         VALUES (?, ?, ?, 'running')`
      )
      .run(ownerA, jobIdA, "2026-04-28T10:00:00.000Z").lastInsertRowid as number;

    expect(() =>
      insertSnapshot({
        ownerId: ownerB, // wrong owner for jobIdA
        jobId: jobIdA,
        runId: runIdA,
        observedAt: "2026-04-28T10:00:00.000Z",
        payloadHash: "cross-tenant",
        payloadJson: "{}",
      })
    ).toThrow(/not found for owner/);

    const count = (getDb().prepare("SELECT COUNT(*) AS n FROM monitoring_snapshots").get() as { n: number }).n;
    expect(count).toBe(0);
  });

  it("refuses to insert when jobId does not exist at all", () => {
    expect(() =>
      insertSnapshot({
        ownerId: OWNER,
        jobId: 99999,
        runId: 1,
        observedAt: "2026-04-28T10:00:00.000Z",
        payloadHash: "ghost",
        payloadJson: "{}",
      })
    ).toThrow(/not found for owner/);
  });
});

describe("getLatestSnapshot", () => {
  it("returns null when no snapshot exists for the job", () => {
    const jobId = seedJob("h1");
    expect(getLatestSnapshot(OWNER, jobId)).toBeNull();
  });

  it("returns the most recent snapshot (observed_at DESC)", () => {
    const jobId = seedJob("h1");
    const runId = seedRun(jobId);
    insertSnapshot({
      ownerId: OWNER,
      jobId,
      runId,
      observedAt: "2026-04-28T10:00:00.000Z",
      payloadHash: "older",
      payloadJson: '{"v":"old"}',
    });
    insertSnapshot({
      ownerId: OWNER,
      jobId,
      runId,
      observedAt: "2026-04-28T11:00:00.000Z",
      payloadHash: "newer",
      payloadJson: '{"v":"new"}',
    });

    const latest = getLatestSnapshot(OWNER, jobId);
    expect(latest).not.toBeNull();
    expect(latest!.payload_hash).toBe("newer");
    expect(latest!.payload_json).toBe('{"v":"new"}');
    expect(latest!.observed_at).toBe("2026-04-28T11:00:00.000Z");
  });

  it("scopes snapshots per job_id (no cross-job leak)", () => {
    const jobA = seedJob("hA");
    const jobB = seedJob("hB");
    const runA = seedRun(jobA);
    const runB = seedRun(jobB);
    insertSnapshot({
      ownerId: OWNER,
      jobId: jobA,
      runId: runA,
      observedAt: "2026-04-28T10:00:00.000Z",
      payloadHash: "for-A",
      payloadJson: '{"job":"A"}',
    });
    insertSnapshot({
      ownerId: OWNER,
      jobId: jobB,
      runId: runB,
      observedAt: "2026-04-28T11:00:00.000Z",
      payloadHash: "for-B",
      payloadJson: '{"job":"B"}',
    });

    const a = getLatestSnapshot(OWNER, jobA);
    const b = getLatestSnapshot(OWNER, jobB);
    expect(a!.payload_hash).toBe("for-A");
    expect(b!.payload_hash).toBe("for-B");
  });

  it("breaks observed_at ties by id DESC (newest insert wins)", () => {
    const jobId = seedJob("h1");
    const runId = seedRun(jobId);
    const sameTs = "2026-04-28T10:00:00.000Z";
    insertSnapshot({
      ownerId: OWNER,
      jobId,
      runId,
      observedAt: sameTs,
      payloadHash: "first",
      payloadJson: "{}",
    });
    insertSnapshot({
      ownerId: OWNER,
      jobId,
      runId,
      observedAt: sameTs,
      payloadHash: "second",
      payloadJson: "{}",
    });

    expect(getLatestSnapshot(OWNER, jobId)!.payload_hash).toBe("second");
  });

  it("ignores snapshots whose owner_id does not match the requested owner", () => {
    const jobId = seedJob("h1");
    const runId = seedRun(jobId);
    insertSnapshot({
      ownerId: OWNER,
      jobId,
      runId,
      observedAt: "2026-04-28T10:00:00.000Z",
      payloadHash: "owned",
      payloadJson: "{}",
    });
    getDb()
      .prepare(
        `INSERT INTO monitoring_snapshots
           (owner_id, job_id, run_id, observed_at, payload_hash, payload_json)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run("other-owner", jobId, runId, "2026-04-28T11:00:00.000Z", "foreign-owner-newer", "{}");

    expect(getLatestSnapshot(OWNER, jobId)!.payload_hash).toBe("owned");
  });
});

describe("deletePriorSnapshots", () => {
  it("returns 0 and does not log when the job has no snapshots", () => {
    const jobId = seedJob("empty");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    expect(deletePriorSnapshots(OWNER, jobId)).toBe(0);

    expect(logSpy).not.toHaveBeenCalled();
    expect(countSnapshots(OWNER, jobId)).toBe(0);
  });

  it("deletes all rows for (owner_id, job_id), returns the count and logs retention JSON", () => {
    const jobId = seedJob("delete-count");
    const runId = seedRun(jobId);
    for (let i = 0; i < 5; i++) {
      insertSnapshot({
        ownerId: OWNER,
        jobId,
        runId,
        observedAt: `2026-04-28T10:0${i}:00.000Z`,
        payloadHash: `h${i}`,
        payloadJson: `{"i":${i}}`,
      });
    }
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    expect(deletePriorSnapshots(OWNER, jobId)).toBe(5);

    expect(countSnapshots(OWNER, jobId)).toBe(0);
    expect(logSpy).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
      action: string;
      owner_id: string;
      job_id: number;
      deleted_count: number;
      ts: string;
    };
    expect(entry).toMatchObject({
      action: "monitoring.snapshot_retention",
      owner_id: OWNER,
      job_id: jobId,
      deleted_count: 5,
    });
    expect(entry.ts).toEqual(expect.any(String));
  });

  it("does not touch snapshots for other jobs or owners", () => {
    const jobA = seedJob("job-a");
    const jobB = seedJob("job-b");
    const otherOwner = "other-owner";
    const otherJob = seedJob("other-job", otherOwner);
    const runA = seedRun(jobA);
    const runB = seedRun(jobB);
    const otherRun = seedRun(otherJob, otherOwner);
    for (const [jobId, runId, ownerId, payloadHash] of [
      [jobA, runA, OWNER, "job-a-1"],
      [jobA, runA, OWNER, "job-a-2"],
      [jobB, runB, OWNER, "job-b-1"],
      [otherJob, otherRun, otherOwner, "other-job-1"],
    ] as Array<[number, number, string, string]>) {
      insertSnapshot({
        ownerId,
        jobId,
        runId,
        observedAt: "2026-04-28T10:00:00.000Z",
        payloadHash,
        payloadJson: "{}",
      });
    }

    expect(deletePriorSnapshots(OWNER, jobA)).toBe(2);

    expect(countSnapshots(OWNER, jobA)).toBe(0);
    expect(countSnapshots(OWNER, jobB)).toBe(1);
    expect(countSnapshots(otherOwner, otherJob)).toBe(1);
  });

  it("commits DELETE + INSERT atomically inside a composed transaction", () => {
    const jobId = seedJob("atomic-commit");
    const runId = seedRun(jobId);
    insertSnapshot({
      ownerId: OWNER,
      jobId,
      runId,
      observedAt: "2026-04-28T10:00:00.000Z",
      payloadHash: "old-1",
      payloadJson: '{"v":"old-1"}',
    });
    insertSnapshot({
      ownerId: OWNER,
      jobId,
      runId,
      observedAt: "2026-04-28T10:01:00.000Z",
      payloadHash: "old-2",
      payloadJson: '{"v":"old-2"}',
    });

    getDb().transaction(() => {
      deletePriorSnapshots(OWNER, jobId);
      insertSnapshot({
        ownerId: OWNER,
        jobId,
        runId,
        observedAt: "2026-04-28T10:02:00.000Z",
        payloadHash: "new",
        payloadJson: '{"v":"new"}',
      });
    })();

    expect(countSnapshots(OWNER, jobId)).toBe(1);
    expect(getLatestSnapshot(OWNER, jobId)?.payload_hash).toBe("new");
  });

  it("rolls back DELETE + INSERT when the composed transaction throws", () => {
    const jobId = seedJob("atomic-rollback");
    const runId = seedRun(jobId);
    insertSnapshot({
      ownerId: OWNER,
      jobId,
      runId,
      observedAt: "2026-04-28T10:00:00.000Z",
      payloadHash: "old-1",
      payloadJson: '{"v":"old-1"}',
    });
    insertSnapshot({
      ownerId: OWNER,
      jobId,
      runId,
      observedAt: "2026-04-28T10:01:00.000Z",
      payloadHash: "old-2",
      payloadJson: '{"v":"old-2"}',
    });

    expect(() =>
      getDb().transaction(() => {
        deletePriorSnapshots(OWNER, jobId);
        insertSnapshot({
          ownerId: OWNER,
          jobId,
          runId,
          observedAt: "2026-04-28T10:02:00.000Z",
          payloadHash: "new",
          payloadJson: '{"v":"new"}',
        });
        throw new Error("forced rollback");
      })()
    ).toThrow(/forced rollback/);

    expect(countSnapshots(OWNER, jobId)).toBe(2);
    expect(getLatestSnapshot(OWNER, jobId)?.payload_hash).toBe("old-2");
  });
});
