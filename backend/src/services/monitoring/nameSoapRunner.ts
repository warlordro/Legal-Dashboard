import type { Dosar, SearchParams } from "../../soap.ts";
import type { JobRunner, RunOutcome, ScheduledJob } from "./scheduler.ts";
import { AlertConfigSchema } from "../../schemas/monitoring.ts";
import { canonicalJson, canonicalSha256 } from "../../util/canonicalJson.ts";
import {
  buildNameSoapSnapshot,
  diffNameSoap,
  type NameSoapSnapshotPayload,
} from "./diff/nameSoap.ts";
import { SNAPSHOT_PAYLOAD_MAX_BYTES } from "./diff/types.ts";
import {
  getLatestSnapshot,
  insertSnapshot,
} from "../../db/monitoringSnapshotsRepository.ts";
import { insertAlert } from "../../db/monitoringAlertsRepository.ts";
import { withMaintenanceRead } from "../../db/backup.ts";
import { getDb } from "../../db/schema.ts";

const DEFAULT_BUDGET_MS = 10 * 60 * 1000;

export interface NameSoapRunnerDeps {
  searchDosare: (
    params: SearchParams,
    opts?: { signal?: AbortSignal },
  ) => Promise<Dosar[]>;
  budgetMs?: number;
}

interface NameSoapTarget {
  name_normalized: string;
  institutie?: string[];
}

export function createNameSoapRunner(deps: NameSoapRunnerDeps): JobRunner {
  const budgetMs = deps.budgetMs ?? DEFAULT_BUDGET_MS;

  return {
    async run({ job, runId, nowIso, signal }): Promise<RunOutcome> {
      const budgetSignal = AbortSignal.timeout(budgetMs);
      const composed = AbortSignal.any([signal, budgetSignal]);

      const target = JSON.parse(job.target_json) as NameSoapTarget;
      const alertConfig = AlertConfigSchema.parse(
        JSON.parse(job.alert_config_json),
      );

      let dosare: Dosar[];
      try {
        dosare = await fetchForTarget(deps.searchDosare, target, composed);
      } catch (err) {
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

      const currentSnapshot = buildNameSoapSnapshot(dosare, nowIso);

      let alertsCreated = 0;
      let oversizeOutcome: RunOutcome | null = null;
      await withMaintenanceRead(async () => {
        const prevRow = getLatestSnapshot(job.owner_id, job.id);
        const prevSnapshot = prevRow
          ? (JSON.parse(prevRow.payload_json) as NameSoapSnapshotPayload)
          : null;

        const { newSnapshot, alerts } = diffNameSoap({
          prevSnapshot,
          currentSnapshot,
          alertConfig,
          now: nowIso,
        });

        const newSnapshotJson = canonicalJson(newSnapshot);
        const payloadBytes = Buffer.byteLength(newSnapshotJson, "utf8");
        if (payloadBytes > SNAPSHOT_PAYLOAD_MAX_BYTES) {
          insertAlert({
            ownerId: job.owner_id,
            jobId: job.id,
            runId,
            kind: "source_error",
            severity: "warning",
            title: "Snapshot peste plafon (1 MiB) - refuzat la scriere",
            detail: {
              error_code: "SNAPSHOT_OVERSIZE",
              payload_bytes: payloadBytes,
              max_bytes: SNAPSHOT_PAYLOAD_MAX_BYTES,
              dropped_alerts: alerts.length,
              recommendation: "Restrange cautarea prin institutie sau imparte lista.",
            },
            dedupKey: `snapshot_oversize|${runId}`,
          });
          alertsCreated = 1;
          oversizeOutcome = {
            status: "error",
            errorCode: "SNAPSHOT_OVERSIZE",
            errorMessage: `payload ${payloadBytes}B > cap ${SNAPSHOT_PAYLOAD_MAX_BYTES}B`,
            alertsCreated: 1,
          };
          return;
        }

        getDb().transaction(() => {
          insertSnapshot({
            ownerId: job.owner_id,
            jobId: job.id,
            runId,
            observedAt: nowIso,
            payloadHash: canonicalSha256(newSnapshot),
            payloadJson: newSnapshotJson,
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

      if (oversizeOutcome) return oversizeOutcome;
      return { status: "ok", alertsCreated };
    },
  };
}

async function fetchForTarget(
  searchDosare: NameSoapRunnerDeps["searchDosare"],
  target: NameSoapTarget,
  signal: AbortSignal,
): Promise<Dosar[]> {
  const institutii = target.institutie?.length ? target.institutie : [undefined];
  const byNumar = new Map<string, Dosar>();
  for (const institutie of institutii) {
    const rows = await searchDosare(
      { numeParte: target.name_normalized, institutie },
      { signal },
    );
    for (const dosar of rows) {
      if (dosar.numar) byNumar.set(dosar.numar, dosar);
    }
  }
  return Array.from(byNumar.values());
}

export type { ScheduledJob };
