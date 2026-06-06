// iccj runner — monitoring glue for the `iccj` kind (Inalta Curte / scj.ro).
//
// Mirrors dosarSoapRunner but fetches from the ICCJ live-proxy (search + detail)
// instead of PortalJust SOAP. Reuses ALL the shared machinery (diffDosarSoap,
// snapshot/alert repos, solutie enrichment, oversize cap, atomic transaction) so
// behavior is identical to dosar_soap; only the data source differs.
//
// CRITICAL false-empty guard (Codex review #3): `deps.fetchCurrentDosar` MUST
// throw on a source/parse failure (IccjSourceError/IccjParseError) and return
// `null` ONLY for a genuine "dosar not found". This runner treats any throw as
// an error outcome and DOES NOT write a snapshot — so a transient upstream
// failure can never be mistaken for "dosar disappeared".

import type { Dosar } from "../../soap.ts";
import type { JobRunner, RunOutcome, ScheduledJob } from "./scheduler.ts";
import { AlertConfigSchema } from "../../schemas/monitoring.ts";
import { canonicalJson, canonicalSha256 } from "../../util/canonicalJson.ts";
import { diffDosarSoap, type DiffSnapshotPayload } from "./diff/dosarSoap.ts";
import { SNAPSHOT_PAYLOAD_MAX_BYTES } from "./diff/types.ts";
import { deletePriorSnapshots, getLatestSnapshot, insertSnapshot } from "../../db/monitoringSnapshotsRepository.ts";
import { enrichSolutieAlertsForJob } from "../../db/monitoringAlertsRepository.ts";
import {
  recordAndDispatchAlert as insertAlert,
  dispatchInsertedAlertEmails,
  type InsertAlertResult,
} from "../alerts/alertEventService.ts";
import { withMaintenanceRead } from "../../db/backup.ts";
import { getDb } from "../../db/schema.ts";

const DEFAULT_BUDGET_MS = 10 * 60 * 1000; // 10 min

export interface IccjRunnerDeps {
  // Returns the full dosar (search summary + detail merged) or null if not found.
  // MUST throw on source/parse failure (never return null for a transient error).
  // Receives the stored `iccjId` (when the job was created with one) so identity is by
  // stable id, not the docket string which scj.ro decorates with `*`/`**` markers.
  fetchCurrentDosar: (
    target: { numarDosar: string; iccjId?: string },
    opts: { signal: AbortSignal }
  ) => Promise<Dosar | null>;
  budgetMs?: number;
}

export function createIccjRunner(deps: IccjRunnerDeps): JobRunner {
  const budgetMs = deps.budgetMs ?? DEFAULT_BUDGET_MS;

  return {
    async run({ job, runId, nowIso, signal }): Promise<RunOutcome> {
      const budgetSignal = AbortSignal.timeout(budgetMs);
      const composed = AbortSignal.any([signal, budgetSignal]);

      const target = JSON.parse(job.target_json) as { numar_dosar: string; iccj_id?: string };
      const alertConfig = AlertConfigSchema.parse(JSON.parse(job.alert_config_json));

      let currentDosar: Dosar | null;
      try {
        currentDosar = await deps.fetchCurrentDosar(
          { numarDosar: target.numar_dosar, iccjId: target.iccj_id },
          { signal: composed }
        );
      } catch (err) {
        if (signal.aborted) {
          return { status: "aborted", errorCode: "ABORTED", errorMessage: "Run cancelled (drain or manual)" };
        }
        if (budgetSignal.aborted) {
          return {
            status: "timeout",
            errorCode: "WALLCLOCK_BUDGET",
            errorMessage: `Runner exceeded ${budgetMs}ms budget`,
          };
        }
        // IccjSourceError / IccjParseError / network → error (NO snapshot write).
        return {
          status: "error",
          errorCode: "ICCJ_FAIL",
          errorMessage: err instanceof Error ? err.message : String(err),
        };
      }

      let alertsCreated = 0;
      let alertsPatched = 0;
      let oversizeOutcome: RunOutcome | null = null;
      const insertedResults: InsertAlertResult[] = [];

      await withMaintenanceRead(async () => {
        const prevRow = getLatestSnapshot(job.owner_id, job.id);
        const prevSnapshot = prevRow ? (JSON.parse(prevRow.payload_json) as DiffSnapshotPayload) : null;

        const { newSnapshot, alerts } = diffDosarSoap({
          prevSnapshot,
          currentDosar,
          alertConfig,
          now: nowIso,
          prevSnapshotId: prevRow?.id ?? null,
          sourceLabel: "ICCJ (scj.ro)",
        });

        const newSnapshotJson = canonicalJson(newSnapshot);
        const payloadBytes = Buffer.byteLength(newSnapshotJson, "utf8");
        if (payloadBytes > SNAPSHOT_PAYLOAD_MAX_BYTES) {
          const oversizeResult = insertAlert({
            ownerId: job.owner_id,
            jobId: job.id,
            runId,
            kind: "source_error",
            severity: "warning",
            title: `Snapshot peste plafon (${SNAPSHOT_PAYLOAD_MAX_BYTES >> 20} MiB) - refuzat la scriere`,
            detail: {
              error_code: "SNAPSHOT_OVERSIZE",
              payload_bytes: payloadBytes,
              max_bytes: SNAPSHOT_PAYLOAD_MAX_BYTES,
              dropped_alerts: alerts.length,
            },
            dedupKey: `snapshot_oversize|${runId}`,
          });
          insertedResults.push(oversizeResult);
          const oversizeInserted = oversizeResult.inserted ? 1 : 0;
          alertsCreated = oversizeInserted;
          oversizeOutcome = {
            status: "error",
            errorCode: "SNAPSHOT_OVERSIZE",
            errorMessage: `payload ${payloadBytes}B > cap ${SNAPSHOT_PAYLOAD_MAX_BYTES}B`,
            alertsCreated: oversizeInserted,
          };
          return;
        }

        let insertedCount = 0;
        getDb().transaction(() => {
          deletePriorSnapshots(job.owner_id, job.id);
          insertSnapshot({
            ownerId: job.owner_id,
            jobId: job.id,
            runId,
            observedAt: nowIso,
            payloadHash: canonicalSha256(newSnapshot),
            payloadJson: newSnapshotJson,
          });
          const dosarContext: Record<string, unknown> = { numar_dosar: target.numar_dosar };
          if (target.iccj_id) dosarContext.iccj_id = target.iccj_id;
          if (currentDosar?.institutie) dosarContext.instanta = currentDosar.institutie;
          if (currentDosar?.stadiuProcesual) dosarContext.stadiu = currentDosar.stadiuProcesual;
          for (const alert of alerts) {
            const result = insertAlert({
              ownerId: job.owner_id,
              jobId: job.id,
              runId,
              kind: alert.kind,
              severity: alert.severity,
              title: alert.title,
              detail: { ...dosarContext, ...alert.detail },
              dedupKey: alert.dedupKey,
            });
            insertedResults.push(result);
            if (result.inserted) insertedCount += 1;
          }
          if (currentDosar) {
            alertsPatched = enrichSolutieAlertsForJob(
              job.owner_id,
              job.id,
              (currentDosar.sedinte ?? []).map((s) => ({
                data: s.data,
                ora: s.ora,
                complet: s.complet,
                solutie: s.solutie ?? "",
                solutieSumar: s.solutieSumar,
                numarDocument: s.numarDocument,
                dataPronuntare: s.dataPronuntare,
              })),
              { instanta: currentDosar.institutie, stadiu: currentDosar.stadiuProcesual }
            );
          }
        })();
        alertsCreated = insertedCount;
      });

      dispatchInsertedAlertEmails(insertedResults);

      if (oversizeOutcome) return oversizeOutcome;
      return { status: "ok", alertsCreated, alertsPatched };
    },
  };
}

export type { ScheduledJob };
