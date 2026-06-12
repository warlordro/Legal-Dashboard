// AlertEventService — thin wrapper over the alerts repository that splits
// persistence from external fanout.
//
// Why this exists: until v2.11.x the repo's `insertAlert` directly imported
// `dispatchAlertEmail` and triggered SMTP from inside the persistence module.
// That coupling makes the repo do two jobs (write the row + reach out to
// `services/email/...` via `services/auditRepository.ts`), and it forces every
// test that uses `insertAlert` to mock the mailer to keep things quiet.
//
// MIN-VIABLE seam: the repo keeps two concerns it actually owns —
//   1. the SQL upsert (persistence + `inserted` flag);
//   2. in-process SSE listener fanout (a property of the row being committed,
//      synchronous from the renderer's POV, lives in the same module so it
//      can never observe a half-committed row).
// External fanout (right now: email; later: webhooks, queues, etc.) moves
// here. Production write paths (runners + scheduler) call
// `recordAndDispatchAlert` strictly for persistence + audit, then hand the
// collected results to `dispatchInsertedAlertEmails` AFTER the wrapping
// SQLite transaction commits. Tests that only need persistence keep calling
// `insertAlert` directly so they don't pull SMTP/audit infra into scope.
//
// "MIN-VIABLE" is intentional: no outbox table, no retry queue, no failure
// budget. The dispatcher already has bounded concurrency (`MAX_CONCURRENT=1`)
// and a graceful drain (`drainEmailDispatches`) so this seam can stay a
// single-call indirection until web-mode webhooks land.
//
// v2.34.0 P1-6 — split persist vs dispatch. Previously `recordAndDispatchAlert`
// queued the email via `queueMicrotask` immediately after `insertAlert`. When
// the caller wrapped the call in `getDb().transaction(() => { ... })`, a
// rollback (e.g. a later enrich step throwing) would drop the alert row but
// leave the microtask in flight — producing a phantom email for an alert that
// never persisted. Fix: callers collect `InsertAlertResult[]` inside the
// transaction and call `dispatchInsertedAlertEmails(results)` AFTER the
// transaction returns successfully.

import { recordAudit } from "../../db/auditRepository.ts";
import { insertAlert, type InsertAlertInput, type InsertAlertResult } from "../../db/monitoringAlertsRepository.ts";
import { dispatchAlertEmail } from "../email/alertEmailDispatcher.ts";

export type { InsertAlertInput, InsertAlertResult };

// Persists the alert and writes a best-effort audit row. Does NOT trigger any
// external dispatch — see `dispatchInsertedAlertEmails` for that.
//
// Returns the same `InsertAlertResult` as the repo so existing call sites
// can swap `insertAlert` → `recordAndDispatchAlert` with no behavior delta
// other than the audit side effect.
//
// v2.17.0 — every fresh alert gets a `monitoring.alert.emitted` audit row.
// Pre-fix the runners wrote alert rows but no audit trail, so a "why was this
// alert created" investigation had to reverse-engineer it from monitoring_runs
// + the alert's dedup_key. The audit is best-effort: a SQLite error here
// shouldn't bubble up and crash a runner mid-tick (the alert is already
// committed), so we wrap in try/catch and log to stderr.
export function recordAndDispatchAlert(input: InsertAlertInput): InsertAlertResult {
  const result = insertAlert(input);
  if (result.inserted) {
    try {
      recordAudit(null, "monitoring.alert.emitted", {
        ownerId: input.ownerId,
        // v2.37.1: "system" (nu null) — aliniat cu system.boot/system.shutdown,
        // ca audit viewer-ul sa atribuie consistent evenimentele automate.
        actorId: "system",
        targetKind: "monitoring_alert",
        targetId: String(result.row.id),
        detail: {
          kind: input.kind,
          severity: input.severity,
          jobId: input.jobId,
          runId: input.runId,
          dedupKey: input.dedupKey,
        },
      });
    } catch (err) {
      console.error("[alertEventService] audit write failed", err);
    }
  }
  return result;
}

// Schedules email dispatch for every freshly-inserted alert in the batch.
// Callers MUST invoke this AFTER the wrapping `getDb().transaction(() => {...})`
// returns — otherwise a rollback after `recordAndDispatchAlert` would drop the
// alert row while leaving the email side effect armed (see header note).
//
// The dispatcher itself is responsible for SMTP errors, retries within the
// process lifetime, and graceful drain on shutdown.
export function dispatchInsertedAlertEmails(results: readonly InsertAlertResult[]): void {
  for (const result of results) {
    if (result.inserted) {
      queueMicrotask(() => {
        void dispatchAlertEmail(result.row);
      });
    }
  }
}
