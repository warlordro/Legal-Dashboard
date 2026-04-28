// /api/v1/monitoring/jobs — CRUD for the PR-3 monitoring core.
//
// Wire format: standard envelope (`{data, error?, requestId}`). Validation:
// Zod schemas at the boundary; success path delegates to monitoringJobsRepo.
// Mutations write audit_log entries via recordAudit() so admin / web mode
// later has a full action trail.
//
// All handlers are owner-scoped: a PATCH/DELETE on someone else's job returns
// 404 (not 403) — leaking ownership existence to the requester is itself a
// signal we don't want to give.

import { Hono } from "hono";

import { getOwnerId } from "../middleware/owner.ts";
import { recordAudit } from "../db/auditRepository.ts";
import {
  createJob,
  deleteJob,
  getJobById,
  listJobs,
  updateJob,
  type MonitoringJobRow,
} from "../db/monitoringJobsRepository.ts";
import { getDb } from "../db/schema.ts";
import {
  JobCreateBodySchema,
  JobListQuerySchema,
  JobUpdateBodySchema,
} from "../schemas/monitoring.ts";
import { fail, ok } from "../util/envelope.ts";

// PR-4 C5: manual-trigger route hands a claimed job to the scheduler. We
// don't import Scheduler directly (cycle: scheduler.ts wires runs through the
// repos this router already touches). Instead the bootstrap calls
// setMonitoringScheduler(scheduler) after constructing it; the route
// null-checks and falls back to 503 when not yet wired.
export interface MonitoringSchedulerHandle {
  runJobNow(job: MonitoringJobRow): Promise<{ runId: number }>;
}

let scheduler: MonitoringSchedulerHandle | null = null;

export function setMonitoringScheduler(
  s: MonitoringSchedulerHandle | null,
): void {
  scheduler = s;
}

export const monitoringRouter = new Hono();

// GET /jobs?page=1&pageSize=20&kind=dosar_soap&active=true
monitoringRouter.get("/jobs", (c) => {
  const ownerId = getOwnerId(c);
  const queryResult = JobListQuerySchema.safeParse(c.req.query());
  if (!queryResult.success) {
    return c.json(
      fail("invalid_query", "Parametri de cautare invalizi", c, queryResult.error.issues),
      400,
    );
  }
  const list = listJobs({ ownerId, ...queryResult.data });
  return c.json(ok(list, c));
});

// GET /jobs/:id
monitoringRouter.get("/jobs/:id", (c) => {
  const ownerId = getOwnerId(c);
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json(fail("invalid_id", "ID invalid", c), 400);
  }
  const row = getJobById(ownerId, id);
  if (!row) {
    return c.json(fail("not_found", "Job inexistent", c), 404);
  }
  return c.json(ok(row, c));
});

// POST /jobs
monitoringRouter.post("/jobs", async (c) => {
  const ownerId = getOwnerId(c);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(fail("invalid_json", "Body JSON invalid", c), 400);
  }

  const parsed = JobCreateBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json(fail("invalid_payload", "Payload invalid", c, parsed.error.issues), 422);
  }

  // PR-4 ships only the dosar_soap runner. Schema accepts name_soap and
  // aviz_rnpm so PR-5/PR-6 can light them up without a schema bump, but
  // accepting them at POST today produces a job the scheduler can't dispatch
  // (silent next_run_at advance, never an alert). Reject with a stable code
  // so the UI can surface "coming soon" copy.
  if (parsed.data.kind !== "dosar_soap") {
    return c.json(
      fail(
        "kind_not_implemented",
        "Monitorizarea dupa nume soseste in v2.2.0 (PR-5). Momentan doar dosar dupa numar e implementat.",
        c,
      ),
      422,
    );
  }

  // Wrap the insert + audit write in a single transaction so a partial
  // failure can't produce a job without a corresponding audit row (or vice
  // versa). better-sqlite3 transactions are synchronous; the route handler is
  // async only on c.req.json() above, which is already resolved here.
  let result: ReturnType<typeof createJob>;
  try {
    result = getDb().transaction(() => {
      const r = createJob({ ownerId, body: parsed.data });
      // Audit only on actual mutation. An idempotent replay (same
      // client_request_id) or a target_hash collision both return the
      // existing row — they're not new events worth a row in audit_log.
      if (!r.duplicate) {
        recordAudit(c, "monitoring.job.created", {
          targetKind: "monitoring_job",
          targetId: String(r.job.id),
          detail: { kind: r.job.kind, target_hash: r.job.target_hash },
        });
      }
      return r;
    })();
  } catch (err) {
    // Body is already Zod-validated above, so any throw from here is an
    // unexpected DB / runtime fault — treat as 500.
    console.error("[monitoring] createJob failed:", err);
    return c.json(fail("internal_error", "Eroare la salvarea jobului", c), 500);
  }

  // 201 on fresh insert, 200 on idempotent replay (REST convention).
  const status = result.duplicate ? 200 : 201;
  return c.json(ok(result.job, c), status);
});

// Cross-owner existence probe. Used by PATCH/DELETE to distinguish "row
// doesn't exist anywhere" (not interesting to audit) from "row exists but
// belongs to a different owner" (a denied access attempt — must be audited
// for compliance / antifraud reconstruction in web mode). Returns only a
// boolean so this never leaks the foreign owner_id back to the caller.
function jobExistsForAnyOwner(id: number): boolean {
  return (
    getDb()
      .prepare(`SELECT 1 AS one FROM monitoring_jobs WHERE id = ? LIMIT 1`)
      .get(id) !== undefined
  );
}

// Best-effort JSON parse for audit detail capture; never throws out of an
// audit path. Falls back to the raw string so the row is still informative
// even when target_json drifts from schema (shouldn't happen but the audit
// log is the wrong place to lose evidence).
function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return { _raw: s };
  }
}

// PATCH /jobs/:id
monitoringRouter.patch("/jobs/:id", async (c) => {
  const ownerId = getOwnerId(c);
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json(fail("invalid_id", "ID invalid", c), 400);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(fail("invalid_json", "Body JSON invalid", c), 400);
  }

  const parsed = JobUpdateBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json(fail("invalid_payload", "Payload invalid", c, parsed.error.issues), 422);
  }

  // Atomic: pre-state capture + update + audit committed together.
  // updateJob already opens its own internal transaction; better-sqlite3
  // nests cleanly via SAVEPOINT, so the outer wrap scopes audit to the
  // same commit boundary.
  type PatchResult =
    | { kind: "ok"; updated: MonitoringJobRow }
    | { kind: "denied" }
    | { kind: "not_found" };
  const result: PatchResult = getDb().transaction((): PatchResult => {
    const before = getJobById(ownerId, id);
    if (!before) {
      // Owner-scoped miss. Distinguish denied (exists for another owner)
      // from not_found (doesn't exist anywhere) so the audit log records
      // attempted cross-owner access — silently 404'ing both leaves a hole
      // in the antifraud trail.
      if (jobExistsForAnyOwner(id)) {
        recordAudit(c, "monitoring.job.update_denied", {
          targetKind: "monitoring_job",
          targetId: String(id),
          outcome: "denied",
        });
        return { kind: "denied" };
      }
      return { kind: "not_found" };
    }
    const u = updateJob(ownerId, id, parsed.data);
    if (!u) {
      // Race: row vanished between the SELECT and the UPDATE (concurrent
      // DELETE in another tab). Treat as not_found for the caller.
      return { kind: "not_found" };
    }
    // Capture the changed fields' before/after values so the audit row can
    // reconstruct exactly what shifted, not just which keys were touched.
    const changed: Record<string, { before: unknown; after: unknown }> = {};
    for (const key of Object.keys(parsed.data)) {
      const beforeRaw = (before as unknown as Record<string, unknown>)[key];
      const afterRaw = (u as unknown as Record<string, unknown>)[key];
      changed[key] = { before: beforeRaw, after: afterRaw };
    }
    recordAudit(c, "monitoring.job.updated", {
      targetKind: "monitoring_job",
      targetId: String(id),
      detail: { fields: Object.keys(parsed.data), changed },
    });
    return { kind: "ok", updated: u };
  })();

  if (result.kind === "denied" || result.kind === "not_found") {
    // Both paths return the same body so an attacker can't probe ownership
    // by status-code analysis. The differentiation lives in the audit log.
    return c.json(fail("not_found", "Job inexistent", c), 404);
  }
  return c.json(ok(result.updated, c));
});

// DELETE /jobs/:id
monitoringRouter.delete("/jobs/:id", (c) => {
  const ownerId = getOwnerId(c);
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json(fail("invalid_id", "ID invalid", c), 400);
  }
  type DeleteResult = "ok" | "denied" | "not_found";
  const result: DeleteResult = getDb().transaction((): DeleteResult => {
    // Pre-state capture so the audit row preserves what was deleted
    // (kind, target, schedule, alert config). Without this the row vanishes
    // and the audit log can only attest "id N was deleted by owner X" —
    // useless if the question is "did anyone delete the dosar 1234/180/2024
    // monitor on April 28th".
    const before = getJobById(ownerId, id);
    if (!before) {
      if (jobExistsForAnyOwner(id)) {
        recordAudit(c, "monitoring.job.delete_denied", {
          targetKind: "monitoring_job",
          targetId: String(id),
          outcome: "denied",
        });
        return "denied";
      }
      return "not_found";
    }
    const ok = deleteJob(ownerId, id);
    if (!ok) {
      // Concurrent delete from another session.
      return "not_found";
    }
    recordAudit(c, "monitoring.job.deleted", {
      targetKind: "monitoring_job",
      targetId: String(id),
      detail: {
        kind: before.kind,
        target_hash: before.target_hash,
        cadence_sec: before.cadence_sec,
        target: safeJsonParse(before.target_json),
        alert_config: safeJsonParse(before.alert_config_json),
        active: before.active,
        last_status: before.last_status,
      },
    });
    return "ok";
  })();

  if (result === "denied" || result === "not_found") {
    return c.json(fail("not_found", "Job inexistent", c), 404);
  }
  return c.json(ok({ deleted: true }, c));
});

// POST /jobs/:id/run — manual trigger. Per PLAN-monitoring-webmode.md L491:
// returns 202 + { runId }. We always wait for the run to start (insertRunning
// has happened) so the caller has a runId to poll, but the runner itself runs
// async — the response returns before the run finalizes.
//
// Errors mapped from runJobNow:
//   - "in_flight"     → 409 (a previous run is still executing)
//   - "not_running"   → 503 (scheduler stopped mid-flight)
// 503 also covers the "no scheduler registered" pre-check above.
monitoringRouter.post("/jobs/:id/run", async (c) => {
  const ownerId = getOwnerId(c);
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json(fail("invalid_id", "ID invalid", c), 400);
  }
  if (!scheduler) {
    return c.json(
      fail("scheduler_unavailable", "Scheduler indisponibil", c),
      503,
    );
  }
  const job = getJobById(ownerId, id);
  if (!job) {
    // Same denied-vs-not-found audit pattern as PATCH/DELETE: a cross-owner
    // attempt to manually fire someone else's run is an antifraud-relevant
    // signal we want to capture. Returns 404 either way to avoid leaking
    // ownership existence via status codes.
    if (jobExistsForAnyOwner(id)) {
      recordAudit(c, "monitoring.job.run_denied", {
        targetKind: "monitoring_job",
        targetId: String(id),
        outcome: "denied",
      });
    }
    return c.json(fail("not_found", "Job inexistent", c), 404);
  }

  let runId: number;
  try {
    const result = await scheduler.runJobNow(job);
    runId = result.runId;
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "in_flight") {
      return c.json(fail("in_flight", "Job deja in executie", c), 409);
    }
    if (code === "not_running") {
      return c.json(
        fail("scheduler_unavailable", "Scheduler indisponibil", c),
        503,
      );
    }
    console.error("[monitoring] runJobNow failed:", err);
    recordAudit(c, "monitoring.job.run_manual", {
      targetKind: "monitoring_job",
      targetId: String(id),
      outcome: "error",
      detail: { error: err instanceof Error ? err.message : String(err) },
    });
    return c.json(fail("internal_error", "Eroare la rularea jobului", c), 500);
  }

  recordAudit(c, "monitoring.job.run_manual", {
    targetKind: "monitoring_job",
    targetId: String(id),
    detail: { runId },
  });

  return c.json(ok({ runId }, c), 202);
});
