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
// `recordAndDispatchAlert`. Tests that only need persistence keep calling
// `insertAlert` directly so they don't pull SMTP/audit infra into scope.
//
// "MIN-VIABLE" is intentional: no outbox table, no retry queue, no failure
// budget. The dispatcher already has bounded concurrency (`MAX_CONCURRENT=1`)
// and a graceful drain (`drainEmailDispatches`) so this seam can stay a
// single-call indirection until web-mode webhooks land.

import {
  insertAlert,
  type InsertAlertInput,
  type InsertAlertResult,
} from "../../db/monitoringAlertsRepository.ts";
import { dispatchAlertEmail } from "../email/alertEmailDispatcher.ts";

export type { InsertAlertInput, InsertAlertResult };

// Persists the alert and, when a fresh row is written (inserted=true on the
// dedup upsert), schedules an email dispatch via queueMicrotask so the SMTP
// call never runs inside the SQLite write lock that the runners hold.
//
// Returns the same `InsertAlertResult` as the repo so existing call sites
// can swap `insertAlert` → `recordAndDispatchAlert` with no behavior delta
// other than the email side effect coming back.
export function recordAndDispatchAlert(
  input: InsertAlertInput,
): InsertAlertResult {
  const result = insertAlert(input);
  if (result.inserted) {
    queueMicrotask(() => {
      void dispatchAlertEmail(result.row);
    });
  }
  return result;
}
