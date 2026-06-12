import type { Dosar, SearchParams } from "../../soap.ts";
import type { JobRunner, RunOutcome, ScheduledJob } from "./scheduler.ts";
import { AlertConfigSchema } from "../../schemas/monitoring.ts";
import { canonicalJson, canonicalSha256 } from "../../util/canonicalJson.ts";
import { stripDiacritics } from "../../util/textNormalize.ts";
import { buildNameSoapSnapshot, diffNameSoap, type NameSoapPrevSnapshot } from "./diff/nameSoap.ts";
import { SNAPSHOT_PAYLOAD_MAX_BYTES } from "./diff/types.ts";
import { deletePriorSnapshots, getLatestSnapshot, insertSnapshot } from "../../db/monitoringSnapshotsRepository.ts";
import {
  recordAndDispatchAlert as insertAlert,
  dispatchInsertedAlertEmails,
  type InsertAlertResult,
} from "../alerts/alertEventService.ts";
import { withMaintenanceRead } from "../../db/backup.ts";
import { getDb } from "../../db/schema.ts";

const DEFAULT_BUDGET_MS = 10 * 60 * 1000;

// v2.20.8 a introdus source_partial ca opt-in de rollout; v2.37.1 a inchis
// rollout-ul si a flipat default-ul pe ON (vezi comentariul din functie).
// Lazy read prin functie (in loc de constanta module-top) ca testele sa poata
// flip-ui flag-ul dupa importarea modulului.
export function partialAlertsEnabled(): boolean {
  // v2.37.1: default ON — fereastra de rollout v2.20.8 ("flip dupa 24-48h de
  // productie linistita") s-a incheiat demult; default-ul OFF insemna ca un
  // outage partial de instanta ramanea doar console.warn, invizibil pentru
  // user. `=0` ramane kill switch-ul de intoarcere.
  return process.env.MONITORING_PARTIAL_ALERTS_ENABLED !== "0";
}

interface PartialInstitutie {
  institutie: string | undefined;
  error: string;
}

export interface NameSoapRunnerDeps {
  searchDosare: (params: SearchParams, opts?: { signal?: AbortSignal }) => Promise<Dosar[]>;
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
      const alertConfig = AlertConfigSchema.parse(JSON.parse(job.alert_config_json));

      let dosare: Dosar[];
      let partialInstitutii: PartialInstitutie[] = [];
      try {
        const result = await fetchForTarget(deps.searchDosare, target, composed);
        dosare = result.dosare;
        partialInstitutii = result.failedInstitutii;
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
      // v2.34.0 P1-6: collect alert results during persistence so emails fire
      // only AFTER the SQLite transaction commits. See alertEventService.ts.
      const insertedResults: InsertAlertResult[] = [];
      await withMaintenanceRead(async () => {
        const prevRow = getLatestSnapshot(job.owner_id, job.id);
        const prevSnapshot = prevRow ? (JSON.parse(prevRow.payload_json) as NameSoapPrevSnapshot) : null;

        const { newSnapshot, alerts } = diffNameSoap({
          prevSnapshot,
          currentSnapshot,
          alertConfig,
          now: nowIso,
          jobCreatedAt: job.created_at,
          // v2.37.1 (review cluster 1): ancora dedup per-baseline + lista
          // institutiilor picate, ca diff-ul sa nu transforme un fan-out
          // partial in dosar_disappeared fals (si sa nu arda slotul dedup).
          prevSnapshotId: prevRow?.id ?? null,
          failedInstitutii: partialInstitutii
            .map((f) => f.institutie)
            .filter((x): x is string => typeof x === "string" && x.length > 0),
        });

        const newSnapshotJson = canonicalJson(newSnapshot);
        const payloadBytes = Buffer.byteLength(newSnapshotJson, "utf8");
        if (payloadBytes > SNAPSHOT_PAYLOAD_MAX_BYTES) {
          // F10: numaram doar inserturile reale, nu generarile diff-ului —
          // dedup_key duplicat = no-op, nu vrem sa inflam metrica
          // `alerts_created` din `monitoring_runs`.
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
              recommendation: "Restrange cautarea prin institutie sau imparte lista.",
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
          // Inbox/native notification need to identify the watched name and
          // (when the alert is per-dosar) the specific case. The diff layer is
          // pure, so we attach name_normalized at the runner boundary; per-dosar
          // alerts already include numar_dosar in their detail from the diff.
          const targetContext = { name_normalized: target.name_normalized };
          // F10: numaram doar inserturile reale, nu generarile diff-ului —
          // dedup_key duplicat = no-op, nu vrem sa inflam metrica
          // `alerts_created` din `monitoring_runs`.
          for (const alert of alerts) {
            const result = insertAlert({
              ownerId: job.owner_id,
              jobId: job.id,
              runId,
              kind: alert.kind,
              severity: alert.severity,
              title: alert.title,
              detail: { ...targetContext, ...alert.detail },
              dedupKey: alert.dedupKey,
            });
            insertedResults.push(result);
            if (result.inserted) insertedCount += 1;
          }
        })();
        alertsCreated = insertedCount;
      });

      if (oversizeOutcome) {
        // v2.34.0 P1-6: oversize alert lives outside the transaction, but we
        // still defer email dispatch to here so the dispatch site is the same
        // for both branches.
        dispatchInsertedAlertEmails(insertedResults);
        return oversizeOutcome;
      }

      // v2.20.8 — Batch 2.1: emit source_partial daca cel putin o institutie a
      // esuat dar nu toate (cazul "all failed" e tratat de fetchForTarget care
      // arunca si cade pe SOAP_FAIL). Dedup_key per run ca alerta sa nu se
      // duplice daca runner-ul ruleaza in retry chain. Gated de flag pentru
      // rollout treptat (vezi comentariu la PARTIAL_ALERTS_ENABLED).
      if (partialAlertsEnabled() && partialInstitutii.length > 0) {
        await withMaintenanceRead(async () => {
          const partialResult = insertAlert({
            ownerId: job.owner_id,
            jobId: job.id,
            runId,
            kind: "source_partial",
            severity: "warning",
            title: `Monitorizare incompleta (${partialInstitutii.length} institutii indisponibile)`,
            detail: {
              name_normalized: target.name_normalized,
              failed_institutii: partialInstitutii.map((f) => ({
                institutie: f.institutie ?? null,
                error: f.error,
              })),
              recommendation: "Diff-ul reflecta doar institutiile reusite. Retry la urmatorul tick.",
            },
            // run-scoped dedup_key: orice retry pe acelasi run produce same key,
            // dar runuri diferite emit alerta noua (operatorul vede recurenta).
            dedupKey: `source_partial|${runId}`,
          });
          insertedResults.push(partialResult);
          if (partialResult.inserted) alertsCreated += 1;
        });
      }

      // v2.34.0 P1-6: dispatch emails AFTER both the snapshot transaction and
      // the optional source_partial write commit. If either threw, we never
      // reach here.
      dispatchInsertedAlertEmails(insertedResults);

      // F10 asymmetry note: name_soap does not call enrichSolutieAlertsForJob
      // (the sedinta-level backfill is anchored to numar_dosar identity, which
      // a name watch lacks). alertsPatched is intentionally omitted -> finalize
      // stores 0. If a name-list enrichment path is added later, surface the
      // count here the same way dosarSoapRunner does.
      return { status: "ok", alertsCreated };
    },
  };
}

async function fetchForTarget(
  searchDosare: NameSoapRunnerDeps["searchDosare"],
  target: NameSoapTarget,
  signal: AbortSignal
): Promise<{ dosare: Dosar[]; failedInstitutii: PartialInstitutie[] }> {
  const institutii = target.institutie?.length ? target.institutie : [undefined];
  const byNumar = new Map<string, Dosar>();
  // v2.17.0 — partial-success on multi-institution targets. Pre-fix, a single
  // SOAP failure on iteration N (e.g. PortalJust 504 for Curtea de Apel Cluj)
  // would throw and lose the rows already collected from iterations 0..N-1.
  // For a 5-institution target with one flaky court, the user got a
  // SOAP_FAIL/source_error alert instead of 4 courts' worth of legitimate
  // diff. Now: try each institution, log the failures, and only re-throw if
  // every single institution failed (= upstream-down, the right time to alert
  // SOAP_FAIL). If `signal.aborted` fires mid-loop we stop early — the run
  // outcome path in the caller maps that to status="aborted".
  const failedInstitutii: PartialInstitutie[] = [];
  for (const institutie of institutii) {
    if (signal.aborted) throw new Error("aborted");
    try {
      const rows = await searchDosare({ numeParte: target.name_normalized, institutie }, { signal });
      for (const dosar of rows) {
        if (dosar.numar) byNumar.set(dosar.numar, dosar);
      }
    } catch (err) {
      // Abort/timeout semantics belong to the caller (composed signal in run()):
      // re-throw so they get mapped to aborted/timeout outcomes, not a partial
      // success with failedInstitutii. Only swallow per-institution upstream
      // errors (network blip, 5xx, parse fail).
      if (signal.aborted) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      failedInstitutii.push({ institutie, error: msg });
      console.warn(`[nameSoapRunner] partial: institutie=${institutie ?? "<all>"} failed: ${msg}`);
    }
  }
  if (failedInstitutii.length === institutii.length) {
    const summary = failedInstitutii.map((f) => `${f.institutie ?? "<all>"}: ${f.error}`).join("; ");
    throw new Error(`all institutions failed — ${summary}`);
  }
  // Strict-word filter (2026-05-03): PortalJust returneaza dosare unde oricare
  // dintre cuvintele numele subiectului apare ca substring intr-una dintre
  // parti. Asta produce false-pozitive masive ("GLOBAL LOGISTICS SA" ajunge in
  // rezultat cand monitorizam "GLOBAL LEARNING LOGISTICS"). Aplicam un filtru
  // post-fetch: pastram doar dosarele unde MACAR O parte are TOATE cuvintele
  // numelui ca tokeni distincti. "&" e tratat ca propriul token indiferent
  // de spatii ("ABC&XYZ" si "ABC & XYZ" sunt echivalente).
  const matching: Dosar[] = [];
  for (const dosar of byNumar.values()) {
    if (dosarMatchesAllNameTokens(dosar, target.name_normalized)) {
      matching.push(dosar);
    }
  }
  return { dosare: matching, failedInstitutii };
}

// Tokenizare comuna pentru target + parti: diacritice strip + UPPERCASE +
// "&" promovat ca token de sine statator + split pe whitespace.
export function tokenizeNameForMatch(s: string): string[] {
  return stripDiacritics(String(s ?? ""))
    .toUpperCase()
    .replace(/&/g, " & ")
    .split(/\s+/)
    .filter(Boolean);
}

// Sufixele de forma juridica (SRL, SA si echivalente) NU sunt parte din
// numele subiectului — pot lipsi sau aparea in forme diverse ("S.R.L.",
// "S.R.L", "SRL.") fara sa schimbe identitatea entitatii. Ignoram aceste
// tokeni de la coada listei la match. Cheia in set este forma fara puncte
// (S.R.L. → SRL la lookup).
const LEGAL_SUFFIX_TOKENS = new Set([
  "SRL", // Societate cu Raspundere Limitata
  "SA", // Societate pe Actiuni
  "SCA", // Societate Civila de Avocati / in Comandita pe Actiuni
  "SNC", // Societate in Nume Colectiv
  "SCS", // Societate in Comandita Simpla
  "PFA", // Persoana Fizica Autorizata
  "IF", // Intreprindere Familiala
  "LLC", // Limited Liability Company (entitati internationale uzuale)
  "LTD", // Limited
  "INC", // Incorporated
]);

function isLegalSuffixToken(token: string): boolean {
  // Strip "." (S.R.L. → SRL) si "," (rare) inainte de lookup.
  const cleaned = token.replace(/[.,]/g, "");
  return LEGAL_SUFFIX_TOKENS.has(cleaned);
}

// Elimina suffix-urile legale CONSECUTIVE de la coada listei. "X SRL" → ["X"];
// "X S.R.L." → ["X"]; "X" (fara suffix) → ["X"]; "Y LLC LTD" → ["Y"]. Pastram
// "II" / cifre romane si alte cuvinte care nu apar in lista legala.
export function stripLegalSuffix(tokens: string[]): string[] {
  let end = tokens.length;
  while (end > 0) {
    const token = tokens[end - 1];
    if (!token || !isLegalSuffixToken(token)) break;
    end--;
  }
  return tokens.slice(0, end);
}

// Strict word match: tokenii targetului (excluzand sufixul legal de forma
// juridica) trebuie sa fie acelasi set cu tokenii unei parti. SRL/SA in target
// sau in party sunt ignorate - nu valideaza, nu invalideaza match-ul.
//
// Cazul fara parti = false (fara nume sa verificam → nu confirmam match-ul).
// Cazul targetCore gol (target = doar sufixe legale, ex. "SRL") = false: nu
// avem cu ce sa facem match strict; fail-closed ca sa nu inundam inbox-ul cu
// pseudo-pozitive (orice dosar cu o parte SRL ar trece).
export function dosarMatchesAllNameTokens(dosar: Dosar, targetName: string): boolean {
  const targetCore = stripLegalSuffix(tokenizeNameForMatch(targetName));
  if (targetCore.length === 0) return false;
  if (!dosar.parti || dosar.parti.length === 0) return false;
  const targetSet = new Set(targetCore);
  for (const parte of dosar.parti) {
    const partyCore = stripLegalSuffix(tokenizeNameForMatch(parte.nume));
    if (partyCore.length !== targetSet.size) continue;
    const partySet = new Set(partyCore);
    if (partySet.size !== targetSet.size) continue;
    let allPresent = true;
    for (const token of targetCore) {
      if (!partySet.has(token)) {
        allPresent = false;
        break;
      }
    }
    if (allPresent) return true;
  }
  return false;
}

export type { ScheduledJob };
