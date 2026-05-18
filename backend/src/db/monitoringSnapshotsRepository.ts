// Repository for monitoring_snapshots. Una singura per job — `deletePriorSnapshots`
// ruleaza in aceeasi tranzactie cu `insertSnapshot` (vezi runner-ele
// name_soap si dosar_soap), pentru ca jobul sa ramana cu exact 1 rand
// post-commit. Caller-ul citeste prev cu `getLatestSnapshot` IN AFARA
// tranzactiei si trece prin diff fara sa depinda de history persistat —
// snapshot-ul anterior ramane in scope-ul JS pana cand tranzactia se commit-eaza.
//
// Pre-v2.29.0: pastram cate o linie pentru fiecare tick (debug/replay) si
// purjam la 14 zile via retention sweep. Modelul nou (Design A, atomic
// delete + insert) elimina deadweight-ul fara sa pierdem corectitudinea
// diff-ului. Daca tranzactia da rollback (ex: insertAlert pica), DELETE-ul
// se ruleaza inapoi si jobul ramane cu baseline-ul anterior intact.

import { getDb } from "./schema.ts";
import { SNAPSHOT_PAYLOAD_MAX_BYTES } from "../services/monitoring/diff/types.ts";

export interface MonitoringSnapshotRow {
  id: number;
  owner_id: string;
  job_id: number;
  observed_at: string;
  payload_hash: string;
  payload_json: string;
  // Tier 3 #9 — run_id FK populated by the runner. Nullable: rows written
  // before migration 0004 retain NULL; ON DELETE SET NULL on the FK keeps
  // the snapshot when a run row is purged by retention.
  run_id: number | null;
}

export interface InsertSnapshotInput {
  ownerId: string;
  jobId: number;
  // The monitoring_runs.id row that produced this snapshot. Required on
  // every new write — the runner always has it in scope (passed via
  // JobRunner.run input). Going through `null` is reserved for a future
  // backfill helper, not a normal code path.
  runId: number;
  observedAt: string;
  payloadHash: string;
  payloadJson: string;
}

export function insertSnapshot(input: InsertSnapshotInput): number {
  // Constatare adversiala #1 (defense in depth) — runner-ul filtreaza deja
  // payload-urile oversize si emite SNAPSHOT_OVERSIZE inainte sa cheme aici.
  // Repo-ul reaplica plafonul ca nu cumva un alt apelator (replay backfill,
  // viitor runner) sa scrie un rand monstru; throw e mai sigur decat insert.
  const payloadBytes = Buffer.byteLength(input.payloadJson, "utf8");
  if (payloadBytes > SNAPSHOT_PAYLOAD_MAX_BYTES) {
    throw new Error(
      `insertSnapshot: payload ${payloadBytes}B exceeds cap ${SNAPSHOT_PAYLOAD_MAX_BYTES}B (job_id=${input.jobId})`
    );
  }

  // Constatare adversiala #2 — tenant-isolation guard simetric cu cel din
  // monitoringAlertsRepository.insertAlert. Refuza scrierea cand (jobId,
  // ownerId) nu se potrivesc in monitoring_jobs. Fara asta, un caller care
  // amesteca un jobId al altui tenant ar putea atasa un snapshot pe jobul
  // celuilalt, iar getLatestSnapshot(owner=A) l-ar returna in tickul urmator
  // — diff cross-tenant contaminat.
  const db = getDb();
  const jobOwner = db
    .prepare("SELECT 1 FROM monitoring_jobs WHERE id = ? AND owner_id = ?")
    .get(input.jobId, input.ownerId);
  if (!jobOwner) {
    throw new Error(`insertSnapshot: job ${input.jobId} not found for owner ${input.ownerId}`);
  }

  const info = db
    .prepare(
      `INSERT INTO monitoring_snapshots
         (owner_id, job_id, run_id, observed_at, payload_hash, payload_json)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(input.ownerId, input.jobId, input.runId, input.observedAt, input.payloadHash, input.payloadJson);
  return info.lastInsertRowid as number;
}

// Latest row by (observed_at DESC, id DESC). The id tiebreaker matters for
// jobs that tick faster than the timestamp's millisecond resolution can
// distinguish (PR-4 cadence is hours, but C5 manual-trigger lets a user fire
// a second run in the same millisecond, so we need a deterministic order).
export function getLatestSnapshot(ownerId: string, jobId: number): MonitoringSnapshotRow | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM monitoring_snapshots
       WHERE owner_id = ? AND job_id = ?
       ORDER BY observed_at DESC, id DESC
       LIMIT 1`
    )
    .get(ownerId, jobId) as MonitoringSnapshotRow | undefined;
  return row ?? null;
}

/**
 * Sterge toate snapshot-urile pentru `(ownerId, jobId)`.
 *
 * IMPORTANT: caller-ul TREBUIE sa invoce aceasta functie in aceeasi
 * `db.transaction(...)` cu `insertSnapshot(...)`, INAINTE de insert. Daca
 * tranzactia da rollback (ex: insertAlert pica), DELETE-ul se ruleaza
 * inapoi si jobul ramane cu baseline-ul anterior intact.
 *
 * Caller-ul citeste `prev` cu `getLatestSnapshot(...)` IN AFARA tranzactiei,
 * inainte sa cheme runner-ul de diff. Snapshot-ul anterior ramane in
 * memorie pana cand tranzactia se commit-eaza — DELETE-ul nu afecteaza
 * corectitudinea diff-ului.
 *
 * Modelul atomic (Design A) tine exact un rand per job in tabel, evitand
 * deadweight-ul vechi care necesita un retention sweep periodic.
 *
 * Logging-ul este deferred prin `queueMicrotask` pentru ca `console.log`
 * sincron este suficient de scump (flush stdout pe Windows) cat sa adauge
 * latenta in critical section-ul tranzactiei. Microtask-ul se executa
 * dupa ce stack-ul curent se goleste, deci dupa commit.
 *
 * @param ownerId tenant id (DEFAULT 'local')
 * @param jobId   monitoring_jobs.id
 * @returns numarul de randuri sterse (0 daca jobul nu avea baseline)
 */
export function deletePriorSnapshots(ownerId: string, jobId: number): number {
  const info = getDb()
    .prepare("DELETE FROM monitoring_snapshots WHERE owner_id = ? AND job_id = ?")
    .run(ownerId, jobId);
  const deletedCount = Number(info.changes);
  if (deletedCount > 0) {
    queueMicrotask(() => {
      console.log(
        JSON.stringify({
          action: "monitoring.snapshot_retention",
          owner_id: ownerId,
          job_id: jobId,
          deleted_count: deletedCount,
          ts: new Date().toISOString(),
        })
      );
    });
  }
  return deletedCount;
}
