// Repository for monitoring_snapshots (PR-4). One row per observed payload
// per job — the diff engine reads the latest row, computes alerts against
// the current SOAP response, and persists the new payload. Old rows are
// retained for debug/replay; PR-12's retention sweep will trim them.
//
// Why a separate row per observation (vs. UPSERT on job_id): keeping history
// makes "why was this alert emitted?" investigations possible — you can
// replay diff(prev, current) for any pair of snapshots offline. Storage is
// trivial (canonicalized JSON, sub-kilobyte per snapshot, deleted on cadence).

import { getDb } from "./schema.ts";

export interface MonitoringSnapshotRow {
  id: number;
  owner_id: string;
  job_id: number;
  observed_at: string;
  payload_hash: string;
  payload_json: string;
}

export interface InsertSnapshotInput {
  ownerId: string;
  jobId: number;
  observedAt: string;
  payloadHash: string;
  payloadJson: string;
}

export function insertSnapshot(input: InsertSnapshotInput): number {
  const info = getDb()
    .prepare(
      `INSERT INTO monitoring_snapshots
         (owner_id, job_id, observed_at, payload_hash, payload_json)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      input.ownerId,
      input.jobId,
      input.observedAt,
      input.payloadHash,
      input.payloadJson,
    );
  return info.lastInsertRowid as number;
}

// Latest row by (observed_at DESC, id DESC). The id tiebreaker matters for
// jobs that tick faster than the timestamp's millisecond resolution can
// distinguish (PR-4 cadence is hours, but C5 manual-trigger lets a user fire
// a second run in the same millisecond, so we need a deterministic order).
export function getLatestSnapshot(
  jobId: number,
): MonitoringSnapshotRow | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM monitoring_snapshots
       WHERE job_id = ?
       ORDER BY observed_at DESC, id DESC
       LIMIT 1`,
    )
    .get(jobId) as MonitoringSnapshotRow | undefined;
  return row ?? null;
}
