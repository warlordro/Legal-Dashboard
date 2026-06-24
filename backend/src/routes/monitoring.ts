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
import { bodyLimit } from "hono/body-limit";
import type { Context } from "hono";

import { getOwnerId } from "../middleware/owner.ts";
import { requireDesktopHeader } from "../middleware/requireDesktopHeader.ts";
import { recordAudit } from "../db/auditRepository.ts";
import {
  deleteJob,
  getJobById,
  IdempotencyConflictError,
  jobExistsForAnyOwner,
  listJobs,
  updateJob,
  type MonitoringJobRow,
} from "../db/monitoringJobsRepository.ts";
import { getMonitoringEnabled, setMonitoringEnabled } from "../db/ownerMonitoringSettingsRepository.ts";
import { getDb } from "../db/schema.ts";
import {
  JobCreateBodySchema,
  JobListQuerySchema,
  JobUpdateBodySchema,
  MasterSwitchBodySchema,
} from "../schemas/monitoring.ts";
import { fail, ok } from "../util/envelope.ts";
import { executeCreateMonitoringJob } from "../services/monitoring/commands/createMonitoringJob.ts";

const MONITORING_BODY_LIMIT = 16 * 1024;

const bodyTooLarge = (c: Context) => c.json(fail("payload_too_large", "Payload prea mare", c), 413);
const limitMonitoringBody = bodyLimit({
  maxSize: MONITORING_BODY_LIMIT,
  onError: bodyTooLarge,
});

async function readLimitedJsonBody(
  c: Context
): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  const contentLength = Number(c.req.header("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MONITORING_BODY_LIMIT) {
    return { ok: false, response: bodyTooLarge(c) };
  }

  let raw: string;
  try {
    raw = await c.req.text();
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    const message = err instanceof Error ? err.message : String(err);
    if (name === "BodyLimitError" || message.includes("Payload Too Large")) {
      return { ok: false, response: bodyTooLarge(c) };
    }
    return {
      ok: false,
      response: c.json(fail("invalid_json", "Body JSON invalid", c), 400),
    };
  }

  if (new TextEncoder().encode(raw).length > MONITORING_BODY_LIMIT) {
    return { ok: false, response: bodyTooLarge(c) };
  }

  try {
    return { ok: true, body: JSON.parse(raw) as unknown };
  } catch {
    return {
      ok: false,
      response: c.json(fail("invalid_json", "Body JSON invalid", c), 400),
    };
  }
}

// PR-4 C5: manual-trigger route hands a claimed job to the scheduler. We
// don't import Scheduler directly (cycle: scheduler.ts wires runs through the
// repos this router already touches). Instead the bootstrap calls
// setMonitoringScheduler(scheduler) after constructing it; the route
// null-checks and falls back to 503 when not yet wired.
export interface MonitoringSchedulerHandle {
  runJobNow(job: MonitoringJobRow): Promise<{ runId: number }>;
  // Tier 3 #12: exposed via /health to surface scheduler liveness without
  // requiring monitoring-aware orchestration. Optional so test stubs that
  // only exercise runJobNow don't need to implement it.
  getStatus?(): { running: boolean; inflight: number };
  // F1: DELETE /jobs/:id refuses to drop a row while a runner still holds
  // its AbortController — the run finalizer would otherwise UPDATE a row
  // that no longer exists and surface as RUNNER_THREW. Optional for the
  // same reason as getStatus: legacy test stubs.
  getInflightAbortController?(jobId: number): AbortController | undefined;
}

let scheduler: MonitoringSchedulerHandle | null = null;

export function setMonitoringScheduler(s: MonitoringSchedulerHandle | null): void {
  scheduler = s;
}

// Tier 3 #12: read-only handle for the /health endpoint. Returns null when
// monitoring is disabled or scheduler not yet wired (boot race window).
export function getMonitoringSchedulerStatus(): { running: boolean; inflight: number } | null {
  if (!scheduler || typeof scheduler.getStatus !== "function") return null;
  return scheduler.getStatus();
}

export const monitoringRouter = new Hono();

// GET /jobs?page=1&pageSize=20&kind=dosar_soap&active=true&q=ion
monitoringRouter.get("/jobs", (c) => {
  const ownerId = getOwnerId(c);
  const queryResult = JobListQuerySchema.safeParse(c.req.query());
  if (!queryResult.success) {
    return c.json(fail("invalid_query", "Parametri de cautare invalizi", c, queryResult.error.issues), 400);
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
monitoringRouter.post("/jobs", limitMonitoringBody, async (c) => {
  const ownerId = getOwnerId(c);
  const bodyResult = await readLimitedJsonBody(c);
  if (!bodyResult.ok) return bodyResult.response;
  const body = bodyResult.body;

  const parsed = JobCreateBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json(fail("invalid_payload", "Payload invalid", c, parsed.error.issues), 422);
  }

  let outcome: ReturnType<typeof executeCreateMonitoringJob>;
  try {
    outcome = executeCreateMonitoringJob({
      ownerId,
      body: parsed.data,
      // Adapter — the service is framework-free; we plumb Hono Context into
      // recordAudit here so audit rows still carry actor/request metadata.
      writeAudit: (event) => {
        recordAudit(c, event.action, {
          targetKind: event.targetKind,
          targetId: event.targetId,
          detail: event.detail,
        });
      },
    });
  } catch (err) {
    // The service rethrows any non-IdempotencyConflict error — body is
    // already Zod-validated above, so this is an unexpected DB / runtime
    // fault. Treat as 500 with no internal-detail leak.
    console.error("[monitoring] createJob failed:", err);
    return c.json(fail("internal_error", "Eroare la salvarea jobului", c), 500);
  }

  switch (outcome.status) {
    case "kind_not_implemented":
      return c.json(
        fail("kind_not_implemented", "Monitorizarea RNPM nu are runner activ in aceasta versiune.", c),
        422
      );
    case "idempotency_conflict":
      return c.json(
        fail(
          "idempotency_conflict",
          "client_request_id refolosit pentru un alt job. Foloseste un id nou sau aceleasi target+kind ca prima cerere.",
          c,
          { existing_job_id: outcome.existing.id }
        ),
        409
      );
    case "ok":
      // 201 on fresh insert, 200 on idempotent replay (REST convention).
      return c.json(ok(outcome.job, c), outcome.duplicate ? 200 : 201);
  }
});

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
monitoringRouter.patch("/jobs/:id", limitMonitoringBody, async (c) => {
  const ownerId = getOwnerId(c);
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json(fail("invalid_id", "ID invalid", c), 400);
  }

  const bodyResult = await readLimitedJsonBody(c);
  if (!bodyResult.ok) return bodyResult.response;
  const body = bodyResult.body;

  const parsed = JobUpdateBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json(fail("invalid_payload", "Payload invalid", c, parsed.error.issues), 422);
  }

  // Atomic: pre-state capture + update + audit committed together.
  // updateJob already opens its own internal transaction; better-sqlite3
  // nests cleanly via SAVEPOINT, so the outer wrap scopes audit to the
  // same commit boundary.
  type PatchResult = { kind: "ok"; updated: MonitoringJobRow } | { kind: "denied" } | { kind: "not_found" };
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
  // F1: refuza DELETE cat timp un runner are AbortController activ pe job.
  // Stergerea in mijlocul rularii lasa run finalizer-ul sa scrie pe o linie
  // disparuta si emite RUNNER_THREW. Verificarea ramane in afara tranzactiei
  // pentru ca este o lookup in memorie (Map), nu o operatie pe DB.
  // Test: runner blocat + DELETE in paralel -> assert 409, fara
  // RUNNER_THREW in monitoring_runs.
  if (
    scheduler &&
    typeof scheduler.getInflightAbortController === "function" &&
    scheduler.getInflightAbortController(id) !== undefined
  ) {
    recordAudit(c, "monitoring.job.delete_inflight", {
      targetKind: "monitoring_job",
      targetId: String(id),
      outcome: "denied",
    });
    return c.json(fail("job_in_flight", "Jobul are o rulare in curs. Reincearca dupa finalizare.", c), 409);
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

// F9 — POST /jobs/bulk-delete: stergere in masa cu raportare detaliata.
// Body: { ids: number[] } (max 100, fiecare integer pozitiv finit). Ruleaza
// SELECT + delete per id intr-o singura tranzactie SQLite atomica. ID-urile
// cu runner activ sunt marcate "inflight" (nu se sterg, asemanator F1) iar
// cele inexistente pentru owner sunt marcate "not_found" (denied cross-owner
// e fuzionat in not_found pentru ca raspunsul nu trebuie sa scurga
// existenta). Audit unic agregat pe toata operatia.
const BULK_DELETE_MAX = 100;
monitoringRouter.post("/jobs/bulk-delete", requireDesktopHeader, limitMonitoringBody, async (c) => {
  const ownerId = getOwnerId(c);
  const bodyResult = await readLimitedJsonBody(c);
  if (!bodyResult.ok) return bodyResult.response;
  const body = bodyResult.body;

  if (body === null || typeof body !== "object" || !Array.isArray((body as { ids?: unknown }).ids)) {
    return c.json(fail("invalid_payload", "Payload invalid: ids[] obligatoriu.", c), 422);
  }
  const rawIds = (body as { ids: unknown[] }).ids;
  if (rawIds.length === 0) {
    return c.json(fail("invalid_payload", "Lista de ID-uri este goala.", c), 422);
  }
  if (rawIds.length > BULK_DELETE_MAX) {
    return c.json(fail("too_many", "Maxim 100 ID-uri per cerere.", c), 400);
  }
  const ids: number[] = [];
  for (const raw of rawIds) {
    if (typeof raw !== "number" || !Number.isFinite(raw) || !Number.isInteger(raw) || raw <= 0) {
      return c.json(fail("invalid_payload", "ID invalid in lista (necesita integer pozitiv).", c), 422);
    }
    ids.push(raw);
  }

  // Tranzactie atomica: stergerile per id si audit-ul agregat se commit-eaza
  // impreuna. Inflight check ramane in afara DB (lookup in Map), dar
  // deciziile per id (deleted/inflight/not_found) sunt finalizate inauntru
  // ca SELECT + DELETE sa nu se intercaleze cu o stergere concurenta din
  // alta sesiune. Restul fisierului tine audit-ul in aceeasi tranzactie cu
  // mutatia — pastram aceeasi conventie.
  const deleted_ids: number[] = [];
  const inflight_ids: number[] = [];
  const not_found_ids: number[] = [];
  try {
    getDb().transaction(() => {
      for (const id of ids) {
        // Inflight check pe scheduler in memorie. Daca jobul are runner
        // activ il marcam si trecem mai departe — nu rupem tranzactia.
        if (
          scheduler &&
          typeof scheduler.getInflightAbortController === "function" &&
          scheduler.getInflightAbortController(id) !== undefined
        ) {
          inflight_ids.push(id);
          continue;
        }
        const before = getJobById(ownerId, id);
        if (!before) {
          // Cross-owner sau inexistent: ambele se intorc ca not_found
          // pentru a nu scurge existenta prin status code-uri.
          not_found_ids.push(id);
          continue;
        }
        const okDel = deleteJob(ownerId, id);
        if (!okDel) {
          // Cursa concurenta cu alt session: tratam ca not_found.
          not_found_ids.push(id);
          continue;
        }
        deleted_ids.push(id);
      }
      recordAudit(c, "monitoring.job.bulk_deleted", {
        targetKind: "monitoring_job",
        detail: {
          deleted_ids,
          inflight_ids,
          not_found_ids,
          count: deleted_ids.length,
        },
      });
    })();
  } catch (err) {
    console.error("[monitoring] bulk-delete failed:", err);
    return c.json(fail("internal_error", "Eroare la stergerea in masa.", c), 500);
  }

  return c.json(
    ok(
      {
        deleted_ids,
        inflight_ids,
        not_found_ids,
        total_deleted: deleted_ids.length,
      },
      c
    )
  );
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
monitoringRouter.post("/jobs/:id/run", limitMonitoringBody, async (c) => {
  const ownerId = getOwnerId(c);
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json(fail("invalid_id", "ID invalid", c), 400);
  }
  if (!scheduler) {
    return c.json(fail("scheduler_unavailable", "Scheduler indisponibil", c), 503);
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
      return c.json(fail("scheduler_unavailable", "Scheduler indisponibil", c), 503);
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

// Faza B — per-owner master switch (global pause/resume monitoring claim).
//
// Contract (PLAN-MASTER-SWITCH-MONITORING.md):
//   GET  /master-switch  -> { enabled: boolean }   (default true cand randul lipseste)
//   PUT  /master-switch  -> body { enabled: boolean } strict; raspunde
//                            { enabled, changed }. Audit log scris doar cand
//                            changed=true (evita poluare la PUT-uri idempotente).
//
// Anti-join in claimDueJobs respecta monitoring_enabled = 0 fara mutatii pe
// per-job state, deci pause/resume nu pierde context (next_run_at ramane in
// trecut si jobul redevine claimable imediat dupa re-enable).
monitoringRouter.get("/master-switch", (c) => {
  const ownerId = getOwnerId(c);
  const enabled = getMonitoringEnabled(ownerId);
  return c.json(ok({ enabled }, c));
});

monitoringRouter.put("/master-switch", limitMonitoringBody, async (c) => {
  const ownerId = getOwnerId(c);
  const bodyResult = await readLimitedJsonBody(c);
  if (!bodyResult.ok) return bodyResult.response;
  const body = bodyResult.body;

  const parsed = MasterSwitchBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json(fail("invalid_payload", "Payload invalid", c, parsed.error.issues), 422);
  }

  // Atomic: SELECT pre-state + UPSERT + audit row commit impreuna. Daca
  // procesul moare intre setMonitoringEnabled si recordAudit, ramanem cu
  // "switch flip-uit fara urma in audit" — tranzactia inchide gaura.
  const result = getDb().transaction((): { enabled: boolean; changed: boolean } => {
    const { changed } = setMonitoringEnabled(ownerId, parsed.data.enabled);
    if (changed) {
      recordAudit(c, parsed.data.enabled ? "monitoring.master_switch.on" : "monitoring.master_switch.off", {
        targetKind: "owner_monitoring_settings",
        targetId: ownerId,
        detail: { enabled: parsed.data.enabled },
      });
    }
    return { enabled: parsed.data.enabled, changed };
  })();

  return c.json(ok(result, c));
});
