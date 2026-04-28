// dosar_soap runner — orchestration glue for the dosar_soap kind.
//
// Responsibilities (per PR-4 spec):
//   1. Parse job.target_json → numar_dosar; alert_config_json → AlertConfig
//   2. Compose external AbortSignal with 10-min wallclock budget (via
//      AbortSignal.any) and call SOAP search
//   3. Map error/abort/timeout into the right RunOutcome status code
//   4. Load latest snapshot, run pure diff, persist new snapshot + alerts
//   5. Return { status, alertsCreated } so the scheduler can finalize the run
//
// SOAP itself is injected via deps.searchDosare so:
//   - tests don't hit the network
//   - production wires `cautareDosare` from soap.ts in C6
//   - manual-trigger route (C5) reuses the same factory
//
// budgetMs is a testing seam: defaults to 10 minutes (PR-4 spec L390),
// tests pass a short value to exercise the timeout branch deterministically.

import type { Dosar, SearchParams } from "../../soap.ts";
import type { JobRunner, RunOutcome, ScheduledJob } from "./scheduler.ts";
import { AlertConfigSchema } from "../../schemas/monitoring.ts";
import { canonicalJson, canonicalSha256 } from "../../util/canonicalJson.ts";
import { diffDosarSoap, type DiffSnapshotPayload } from "./diff.ts";
import {
  getLatestSnapshot,
  insertSnapshot,
} from "../../db/monitoringSnapshotsRepository.ts";
import { insertAlert } from "../../db/monitoringAlertsRepository.ts";
import { withMaintenanceRead } from "../../db/backup.ts";
import { getDb } from "../../db/schema.ts";

const DEFAULT_BUDGET_MS = 10 * 60 * 1000; // 10 min

export interface DosarSoapRunnerDeps {
  searchDosare: (
    params: SearchParams,
    opts?: { signal?: AbortSignal },
  ) => Promise<Dosar[]>;
  // Testing seam — overrides the 10-min wallclock budget.
  budgetMs?: number;
}

export function createDosarSoapRunner(deps: DosarSoapRunnerDeps): JobRunner {
  const budgetMs = deps.budgetMs ?? DEFAULT_BUDGET_MS;

  return {
    async run({ job, runId, nowIso, signal }): Promise<RunOutcome> {
      // Compose external (drain/manual cancel) with internal wallclock budget
      // so neither side starves: drain aborts immediately on stop(), and the
      // budget is a safety belt against runaway SOAP calls.
      const budgetSignal = AbortSignal.timeout(budgetMs);
      const composed = AbortSignal.any([signal, budgetSignal]);

      const target = JSON.parse(job.target_json) as { numar_dosar: string };
      const alertConfig = AlertConfigSchema.parse(
        JSON.parse(job.alert_config_json),
      );

      let dosare: Dosar[];
      try {
        dosare = await deps.searchDosare(
          { numarDosar: target.numar_dosar },
          { signal: composed },
        );
      } catch (err) {
        // Order matters: external signal takes precedence over budget so a
        // graceful drain is attributed to "aborted" not "timeout".
        if (signal.aborted) {
          return {
            status: "aborted",
            errorCode: "ABORTED",
            errorMessage: "Run cancelled (drain or manual)",
          };
        }
        if (budgetSignal.aborted) {
          return {
            status: "timeout",
            errorCode: "WALLCLOCK_BUDGET",
            errorMessage: `Runner exceeded ${budgetMs}ms budget`,
          };
        }
        return {
          status: "error",
          errorCode: "SOAP_FAIL",
          errorMessage: err instanceof Error ? err.message : String(err),
        };
      }

      const currentDosar = dosare[0] ?? null;

      // Tier 3 #11: the maintenance read lock now wraps ONLY the DB-touching
      // section, not the SOAP call above. This shrinks the per-run lock
      // window from "full SOAP wallclock + DB write" (up to 10min worst case
      // per the budget) down to "DB write" (sub-millisecond). A queued
      // backup writer no longer waits for upstream PortalJust latency before
      // it can acquire the exclusive lock. The atomic snapshot+alerts
      // transaction (C2 hardening) is preserved verbatim inside.
      let alertsCreated = 0;
      await withMaintenanceRead(async () => {
        const prevRow = getLatestSnapshot(job.id);
        const prevSnapshot = prevRow
          ? (JSON.parse(prevRow.payload_json) as DiffSnapshotPayload)
          : null;

        const { newSnapshot, alerts } = diffDosarSoap({
          prevSnapshot,
          currentDosar,
          alertConfig,
          now: nowIso,
        });

        // C2 hardening: snapshot + alerts must commit together. Without this,
        // a crash / SIGTERM / disk-full between insertSnapshot and the first
        // insertAlert (or between two alert inserts) leaves the job in a
        // "snapshot persisted, alerts dropped" state — the next tick diffs
        // against the new snapshot and never re-emits the missed alerts.
        // better-sqlite3 transactions are synchronous; the runner is async
        // only on the SOAP call above, which has already resolved here.
        getDb().transaction(() => {
          insertSnapshot({
            ownerId: job.owner_id,
            jobId: job.id,
            runId,
            observedAt: nowIso,
            payloadHash: canonicalSha256(newSnapshot),
            payloadJson: canonicalJson(newSnapshot),
          });
          for (const alert of alerts) {
            insertAlert({
              ownerId: job.owner_id,
              jobId: job.id,
              runId,
              kind: alert.kind,
              severity: alert.severity,
              title: alert.title,
              detail: alert.detail,
              dedupKey: alert.dedupKey,
            });
          }
        })();
        alertsCreated = alerts.length;
      });

      return { status: "ok", alertsCreated };
    },
  };
}

// Type alias to keep callers from importing scheduler types just for ScheduledJob.
export type { ScheduledJob };
