// createMonitoringJob — command service that owns the "create a monitoring
// job" workflow. The route handler in routes/monitoring.ts has historically
// kept transaction control, audit writes, idempotency-conflict handling, and
// HTTP envelope building all inline. This service extracts the first three;
// the route remains responsible for validation + envelope (boundary concerns).
//
// MIN-VIABLE: only the create command is extracted. PATCH/DELETE/bulk-delete
// stay in the route until a follow-up sweep proves the seam holds.
//
// Why move it: the same logic gets reused by web-mode admin tools (PR-9+) and
// by future automated job-creation paths (e.g. mass-import via CSV). Keeping
// it framework-free (no Hono Context, no JSON envelope) makes those reuses
// trivial; right now they would have to spin up a fake `c` to call the route.
//
// The service takes a `writeAudit` callback rather than calling `recordAudit`
// directly so callers control the audit context (web mode = HTTP request;
// future bulk-import job = system actor). The route adapter wires this to
// `recordAudit(c, ...)` so the existing audit semantics are unchanged.

import { getDb } from "../../../db/schema.ts";
import { createJob, IdempotencyConflictError, type MonitoringJobRow } from "../../../db/monitoringJobsRepository.ts";
import type { JobCreateBody } from "../../../schemas/monitoring.ts";

export interface CreateMonitoringJobAuditEvent {
  action: "monitoring.job.created" | "monitoring.job.idempotency_conflict";
  targetKind: "monitoring_job";
  targetId: string;
  detail: Record<string, unknown>;
}

export type CreateMonitoringJobAuditWriter = (event: CreateMonitoringJobAuditEvent) => void;

export interface CreateMonitoringJobInput {
  ownerId: string;
  body: JobCreateBody;
  writeAudit: CreateMonitoringJobAuditWriter;
}

export type CreateMonitoringJobOutcome =
  | { status: "kind_not_implemented" }
  | { status: "idempotency_conflict"; existing: MonitoringJobRow }
  | { status: "ok"; job: MonitoringJobRow; duplicate: boolean };

export function executeCreateMonitoringJob(input: CreateMonitoringJobInput): CreateMonitoringJobOutcome {
  // Domain-level rejection: aviz_rnpm has no runner wired through PR-5/PR-6.
  // Schema-valid but not dispatchable — refuse rather than create a row that
  // the scheduler will silently ignore.
  if (input.body.kind === "aviz_rnpm") {
    return { status: "kind_not_implemented" };
  }

  try {
    // Wrap insert + audit write in one transaction so a partial failure can't
    // produce a job without the matching audit row (or the inverse). The
    // repo's createJob is sync; better-sqlite3 transactions are sync too.
    const result = getDb().transaction(() => {
      const r = createJob({ ownerId: input.ownerId, body: input.body });
      // Audit only on real mutations. Idempotent replay (same client_request_id
      // + matching target+kind) and target_hash collision both return the
      // existing row — neither is a fresh event.
      if (!r.duplicate) {
        input.writeAudit({
          action: "monitoring.job.created",
          targetKind: "monitoring_job",
          targetId: String(r.job.id),
          detail: { kind: r.job.kind, target_hash: r.job.target_hash },
        });
      }
      return r;
    })();
    return { status: "ok", job: result.job, duplicate: result.duplicate };
  } catch (err) {
    if (err instanceof IdempotencyConflictError) {
      input.writeAudit({
        action: "monitoring.job.idempotency_conflict",
        targetKind: "monitoring_job",
        targetId: String(err.existing.id),
        detail: {
          existing_kind: err.existing.kind,
          existing_target_hash: err.existing.target_hash,
          requested_kind: input.body.kind,
        },
      });
      return { status: "idempotency_conflict", existing: err.existing };
    }
    throw err;
  }
}
