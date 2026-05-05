// PR-4 diff engine — pure function that turns a (prev snapshot, current Dosar)
// pair into a (new snapshot, alerts[]) result. No DB access, no I/O, no clock
// reads beyond the `now` argument: every output is a function of inputs.
//
// Why pure: the scheduler in C2 owns timing, persistence, and SOAP. Keeping
// diff isolated lets us cover edge cases exhaustively in unit tests (5 alert
// kinds × filter-changed × dosar disappear/reappear cycles) without
// orchestrating a full job lifecycle. Regressions in alert correctness are
// the single highest-cost bug in monitoring (false positives erode trust,
// false negatives miss the deadline) — TDD here pays back the cost.
//
// Snapshot shape mirrors PLAN-monitoring-webmode.md §5.1:
//   sedintaKeys           — exact-match keys (with solutie) in the filtered view
//   lastDosarPresent      — was the dosar visible last tick (post-filter)?
//   sedinteWithSolution   — keyWithoutSolutie → had-solutie? (drives solutie_aparuta)
//   filterFingerprint     — sha256 of (stadii, categorii); changing it resets diff
//
// The filter fingerprint is the safety net for the scenario "user narrows
// filter, hides 5 termene, then unfiltering would re-emit those 5 as
// termen_new" — instead, the next tick after a filter change is treated as
// a baseline (no alerts) because the snapshot's logical scope changed.

import { createHash } from "node:crypto";
import type { AlertConfig } from "../../../schemas/monitoring.ts";
import type { Dosar } from "../../../soap.ts";
import { canonicalJson } from "../../../util/canonicalJson.ts";
import { buildSedintaKey, buildSedintaKeyWithoutSolutie, normalizeStadiu } from "../sedintaKey.ts";
import type { DiffAlertEmit as GenericDiffAlertEmit } from "./types.ts";

// --- types ----------------------------------------------------------------

export type DiffAlertKind =
  | "dosar_new"
  | "termen_new"
  | "termen_changed"
  | "termen_dupa_solutie"
  | "solutie_aparuta"
  | "dosar_disappeared";

// Specializare a tipului generic din ./types.ts pe uniunea de alerte
// emise de diff-ul dosar_soap. Pastrat ca alias public pentru ca
// runner-ul poate (in viitor) avea nevoie sa tipeze rezultatul direct.
export type DiffAlertEmit = GenericDiffAlertEmit<DiffAlertKind>;

export interface DiffSnapshotPayload {
  sedintaKeys: string[];
  lastDosarPresent: boolean;
  sedinteWithSolution: Record<string, boolean>;
  filterFingerprint: string;
}

export interface DiffInput {
  prevSnapshot: DiffSnapshotPayload | null;
  currentDosar: Dosar | null;
  alertConfig: AlertConfig;
  // ISO timestamp; embedded in alert detail so the UI can render "observed at".
  // No longer used for dedup keys.
  now: string;
  // Constatare adversiala #4: stable anchor pentru cheile dedup ale tranzitiilor
  // (dosar_new / dosar_disappeared). Folosim id-ul prev snapshot-ului — singurul
  // identificator care e STABIL intre re-run-uri pe acelasi baseline (replay,
  // manual-trigger, retry dupa eroare tranzitorie). Cu runId, doua executii
  // succesive impotriva aceluiasi prev_snapshot ar genera chei diferite si ar
  // emite duplicate; cu prev_snapshot_id, ON CONFLICT(job_id, dedup_key) DO
  // NOTHING absoarbe corect retry-ul. Null doar atunci cand prev e null
  // (primul tick), caz in care nu emitem nicio tranzitie oricum.
  prevSnapshotId: number | null;
}

export interface DiffOutput {
  newSnapshot: DiffSnapshotPayload;
  alerts: DiffAlertEmit[];
  // Diagnostic — null in the normal path, "filter_changed" when the snapshot
  // was rebaselined because alertConfig.stadii or .categorii changed.
  resetReason: "filter_changed" | null;
}

// --- helpers --------------------------------------------------------------

// The fingerprint participates in reset detection. Only fields that change
// the *scope* of monitored data belong here; toggles like notify_on_solution
// just gate emission and must NOT trigger a reset.
//
// Sets are normalized + sorted so {Apel, Fond} and {Fond, Apel} fingerprint
// identically — preserving order would mint phantom resets on cosmetic UI
// reorderings.
export function computeFilterFingerprint(alertConfig: AlertConfig): string {
  const stadii = alertConfig.stadii ? Array.from(new Set(alertConfig.stadii.map(normalizeStadiu))).sort() : null;
  const categorii = alertConfig.categorii
    ? Array.from(new Set(alertConfig.categorii.map(normalizeStadiu))).sort()
    : null;
  return createHash("sha256").update(canonicalJson({ stadii, categorii }), "utf8").digest("hex");
}

// v2.16.0 — Format raw PortalJust date for human-readable alert titles.
// PortalJust serializes session dates as "yyyy-mm-dd" or, for solution sedinte,
// as full ISO datetime "yyyy-mm-ddT00:00:00". The hour part is always 00:00:00
// (real time lives in the `ora` field), so it's noise that crowds the title.
// Convert to "dd.mm.yyyy"; fall back to the raw value if the prefix doesn't
// match the expected shape (forward-compatible with future PortalJust quirks).
function formatTitleDate(raw: string): string {
  if (!raw) return raw;
  const isoDay = raw.split("T")[0];
  const m = isoDay?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return raw;
  const [, y, mo, d] = m;
  return `${d}.${mo}.${y}`;
}

// Returns true if the Dosar passes alertConfig's stadii + categorii filters.
// Empty filter (undefined) = pass-through. Normalization mirrors the
// fingerprint helper so "APEL" filter matches "Apel" stadiuProcesual.
function dosarPassesFilter(dosar: Dosar, alertConfig: AlertConfig): boolean {
  if (alertConfig.stadii?.length) {
    const want = new Set(alertConfig.stadii.map(normalizeStadiu));
    if (!want.has(normalizeStadiu(dosar.stadiuProcesual))) return false;
  }
  if (alertConfig.categorii?.length) {
    const want = new Set(alertConfig.categorii.map(normalizeStadiu));
    if (!want.has(normalizeStadiu(dosar.categorieCaz))) return false;
  }
  return true;
}

// Build snapshot from current Dosar. `null` = dosar absent (or filtered out).
function buildSnapshot(dosar: Dosar | null, filterFingerprint: string): DiffSnapshotPayload {
  if (!dosar) {
    return {
      sedintaKeys: [],
      lastDosarPresent: false,
      sedinteWithSolution: {},
      filterFingerprint,
    };
  }
  const sedintaKeys: string[] = [];
  const sedinteWithSolution: Record<string, boolean> = {};
  for (const s of dosar.sedinte) {
    const input = {
      stadiuProcesual: dosar.stadiuProcesual,
      data: s.data,
      ora: s.ora,
      complet: s.complet,
      solutie: s.solutie,
    };
    sedintaKeys.push(buildSedintaKey(input));
    sedinteWithSolution[buildSedintaKeyWithoutSolutie(input)] = (s.solutie ?? "").trim().length > 0;
  }
  return {
    sedintaKeys,
    lastDosarPresent: true,
    sedinteWithSolution,
    filterFingerprint,
  };
}

// Split a sedintaKey back into segments. Stable inverse of buildSedintaKey
// because we control both ends and `|` is rejected from any input field.
function parseSedintaKey(key: string): {
  stadiu: string;
  data: string;
  ora: string;
  complet: string;
  solutie: string;
} {
  const [stadiu = "", data = "", ora = "", complet = "", ...rest] = key.split("|");
  // solutie may legitimately contain `|`-resembling text after entity decode,
  // so reassemble whatever follows the 4th separator.
  return { stadiu, data, ora, complet, solutie: rest.join("|") };
}

// --- main -----------------------------------------------------------------

export function diffDosarSoap(input: DiffInput): DiffOutput {
  const { prevSnapshot, currentDosar, alertConfig, now, prevSnapshotId } = input;
  const filterFingerprint = computeFilterFingerprint(alertConfig);

  // Pre-diff filter: dosar that doesn't pass stadii/categorii is treated as
  // absent for snapshot/alert purposes. The fingerprint still moves with the
  // user's intent so subsequent unfilter resets cleanly.
  const filteredDosar = currentDosar && dosarPassesFilter(currentDosar, alertConfig) ? currentDosar : null;
  const newSnapshot = buildSnapshot(filteredDosar, filterFingerprint);

  // First tick: just baseline, never alert.
  if (!prevSnapshot) {
    return { newSnapshot, alerts: [], resetReason: null };
  }

  // Filter change: rebaseline silently. Otherwise, hidden-then-shown sedinte
  // would parade as termen_new on the next unfiltering.
  if (prevSnapshot.filterFingerprint !== filterFingerprint) {
    return { newSnapshot, alerts: [], resetReason: "filter_changed" };
  }

  const alerts: DiffAlertEmit[] = [];

  // --- dosar appearance/disappearance transitions ---
  // prevSnapshot e non-null aici (ramura de mai sus filtreaza prev=null), deci
  // prevSnapshotId e si el non-null in caz uzual; folosim un fallback stabil
  // doar ca defense-in-depth pentru un caller care ar trimite prev fara id.
  //
  // Prefix `s` (snapshot) namespace-eaza cheia pentru a evita coliziunea cu
  // formatul vechi (runId-based) emis de versiunile <= 2.2.0. Fara prefix, un
  // prevSnapshotId care coincide numeric cu un runId ramas in DB ar fi absorbit
  // tacut de ON CONFLICT(job_id, dedup_key) DO NOTHING (false negative).
  const transitionAnchor = `s${prevSnapshotId ?? "init"}`;
  if (prevSnapshot.lastDosarPresent && !filteredDosar) {
    if (alertConfig.notify_on_dosar_disappeared) {
      alerts.push({
        kind: "dosar_disappeared",
        severity: "warning",
        title: "Dosarul nu mai apare la PortalJust",
        detail: { observedAt: now },
        dedupKey: `dosar_disappeared|${transitionAnchor}`,
      });
    }
    return { newSnapshot, alerts, resetReason: null };
  }

  if (!prevSnapshot.lastDosarPresent && filteredDosar) {
    // Reappearance (or first true presence after a filtered-out baseline).
    // Emit ONE dosar_new — never enumerate sedinte as termen_new (would
    // flood the alert list every time a watched dosar comes back online).
    alerts.push({
      kind: "dosar_new",
      severity: "info",
      title: "Dosarul a aparut la PortalJust",
      detail: { observedAt: now, sedinteCount: filteredDosar.sedinte.length },
      dedupKey: `dosar_new|${transitionAnchor}`,
    });
    return { newSnapshot, alerts, resetReason: null };
  }

  if (!prevSnapshot.lastDosarPresent && !filteredDosar) {
    // Both ticks absent — no transition, no alert.
    return { newSnapshot, alerts, resetReason: null };
  }

  // --- both ticks present: sedinta-level diff ---
  const prevKeys = new Set(prevSnapshot.sedintaKeys);
  const currentKeys = new Set(newSnapshot.sedintaKeys);

  // Keys that exist now but didn't before.
  const candidateNew = newSnapshot.sedintaKeys.filter((k) => !prevKeys.has(k));
  // Keys that existed before but don't now (plus consumed ones we'll subtract).
  const candidateMissingSet = new Set(prevSnapshot.sedintaKeys.filter((k) => !currentKeys.has(k)));

  // Index current sedinte by key for solutie inspection.
  const currentSedintaByKey = new Map<string, Dosar["sedinte"][number]>();
  for (const s of filteredDosar!.sedinte) {
    const key = buildSedintaKey({
      stadiuProcesual: filteredDosar!.stadiuProcesual,
      data: s.data,
      ora: s.ora,
      complet: s.complet,
      solutie: s.solutie,
    });
    currentSedintaByKey.set(key, s);
  }

  // Pass 1: solutie_aparuta detection. A current "new" key that shares its
  // keyWithoutSolutie with a prev key whose stored had-solutie flag was false,
  // and now has a non-empty solutie, is the same logical sedinta gaining its
  // ruling. Consume the matching prev key so termen_changed pairing in pass 2
  // doesn't double-count it.
  //
  // v2.15.0 — emisia este AMANATA pana dupa Pass 2: cand acelasi (stadiu,
  // complet) bucket primeste si o noua sedinta in Pass 2, cele doua se
  // contopesc intr-o singura alerta `termen_dupa_solutie` (cazul amanare:
  // "s-a dat solutie X la 04.05, s-a programat termen nou la 19.05" trebuie
  // sa fie un eveniment, nu doua alerte separate care confunda inboxul).
  const remainingNew: string[] = [];
  interface PendingSolutie {
    alert: DiffAlertEmit;
    sedinta: Dosar["sedinte"][number];
    sub: string;
  }
  const pendingSolutiiByBucket = new Map<string, PendingSolutie[]>();
  const pendingSolutiiOrdered: PendingSolutie[] = [];
  for (const k of candidateNew) {
    const sed = currentSedintaByKey.get(k);
    if (!sed) {
      remainingNew.push(k);
      continue;
    }
    const sub = buildSedintaKeyWithoutSolutie({
      stadiuProcesual: filteredDosar!.stadiuProcesual,
      data: sed.data,
      ora: sed.ora,
      complet: sed.complet,
      solutie: sed.solutie,
    });
    const prevHadSolutie = prevSnapshot.sedinteWithSolution[sub];
    const currentHasSolutie = (sed.solutie ?? "").trim().length > 0;
    if (prevHadSolutie === false && currentHasSolutie) {
      // The matching prev key has the same sub + empty solutie → "<sub>|".
      candidateMissingSet.delete(`${sub}|`);
      if (alertConfig.notify_on_solution) {
        const pending: PendingSolutie = {
          alert: {
            kind: "solutie_aparuta",
            severity: "info",
            title: `Solutie publicata: ${sed.solutie}`,
            detail: {
              data: sed.data,
              ora: sed.ora,
              complet: sed.complet,
              solutie: sed.solutie,
              // v2.6.2 — full ruling text + document anchor for the alerts UI
              // so the user sees the rationale without opening PortalJust. SOAP
              // returns these only when the ruling is published.
              solutie_sumar: sed.solutieSumar,
              numar_document: sed.numarDocument,
              data_pronuntare: sed.dataPronuntare,
            },
            dedupKey: `solutie_aparuta|${sub}`,
          },
          sedinta: sed,
          sub,
        };
        const bucketStadiu = normalizeStadiu(filteredDosar!.stadiuProcesual);
        const bucketComplet = (sed.complet ?? "").trim();
        const bucket = `${bucketStadiu}|${bucketComplet}`;
        const arr = pendingSolutiiByBucket.get(bucket) ?? [];
        arr.push(pending);
        pendingSolutiiByBucket.set(bucket, arr);
        pendingSolutiiOrdered.push(pending);
      }
      continue;
    }
    remainingNew.push(k);
  }

  // Pass 2: termen pairing. For each remaining new sedinta, in priority order:
  //   (a) exactly one prev "missing" sedinta shares (stadiu, complet) →
  //       termen_changed (pure reschedule);
  //   (b) a pending solutie sits in the same (stadiu, complet) bucket →
  //       termen_dupa_solutie (composite "amanare" alert; consumes the
  //       pending solutie so Pass 3 won't re-emit it as standalone);
  //   (c) otherwise → termen_new.
  // Multiple termen_changed candidates = ambiguous (fall back to (b)/(c))
  // so we never invent a pairing that didn't happen.
  const termenAlerts: DiffAlertEmit[] = [];
  const consumedPendingSolutii = new Set<PendingSolutie>();
  if (alertConfig.notify_on_new_termen) {
    // Bucket missing-prev keys by (stadiu, complet) for O(n) lookup.
    const missingByStadiuComplet = new Map<string, string[]>();
    for (const mk of candidateMissingSet) {
      const parsed = parseSedintaKey(mk);
      const bucket = `${parsed.stadiu}|${parsed.complet}`;
      const arr = missingByStadiuComplet.get(bucket) ?? [];
      arr.push(mk);
      missingByStadiuComplet.set(bucket, arr);
    }
    for (const k of remainingNew) {
      const parsed = parseSedintaKey(k);
      const bucket = `${parsed.stadiu}|${parsed.complet}`;
      const candidates = missingByStadiuComplet.get(bucket) ?? [];
      if (candidates.length === 1) {
        const oldKey = candidates[0]!;
        const old = parseSedintaKey(oldKey);
        termenAlerts.push({
          kind: "termen_changed",
          severity: "info",
          title: `Termen reprogramat: ${old.data} → ${parsed.data}`,
          detail: {
            from: { data: old.data, ora: old.ora, complet: old.complet },
            to: { data: parsed.data, ora: parsed.ora, complet: parsed.complet },
          },
          dedupKey: `termen_changed|${oldKey}|${k}`,
        });
        // Consume so a future remainingNew sharing the same bucket doesn't
        // re-pair against an already-claimed prev sedinta.
        missingByStadiuComplet.set(bucket, []);
        continue;
      }
      // No 1:1 reschedule. Try merging with a pending solutie on same bucket.
      const pendingArr = pendingSolutiiByBucket.get(bucket);
      // v2.17.0 — visibility log when more than one solutie is pending on the
      // same (stadiu, complet) bucket. The merge picks the first un-consumed
      // candidate; in normal traffic that's the only one. Multiple = same
      // panel issued ≥2 rulings on the same complet within one diff window,
      // which is unusual enough that we want a breadcrumb in stderr to
      // confirm the chosen merge target was the intended one.
      if (pendingArr && pendingArr.length > 1) {
        const unconsumed = pendingArr.filter((p) => !consumedPendingSolutii.has(p));
        if (unconsumed.length > 1) {
          console.warn(
            `[dosarSoap] multiple pending solutii in bucket ${bucket}; ` +
              `picking first un-consumed (count=${unconsumed.length})`,
          );
        }
      }
      const pending = pendingArr?.find((p) => !consumedPendingSolutii.has(p));
      if (pending) {
        consumedPendingSolutii.add(pending);
        const oldSed = pending.sedinta;
        termenAlerts.push({
          kind: "termen_dupa_solutie",
          severity: "info",
          title: `Termen nou dupa solutie: ${formatTitleDate(oldSed.data)} → ${formatTitleDate(parsed.data)}`,
          detail: {
            from: {
              data: oldSed.data,
              ora: oldSed.ora,
              complet: oldSed.complet,
              solutie: oldSed.solutie,
              solutie_sumar: oldSed.solutieSumar,
              numar_document: oldSed.numarDocument,
              data_pronuntare: oldSed.dataPronuntare,
            },
            to: {
              data: parsed.data,
              ora: parsed.ora,
              complet: parsed.complet,
              stadiu: parsed.stadiu,
            },
          },
          dedupKey: `termen_dupa_solutie|${pending.sub}|${k}`,
        });
        continue;
      }
      termenAlerts.push({
        kind: "termen_new",
        severity: "info",
        title: `Termen nou: ${parsed.data} ${parsed.ora}`.trim(),
        detail: {
          data: parsed.data,
          ora: parsed.ora,
          complet: parsed.complet,
          stadiu: parsed.stadiu,
        },
        dedupKey: `termen_new|${k}`,
      });
    }
  }

  // Pass 3: emit standalone solutie_aparuta for any pending solutie that
  // wasn't consumed by a termen_dupa_solutie merge in Pass 2. Preserve
  // detection order (matches Dosar.sedinte order from PortalJust); emit
  // BEFORE termen alerts so existing tests that snapshot kinds order
  // (solutii first, termene second) continue to pass.
  for (const pending of pendingSolutiiOrdered) {
    if (!consumedPendingSolutii.has(pending)) {
      alerts.push(pending.alert);
    }
  }
  alerts.push(...termenAlerts);

  return { newSnapshot, alerts, resetReason: null };
}
