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
import path from "path";
import os from "os";
import fsPromises from "fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  getLatestSnapshot,
  insertSnapshot,
} from "./monitoringSnapshotsRepository.ts";
import { closeDb, getDb } from "./schema.ts";

let tmpRoot: string;

const OWNER = "local";

function seedJob(hashSeed: string): number {
  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO monitoring_jobs
         (owner_id, kind, target_json, target_hash, cadence_sec,
          alert_config_json, next_run_at)
       VALUES (?, 'dosar_soap', '{}', ?, 14400, '{}', '2026-04-28T12:00:00.000Z')`,
    )
    .run(OWNER, hashSeed);
  return info.lastInsertRowid as number;
}

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-snap-"));
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

describe("insertSnapshot", () => {
  it("writes a row and returns its id", () => {
    const jobId = seedJob("h1");
    const id = insertSnapshot({
      ownerId: OWNER,
      jobId,
      observedAt: "2026-04-28T10:00:00.000Z",
      payloadHash: "deadbeef",
      payloadJson: '{"sedintaKeys":[]}',
    });
    expect(id).toBeGreaterThan(0);

    const row = getDb()
      .prepare(`SELECT * FROM monitoring_snapshots WHERE id = ?`)
      .get(id) as {
        owner_id: string;
        job_id: number;
        observed_at: string;
        payload_hash: string;
        payload_json: string;
      };
    expect(row.owner_id).toBe(OWNER);
    expect(row.job_id).toBe(jobId);
    expect(row.observed_at).toBe("2026-04-28T10:00:00.000Z");
    expect(row.payload_hash).toBe("deadbeef");
    expect(row.payload_json).toBe('{"sedintaKeys":[]}');
  });
});

describe("getLatestSnapshot", () => {
  it("returns null when no snapshot exists for the job", () => {
    const jobId = seedJob("h1");
    expect(getLatestSnapshot(jobId)).toBeNull();
  });

  it("returns the most recent snapshot (observed_at DESC)", () => {
    const jobId = seedJob("h1");
    insertSnapshot({
      ownerId: OWNER,
      jobId,
      observedAt: "2026-04-28T10:00:00.000Z",
      payloadHash: "older",
      payloadJson: '{"v":"old"}',
    });
    insertSnapshot({
      ownerId: OWNER,
      jobId,
      observedAt: "2026-04-28T11:00:00.000Z",
      payloadHash: "newer",
      payloadJson: '{"v":"new"}',
    });

    const latest = getLatestSnapshot(jobId);
    expect(latest).not.toBeNull();
    expect(latest!.payload_hash).toBe("newer");
    expect(latest!.payload_json).toBe('{"v":"new"}');
    expect(latest!.observed_at).toBe("2026-04-28T11:00:00.000Z");
  });

  it("scopes snapshots per job_id (no cross-job leak)", () => {
    const jobA = seedJob("hA");
    const jobB = seedJob("hB");
    insertSnapshot({
      ownerId: OWNER,
      jobId: jobA,
      observedAt: "2026-04-28T10:00:00.000Z",
      payloadHash: "for-A",
      payloadJson: '{"job":"A"}',
    });
    insertSnapshot({
      ownerId: OWNER,
      jobId: jobB,
      observedAt: "2026-04-28T11:00:00.000Z",
      payloadHash: "for-B",
      payloadJson: '{"job":"B"}',
    });

    const a = getLatestSnapshot(jobA);
    const b = getLatestSnapshot(jobB);
    expect(a!.payload_hash).toBe("for-A");
    expect(b!.payload_hash).toBe("for-B");
  });

  it("breaks observed_at ties by id DESC (newest insert wins)", () => {
    const jobId = seedJob("h1");
    const sameTs = "2026-04-28T10:00:00.000Z";
    insertSnapshot({
      ownerId: OWNER,
      jobId,
      observedAt: sameTs,
      payloadHash: "first",
      payloadJson: "{}",
    });
    insertSnapshot({
      ownerId: OWNER,
      jobId,
      observedAt: sameTs,
      payloadHash: "second",
      payloadJson: "{}",
    });

    expect(getLatestSnapshot(jobId)!.payload_hash).toBe("second");
  });
});
