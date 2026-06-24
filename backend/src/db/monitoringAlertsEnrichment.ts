// F4-F7 — solutie_aparuta backfill / enrichment, extracted from
// monitoringAlertsRepository.ts (Stage 10). PortalJust frequently publishes
// the ruling text (solutie_sumar / numar_document / data_pronuntare) one or
// more ticks AFTER the sedinta itself appears, so the alert emitted for the
// hearing initially has empty ruling fields. The dosar_soap runner calls
// `enrichSolutieAlertsForJob` on every tick to merge the freshly fetched
// ruling text back into existing alerts in-place, and SSE listeners are
// notified via the `alert_enriched` channel so open inbox tabs refresh.
//
// Lifted out of the repo file because it had grown to ~180 LOC of
// pure-business logic (matching, idempotency, SSE fanout) wrapped around the
// SQLite primitives — separating it keeps the repo focused on row CRUD and
// gives the enrichment subsystem a self-contained home with its own tests.

import { getDb } from "./schema.ts";

export interface SolutieEnrichmentInput {
  data: string;
  ora?: string;
  complet?: string;
  solutie: string;
  solutieSumar?: string;
  numarDocument?: string;
  dataPronuntare?: string;
}

export interface SolutieEnrichmentDosarContext {
  instanta?: string;
  stadiu?: string;
}

// F7 — Enrichment publisher hook. enrichSolutieAlertsForJob updates
// detail_json in place when a new ruling is published for an existing
// solutie_aparuta alert; the SSE channel needs a separate "alert was patched"
// event so the inbox can refresh its row without a manual reconnect. Mirrors
// the new-alert listener pattern from the repo (per-owner Set, isolated
// dispatch, no SQLite work in the callback path); routes/alerts.ts wires it
// into the SSE writer.
export interface AlertEnrichmentPayload {
  id: number;
  ownerId: string;
  jobId: number;
  detail: Record<string, unknown>;
}

export type AlertEnrichmentListener = (payload: AlertEnrichmentPayload) => void;

const alertEnrichmentListenersByOwner = new Map<string, Set<AlertEnrichmentListener>>();

export function addAlertEnrichmentListener(ownerId: string, listener: AlertEnrichmentListener): () => void {
  let listeners = alertEnrichmentListenersByOwner.get(ownerId);
  if (!listeners) {
    listeners = new Set();
    alertEnrichmentListenersByOwner.set(ownerId, listeners);
  }
  listeners.add(listener);
  return () => removeAlertEnrichmentListener(ownerId, listener);
}

export function removeAlertEnrichmentListener(ownerId: string, listener: AlertEnrichmentListener): void {
  const listeners = alertEnrichmentListenersByOwner.get(ownerId);
  if (!listeners) return;
  listeners.delete(listener);
  if (listeners.size === 0) {
    alertEnrichmentListenersByOwner.delete(ownerId);
  }
}

function notifyAlertEnriched(payload: AlertEnrichmentPayload): void {
  const listeners = alertEnrichmentListenersByOwner.get(payload.ownerId);
  if (!listeners || listeners.size === 0) return;
  for (const listener of listeners) {
    try {
      listener(payload);
    } catch (err) {
      console.error("[alerts] enrichment listener threw, isolating", err);
    }
  }
}

// v2.6.4 — enrich existing solutie_aparuta alerts whose detail_json was
// frozen with empty solutie_sumar / numar_document / data_pronuntare because
// PortalJust hadn't yet published the ruling text at the time the alert was
// emitted. The runner calls this on every dosar_soap tick after persisting
// new alerts; for each sedinta with a non-empty ruling, we look up the alert
// emitted for the same (data, ora, complet, solutie) tuple and merge the
// new fields in-place if they were missing. Idempotent: running it again
// when the data is already present is a no-op (only patches when at least
// one target field is currently empty/missing).
export function enrichSolutieAlertsForJob(
  ownerId: string,
  jobId: number,
  sedinte: SolutieEnrichmentInput[],
  dosarContext: SolutieEnrichmentDosarContext = {}
): number {
  const sedintaCandidates = sedinte.filter(
    (s) =>
      (s.solutieSumar?.trim().length ?? 0) > 0 ||
      (s.numarDocument?.trim().length ?? 0) > 0 ||
      (s.dataPronuntare?.trim().length ?? 0) > 0
  );
  const dosarInstanta = dosarContext.instanta?.trim();
  const dosarStadiu = dosarContext.stadiu?.trim();
  const haveDosarFields = (dosarInstanta?.length ?? 0) > 0 || (dosarStadiu?.length ?? 0) > 0;
  if (sedintaCandidates.length === 0 && !haveDosarFields) return 0;

  const db = getDb();
  // F4: alertele vechi pastreaza contextul lor istoric; nu suprascriem
  // stadiul/instanta cu valoarea curenta cand dosarul a tranzitat
  // fond->apel intre timp. Limitam fereastra de backfill la 7 zile, suficient
  // pentru cazul tipic "PortalJust publica hotararea cu cateva zile dupa
  // sedinta" si scurt destul cat sa nu suprascriem context istoric stale.
  // F5: LIMIT 200 ca safety cap imediat pe scan — chiar si pe joburi vechi
  // cu istoric dens, fereastra de 7 zile + cap-ul fac costul O(1) per tick.
  const rows = db
    .prepare(
      `SELECT id, detail_json FROM monitoring_alerts
       WHERE owner_id = ? AND job_id = ? AND kind = 'solutie_aparuta'
         AND created_at >= datetime('now', '-7 days')
       ORDER BY id DESC
       LIMIT 200`
    )
    .all(ownerId, jobId) as Array<{ id: number; detail_json: string }>;
  if (rows.length === 0) return 0;

  const update = db.prepare(
    `UPDATE monitoring_alerts SET detail_json = ?
     WHERE id = ? AND owner_id = ?`
  );

  let patched = 0;
  const enrichedNotifications: AlertEnrichmentPayload[] = [];
  const tx = db.transaction(() => {
    for (const row of rows) {
      let detail: Record<string, unknown>;
      try {
        const parsed = JSON.parse(row.detail_json) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
        detail = parsed as Record<string, unknown>;
      } catch {
        continue;
      }
      const dData = typeof detail.data === "string" ? detail.data : null;
      const dOra = typeof detail.ora === "string" ? detail.ora : null;
      const dComplet = typeof detail.complet === "string" ? detail.complet : null;
      const dSolutie = typeof detail.solutie === "string" ? detail.solutie : null;
      let mutated = false;
      if (dData) {
        // F6: PortalJust poate modifica usor textul solutiei intre alerta
        // initiala si publicarea hotararii (whitespace, accente); fallback-ul
        // pe (data, ora, complet) e suficient sa atribuim hotararea corect.
        // Normalizam ambele parti cu .trim() pentru match-ul strict, apoi
        // cadem pe match-ul fara solutie cand textul a divergat.
        const dSolutieTrim = dSolutie?.trim() ?? "";
        let match = dSolutie
          ? sedintaCandidates.find(
              (s) =>
                s.data === dData &&
                (s.ora ?? "") === (dOra ?? "") &&
                (s.complet ?? "") === (dComplet ?? "") &&
                s.solutie.trim() === dSolutieTrim
            )
          : undefined;
        if (!match) {
          match = sedintaCandidates.find(
            (s) => s.data === dData && (s.ora ?? "") === (dOra ?? "") && (s.complet ?? "") === (dComplet ?? "")
          );
        }
        if (match) {
          if (
            (typeof detail.solutie_sumar !== "string" || detail.solutie_sumar.trim().length === 0) &&
            match.solutieSumar &&
            match.solutieSumar.trim().length > 0
          ) {
            detail.solutie_sumar = match.solutieSumar;
            mutated = true;
          }
          if (
            (typeof detail.numar_document !== "string" || detail.numar_document.trim().length === 0) &&
            match.numarDocument &&
            match.numarDocument.trim().length > 0
          ) {
            detail.numar_document = match.numarDocument;
            mutated = true;
          }
          if (
            (typeof detail.data_pronuntare !== "string" || detail.data_pronuntare.trim().length === 0) &&
            match.dataPronuntare &&
            match.dataPronuntare.trim().length > 0
          ) {
            detail.data_pronuntare = match.dataPronuntare;
            mutated = true;
          }
        }
      }
      // Dosar-level fields (instanta, stadiu) apply to every alert for this
      // job regardless of which sedinta matched — they're properties of the
      // case itself. Backfilling them lets old alerts that were emitted when
      // currentDosar was null/empty pick up the court name once it appears.
      // F4 guard: query-ul de mai sus filtreaza deja alertele >7 zile, deci
      // contextul istoric mai vechi nu mai poate fi suprascris cu valoarea
      // curenta dupa o tranzitie fond->apel.
      if (dosarInstanta && (typeof detail.instanta !== "string" || detail.instanta.trim().length === 0)) {
        detail.instanta = dosarInstanta;
        mutated = true;
      }
      if (dosarStadiu && (typeof detail.stadiu !== "string" || detail.stadiu.trim().length === 0)) {
        detail.stadiu = dosarStadiu;
        mutated = true;
      }
      if (mutated) {
        update.run(JSON.stringify(detail), row.id, ownerId);
        patched += 1;
        // F7: colectam payload-urile pentru SSE; nu emitem din interiorul
        // tranzactiei ca listenerii sa nu ruleze sub write lock.
        enrichedNotifications.push({
          id: row.id,
          ownerId,
          jobId,
          detail: { ...detail },
        });
      }
    }
  });
  tx();
  // F7: defer fanout dupa commit, similar cu pattern-ul din insertAlert.
  if (enrichedNotifications.length > 0) {
    queueMicrotask(() => {
      for (const payload of enrichedNotifications) {
        notifyAlertEnriched(payload);
      }
    });
  }
  return patched;
}
