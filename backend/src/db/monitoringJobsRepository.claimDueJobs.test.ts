// Tests for the scheduler's atomic claim path: claimDueJobs(now, limit).
//
// Contract:
//   - Returns up to `limit` jobs where:
//       * active = 1
//       * paused_until IS NULL OR paused_until <= now
//       * next_run_at <= now
//       * NO `monitoring_runs` row exists with status='running' for that job
//         (lease semantics — prevents double-claim across ticks)
//   - For every claimed job, inserts a `monitoring_runs` row with
//     status='running' and started_at=now, atomically with the SELECT, so
//     two concurrent claim() calls on the same DB never claim the same job.
//   - Atomic = `BEGIN IMMEDIATE` (write-lock acquired up front), NOT the
//     better-sqlite3 default `BEGIN DEFERRED` which has a TOCTOU window
//     between SELECT and INSERT.
//   - Returned shape: { job: MonitoringJobRow, runId: number }[]
//
// The "no two callers claim same job" test runs claim() in two separate
// db connections to simulate concurrency (better-sqlite3 within one process
// is serial, but BEGIN IMMEDIATE on connection A blocks connection B until
// commit — same effect as cross-process locking on the SQLite file).

import Database from "better-sqlite3";
import path from "path";
import os from "os";
import fsPromises from "fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { claimDueJobs, markJobOutcome } from "./monitoringJobsRepository.ts";
import { setMonitoringEnabled } from "./ownerMonitoringSettingsRepository.ts";
import { closeDb, getDb } from "./schema.ts";
import type { JobKind } from "../schemas/monitoring.ts";

let tmpRoot: string;
let dbPath: string;

const OWNER = "local";

function seedJob(opts: {
  nextRunAt: string;
  active?: number;
  pausedUntil?: string | null;
  hashSeed?: string;
  kind?: JobKind;
}): number {
  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO monitoring_jobs
         (owner_id, kind, target_json, target_hash, cadence_sec,
          alert_config_json, next_run_at, active, paused_until)
       VALUES (?, ?, '{}', ?, 14400, '{}', ?, ?, ?)`
    )
    .run(
      OWNER,
      opts.kind ?? "dosar_soap",
      opts.hashSeed ?? `hash-${Math.random()}`,
      opts.nextRunAt,
      opts.active ?? 1,
      opts.pausedUntil ?? null
    );
  return info.lastInsertRowid as number;
}

function seedRunning(jobId: number): void {
  getDb()
    .prepare(
      `INSERT INTO monitoring_runs (owner_id, job_id, started_at, status)
       VALUES (?, ?, '2026-04-28T09:00:00.000Z', 'running')`
    )
    .run(OWNER, jobId);
}

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-claim-"));
  dbPath = path.join(tmpRoot, "legal-dashboard.db");
  process.env.LEGAL_DASHBOARD_DB_PATH = dbPath;
  const seed = new Database(dbPath);
  seed.close();
  getDb();
});

afterEach(async () => {
  closeDb();
  delete process.env.LEGAL_DASHBOARD_DB_PATH;
  delete process.env.MONITORING_DISABLED_KINDS;
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

const NOW = "2026-04-28T10:00:00.000Z";

describe("claimDueJobs — selection", () => {
  it("claims a single due active unpaused job", () => {
    const id = seedJob({ nextRunAt: "2026-04-28T09:00:00.000Z" });
    const claimed = claimDueJobs({ now: NOW, limit: 10 });
    expect(claimed.length).toBe(1);
    expect(claimed[0]!.job.id).toBe(id);
    expect(claimed[0]!.runId).toBeGreaterThan(0);
  });

  it("does NOT claim jobs whose next_run_at is in the future", () => {
    seedJob({ nextRunAt: "2026-04-28T11:00:00.000Z" });
    const claimed = claimDueJobs({ now: NOW, limit: 10 });
    expect(claimed.length).toBe(0);
  });

  it("does NOT claim inactive jobs even when due", () => {
    seedJob({ nextRunAt: "2026-04-28T09:00:00.000Z", active: 0 });
    const claimed = claimDueJobs({ now: NOW, limit: 10 });
    expect(claimed.length).toBe(0);
  });

  it("does NOT claim jobs paused beyond now", () => {
    seedJob({
      nextRunAt: "2026-04-28T09:00:00.000Z",
      pausedUntil: "2026-04-28T12:00:00.000Z",
    });
    const claimed = claimDueJobs({ now: NOW, limit: 10 });
    expect(claimed.length).toBe(0);
  });

  it("DOES claim jobs whose pause expired before now", () => {
    seedJob({
      nextRunAt: "2026-04-28T09:00:00.000Z",
      pausedUntil: "2026-04-28T09:30:00.000Z",
    });
    const claimed = claimDueJobs({ now: NOW, limit: 10 });
    expect(claimed.length).toBe(1);
  });

  it("does NOT claim jobs that already have a running run row", () => {
    const id = seedJob({ nextRunAt: "2026-04-28T09:00:00.000Z" });
    seedRunning(id);
    const claimed = claimDueJobs({ now: NOW, limit: 10 });
    expect(claimed.length).toBe(0);
  });

  it("does NOT claim jobs whose kind is disabled by MONITORING_DISABLED_KINDS", () => {
    const dosarId = seedJob({
      nextRunAt: "2026-04-28T09:00:00.000Z",
      hashSeed: "h-dosar",
      kind: "dosar_soap",
    });
    seedJob({
      nextRunAt: "2026-04-28T09:00:00.000Z",
      hashSeed: "h-name",
      kind: "name_soap",
    });
    seedJob({
      nextRunAt: "2026-04-28T09:00:00.000Z",
      hashSeed: "h-rnpm",
      kind: "aviz_rnpm",
    });

    process.env.MONITORING_DISABLED_KINDS = " name_soap, aviz_rnpm ";

    const claimed = claimDueJobs({ now: NOW, limit: 10 });
    expect(claimed.map((r) => r.job.id)).toEqual([dosarId]);
  });
});

// Tier 4 #14 (rezolvare adversiala #3) — enabledKinds restrange claim-ul
// la kindurile pentru care scheduler-ul are runner inregistrat. Caz fail-safe
// critic: array gol = niciun runner = NU se atinge DB-ul (altfel s-ar marca
// runuri 'running' fara executor, devenind orphan pana la recoverOrphanRuns).
describe("claimDueJobs — enabledKinds filter", () => {
  it("claims only kinds present in enabledKinds when provided", () => {
    const dosarId = seedJob({
      nextRunAt: "2026-04-28T09:00:00.000Z",
      hashSeed: "h-dosar",
      kind: "dosar_soap",
    });
    seedJob({
      nextRunAt: "2026-04-28T09:00:00.000Z",
      hashSeed: "h-name",
      kind: "name_soap",
    });
    seedJob({
      nextRunAt: "2026-04-28T09:00:00.000Z",
      hashSeed: "h-rnpm",
      kind: "aviz_rnpm",
    });

    const claimed = claimDueJobs({
      now: NOW,
      limit: 10,
      enabledKinds: ["dosar_soap"],
    });
    expect(claimed.map((r) => r.job.id)).toEqual([dosarId]);
  });

  it("claims nothing when enabledKinds is an empty array (no runner registered)", () => {
    seedJob({ nextRunAt: "2026-04-28T09:00:00.000Z", kind: "dosar_soap" });
    const claimed = claimDueJobs({ now: NOW, limit: 10, enabledKinds: [] });
    expect(claimed.length).toBe(0);

    // Niciun rand 'running' nu trebuie inserat in monitoring_runs — altfel
    // recoverOrphanRuns ar avea de curatat la urmatoarea pornire.
    const running = getDb().prepare(`SELECT COUNT(*) as c FROM monitoring_runs WHERE status = 'running'`).get() as {
      c: number;
    };
    expect(running.c).toBe(0);
  });

  it("intersects enabledKinds cu MONITORING_DISABLED_KINDS (env wins)", () => {
    seedJob({
      nextRunAt: "2026-04-28T09:00:00.000Z",
      hashSeed: "h-dosar",
      kind: "dosar_soap",
    });
    const nameId = seedJob({
      nextRunAt: "2026-04-28T09:00:00.000Z",
      hashSeed: "h-name",
      kind: "name_soap",
    });

    // Scheduler crede ca are runneri pentru ambele, dar operatorul a oprit
    // dosar_soap din env — ramane doar name_soap.
    process.env.MONITORING_DISABLED_KINDS = "dosar_soap";
    const claimed = claimDueJobs({
      now: NOW,
      limit: 10,
      enabledKinds: ["dosar_soap", "name_soap"],
    });
    expect(claimed.map((r) => r.job.id)).toEqual([nameId]);
  });

  it("treats undefined enabledKinds as 'no filter' (legacy behaviour)", () => {
    seedJob({ nextRunAt: "2026-04-28T09:00:00.000Z", kind: "dosar_soap" });
    seedJob({
      nextRunAt: "2026-04-28T09:00:00.000Z",
      hashSeed: "h-name",
      kind: "name_soap",
    });
    const claimed = claimDueJobs({ now: NOW, limit: 10 });
    expect(claimed.length).toBe(2);
  });
});

describe("claimDueJobs — limits & ordering", () => {
  it("respects the limit parameter", () => {
    seedJob({ nextRunAt: "2026-04-28T09:00:00.000Z", hashSeed: "h1" });
    seedJob({ nextRunAt: "2026-04-28T09:00:00.000Z", hashSeed: "h2" });
    seedJob({ nextRunAt: "2026-04-28T09:00:00.000Z", hashSeed: "h3" });
    const claimed = claimDueJobs({ now: NOW, limit: 2 });
    expect(claimed.length).toBe(2);
  });

  it("orders by next_run_at ASC (oldest-due first)", () => {
    const a = seedJob({ nextRunAt: "2026-04-28T08:00:00.000Z", hashSeed: "h1" });
    const b = seedJob({ nextRunAt: "2026-04-28T09:30:00.000Z", hashSeed: "h2" });
    const c = seedJob({ nextRunAt: "2026-04-28T09:00:00.000Z", hashSeed: "h3" });
    const claimed = claimDueJobs({ now: NOW, limit: 10 });
    expect(claimed.map((r) => r.job.id)).toEqual([a, c, b]);
  });
});

describe("claimDueJobs — atomic side effect", () => {
  it("inserts a 'running' run row for every claimed job", () => {
    const id = seedJob({ nextRunAt: "2026-04-28T09:00:00.000Z" });
    const claimed = claimDueJobs({ now: NOW, limit: 10 });
    expect(claimed.length).toBe(1);

    const runs = getDb().prepare(`SELECT * FROM monitoring_runs WHERE job_id = ? AND status = 'running'`).all(id) as {
      id: number;
      status: string;
      started_at: string;
    }[];
    expect(runs.length).toBe(1);
    expect(runs[0]!.id).toBe(claimed[0]!.runId);
    expect(runs[0]!.started_at).toBe(NOW);
  });

  it("a second claim() in the same tick does not re-claim already-running jobs", () => {
    seedJob({ nextRunAt: "2026-04-28T09:00:00.000Z" });
    const first = claimDueJobs({ now: NOW, limit: 10 });
    const second = claimDueJobs({ now: NOW, limit: 10 });
    expect(first.length).toBe(1);
    expect(second.length).toBe(0);
  });
});

// Tier 3 #10 — owner_id end-to-end enforcement on the scheduler outcome write.
// markJobOutcome USED to UPDATE WHERE id = ? without an owner_id constraint.
// In a single-owner desktop world the bug was dormant, but the moment a web
// deploy lands with multiple owners, a stale or spoofed jobId would let the
// scheduler clobber a different owner's row. The fix: ownerId is REQUIRED on
// MarkJobOutcomeInput AND added to the WHERE clause; the function returns a
// boolean so callers can distinguish "no row matched" from a normal write.
describe("markJobOutcome — owner_id scoping", () => {
  it("updates the row when ownerId matches", () => {
    const id = seedJob({ nextRunAt: "2026-04-28T09:00:00.000Z" });
    const updated = markJobOutcome({
      ownerId: OWNER,
      jobId: id,
      lastRunAt: NOW,
      lastStatus: "ok",
      failStreak: 0,
      nextRunAt: "2026-04-28T11:00:00.000Z",
    });
    expect(updated).toBe(true);

    const row = getDb().prepare("SELECT last_status, fail_streak FROM monitoring_jobs WHERE id = ?").get(id) as {
      last_status: string;
      fail_streak: number;
    };
    expect(row.last_status).toBe("ok");
    expect(row.fail_streak).toBe(0);
  });

  it("does NOT mutate the row when ownerId differs (cross-owner guard)", () => {
    const id = seedJob({ nextRunAt: "2026-04-28T09:00:00.000Z" });
    const before = getDb()
      .prepare("SELECT last_status, fail_streak, next_run_at FROM monitoring_jobs WHERE id = ?")
      .get(id) as { last_status: string | null; fail_streak: number; next_run_at: string };

    const updated = markJobOutcome({
      ownerId: "someone-else",
      jobId: id,
      lastRunAt: NOW,
      lastStatus: "error",
      failStreak: 99,
      nextRunAt: "2099-01-01T00:00:00.000Z",
    });
    expect(updated).toBe(false);

    const after = getDb()
      .prepare("SELECT last_status, fail_streak, next_run_at FROM monitoring_jobs WHERE id = ?")
      .get(id) as { last_status: string | null; fail_streak: number; next_run_at: string };
    expect(after).toEqual(before);
  });
});

// Faza B — per-owner master switch: scheduler claim respecta starea din
// owner_monitoring_settings. Cand monitoring_enabled = 0, NICIUN job al
// ownerului nu se claimuieste, fara mutatii per-job. Re-enable face joburile
// re-eligibile imediat (next_run_at deja in trecut).
//
// Cele 3 scenarii sunt definite in PLAN-MASTER-SWITCH-MONITORING.md:
//   1. Owner cu master-switch off + job due -> NU se claimuieste.
//   2. Acelasi job devine claimable dupa re-enable.
//   3. Doi owneri, unul enabled + unul disabled -> doar primul se claimuieste.
describe("claimDueJobs - per-owner master switch", () => {
  it("does NOT claim a job whose owner has master-switch off", () => {
    seedJob({ nextRunAt: "2026-04-28T09:00:00.000Z" });
    setMonitoringEnabled(OWNER, false);

    const claimed = claimDueJobs({ now: NOW, limit: 10 });
    expect(claimed.length).toBe(0);

    // Niciun rand 'running' nu trebuie inserat — anti-join blocheaza claim-ul
    // inainte de INSERT INTO monitoring_runs, deci nu avem orphan runs.
    const running = getDb().prepare(`SELECT COUNT(*) as c FROM monitoring_runs WHERE status = 'running'`).get() as {
      c: number;
    };
    expect(running.c).toBe(0);
  });

  it("claims the same job after master-switch flips back to on", () => {
    const id = seedJob({ nextRunAt: "2026-04-28T09:00:00.000Z" });
    setMonitoringEnabled(OWNER, false);
    expect(claimDueJobs({ now: NOW, limit: 10 }).length).toBe(0);

    setMonitoringEnabled(OWNER, true);
    const claimed = claimDueJobs({ now: NOW, limit: 10 });
    expect(claimed.length).toBe(1);
    expect(claimed[0]!.job.id).toBe(id);
  });

  it("isolates owners: A enabled + B disabled -> claims only A's job", () => {
    // Owner A (OWNER = "local") foloseste seedJob helper-ul standard.
    const aId = seedJob({ nextRunAt: "2026-04-28T09:00:00.000Z", hashSeed: "h-a" });

    // Owner B: insert direct, fara helper, ca sa pastram OWNER constant la "local".
    const bInfo = getDb()
      .prepare(
        `INSERT INTO monitoring_jobs
           (owner_id, kind, target_json, target_hash, cadence_sec,
            alert_config_json, next_run_at, active, paused_until)
         VALUES (?, 'dosar_soap', '{}', ?, 14400, '{}', ?, 1, NULL)`
      )
      .run("owner-b", "h-b", "2026-04-28T09:00:00.000Z");
    const bId = bInfo.lastInsertRowid as number;

    setMonitoringEnabled("owner-b", false);

    const claimed = claimDueJobs({ now: NOW, limit: 10 });
    expect(claimed.map((r) => r.job.id).sort()).toEqual([aId].sort());
    expect(claimed.map((r) => r.job.id)).not.toContain(bId);
  });
});
