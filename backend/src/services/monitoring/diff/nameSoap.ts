import type { AlertConfig } from "../../../schemas/monitoring.ts";
import type { Dosar } from "../../../soap.ts";
import type { DiffAlertEmit as GenericDiffAlertEmit } from "./types.ts";

export type NameSoapAlertKind =
  | "dosar_new"
  | "dosar_disappeared"
  | "stadiu_changed"
  | "categorie_changed"
  | "dosar_relevant_now"
  | "dosar_no_longer_relevant";

export type NameSoapDiffAlert = GenericDiffAlertEmit<NameSoapAlertKind>;

export interface NameSoapSnapshotDosar {
  numar: string;
  stadiu: string;
  categorie: string;
  instanta: string;
  latest_sedinta_at: string | null;
}

export interface NameSoapSnapshotPayload {
  version: 2;
  fetched_at: string;
  dosare: NameSoapSnapshotDosar[];
}

// Pre-bump snapshots din v2.29.0 au `version: 1`. Le acceptam la citire ca
// reader-ul sa nu pice cand intalneste un baseline scris inainte de bump.
export interface NameSoapSnapshotPayloadV1 {
  version: 1;
  fetched_at: string;
  dosare: NameSoapSnapshotDosar[];
}

export type NameSoapPrevSnapshot = NameSoapSnapshotPayload | NameSoapSnapshotPayloadV1;

export interface NameSoapDiffInput {
  prevSnapshot: NameSoapPrevSnapshot | null;
  currentSnapshot: NameSoapSnapshotPayload;
  alertConfig: AlertConfig;
  now: string;
  jobCreatedAt: string;
}

export interface NameSoapDiffOutput {
  newSnapshot: NameSoapSnapshotPayload;
  alerts: NameSoapDiffAlert[];
}

function normalizeFilterValue(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function dosarPassesFilter(dosar: NameSoapSnapshotDosar, alertConfig: AlertConfig): boolean {
  if (alertConfig.stadii?.length) {
    const want = new Set(alertConfig.stadii.map(normalizeFilterValue));
    if (!want.has(normalizeFilterValue(dosar.stadiu))) return false;
  }
  if (alertConfig.categorii?.length) {
    const want = new Set(alertConfig.categorii.map(normalizeFilterValue));
    if (!want.has(normalizeFilterValue(dosar.categorie))) return false;
  }
  return true;
}

function byNumar(snapshot: NameSoapPrevSnapshot): Map<string, NameSoapSnapshotDosar> {
  const m = new Map<string, NameSoapSnapshotDosar>();
  for (const dosar of snapshot.dosare) {
    if (dosar.numar) m.set(dosar.numar, dosar);
  }
  return m;
}

function dedupKey(numar: string, transition: NameSoapAlertKind): string {
  return `name_soap|${numar}|${transition}`;
}

function computeLatestSedinta(dosar: Dosar): string | null {
  if (!dosar.sedinte || dosar.sedinte.length === 0) return null;
  // PortalJust returneaza in mod normal ISO 8601 (YYYY-MM-DD), unde comparatia
  // lexicografica e echivalenta cu cea cronologica. Dar nu garantam formatul
  // — daca apare DD.MM.YYYY sau alt format mixt, comparatia lexicografica
  // produce un rezultat gresit. Folosim Date.parse strict pentru a ignora
  // input-urile invalide si pentru a compara cronologic real.
  let maxTime = Number.NEGATIVE_INFINITY;
  let maxValue: string | null = null;
  for (const sedinta of dosar.sedinte) {
    for (const candidate of [sedinta.data, sedinta.dataPronuntare] as unknown[]) {
      if (typeof candidate !== "string") continue;
      const value = candidate.trim();
      if (!value) continue;
      const t = Date.parse(value);
      if (!Number.isFinite(t)) continue;
      if (t > maxTime) {
        maxTime = t;
        maxValue = value;
      }
    }
  }
  return maxValue;
}

function logInvalidHistoricDate(dosar: NameSoapSnapshotDosar, jobCreatedAt: string): void {
  console.error("[diffNameSoap.isHistoricNoise] invalid date input", {
    dosar_numar: dosar.numar,
    job_created_at: jobCreatedAt,
    latest_sedinta_at: dosar.latest_sedinta_at ?? null,
  });
}

// Gated de env ca sa nu polueze log-ul productiv. Activeaza cu
// `MONITORING_DEBUG_HISTORIC=1` cand investighezi de ce un dosar a fost (sau nu)
// suprimat la primul tick.
function logHistoricSuppressed(
  dosar: NameSoapSnapshotDosar,
  jobCreatedAt: string,
  reason: "no_latest_sedinta_pre_year" | "latest_sedinta_before_job_creation"
): void {
  if (process.env.MONITORING_DEBUG_HISTORIC !== "1") return;
  console.debug("[diffNameSoap.isHistoricNoise] suppressed", {
    dosar_numar: dosar.numar,
    job_created_at: jobCreatedAt,
    latest_sedinta_at: dosar.latest_sedinta_at ?? null,
    reason,
  });
}

function isHistoricNoise(dosar: NameSoapSnapshotDosar, jobCreatedAt: string): boolean {
  const m = dosar.numar.match(/\/(\d{4})(?:\/|$)/);
  if (!m) return false;
  const dosarYear = Number.parseInt(m[1], 10);
  const jobTime = Date.parse(jobCreatedAt);
  const jobYear = new Date(jobTime).getUTCFullYear();
  if (!Number.isFinite(dosarYear) || Number.isNaN(jobYear)) {
    logInvalidHistoricDate(dosar, jobCreatedAt);
    return false;
  }
  if (dosarYear >= jobYear) return false;
  if (!dosar.latest_sedinta_at) {
    logHistoricSuppressed(dosar, jobCreatedAt, "no_latest_sedinta_pre_year");
    return true;
  }
  const latestTime = Date.parse(dosar.latest_sedinta_at);
  if (!Number.isFinite(latestTime)) {
    logInvalidHistoricDate(dosar, jobCreatedAt);
    return false;
  }
  if (latestTime <= jobTime) {
    logHistoricSuppressed(dosar, jobCreatedAt, "latest_sedinta_before_job_creation");
    return true;
  }
  return false;
}

export function buildNameSoapSnapshot(dosare: Dosar[], fetchedAt: string): NameSoapSnapshotPayload {
  const byNumber = new Map<string, NameSoapSnapshotDosar>();
  for (const dosar of dosare) {
    const numar = String(dosar.numar ?? "").trim();
    if (!numar) continue;
    byNumber.set(numar, {
      numar,
      stadiu: String(dosar.stadiuProcesual ?? "").trim(),
      categorie: String(dosar.categorieCaz ?? "").trim(),
      instanta: String(dosar.institutie ?? "").trim(),
      latest_sedinta_at: computeLatestSedinta(dosar),
    });
  }
  return {
    version: 2,
    fetched_at: fetchedAt,
    dosare: Array.from(byNumber.values()).sort((a, b) => a.numar.localeCompare(b.numar)),
  };
}

export function diffNameSoap(input: NameSoapDiffInput): NameSoapDiffOutput {
  const { prevSnapshot, currentSnapshot, alertConfig, now, jobCreatedAt } = input;

  const prevByNumar = prevSnapshot ? byNumar(prevSnapshot) : new Map<string, NameSoapSnapshotDosar>();
  const currentByNumar = byNumar(currentSnapshot);
  const alerts: NameSoapDiffAlert[] = [];

  for (const [numar, current] of currentByNumar) {
    const prev = prevByNumar.get(numar);
    const currentRelevant = dosarPassesFilter(current, alertConfig);
    const prevRelevant = prev ? dosarPassesFilter(prev, alertConfig) : false;

    if (!prev) {
      if (currentRelevant && !isHistoricNoise(current, jobCreatedAt)) {
        alerts.push({
          kind: "dosar_new",
          severity: "info",
          title: `Dosar nou gasit pentru nume: ${numar}`,
          detail: { observedAt: now, ...current },
          dedupKey: dedupKey(numar, "dosar_new"),
        });
      }
      continue;
    }

    if (!prevRelevant && currentRelevant) {
      alerts.push({
        kind: "dosar_relevant_now",
        severity: "info",
        title: `Dosarul intra in filtrul curent: ${numar}`,
        detail: { observedAt: now, before: prev, after: current },
        dedupKey: dedupKey(numar, "dosar_relevant_now"),
      });
    } else if (prevRelevant && !currentRelevant) {
      alerts.push({
        kind: "dosar_no_longer_relevant",
        severity: "info",
        title: `Dosarul iese din filtrul curent: ${numar}`,
        detail: { observedAt: now, before: prev, after: current },
        dedupKey: dedupKey(numar, "dosar_no_longer_relevant"),
      });
    }

    if (prev.stadiu !== current.stadiu && (prevRelevant || currentRelevant)) {
      alerts.push({
        kind: "stadiu_changed",
        severity: "info",
        title: `Stadiu modificat pentru ${numar}: ${prev.stadiu || "-"} -> ${current.stadiu || "-"}`,
        detail: { observedAt: now, numar, from: prev.stadiu, to: current.stadiu, instanta: current.instanta },
        dedupKey: dedupKey(numar, "stadiu_changed"),
      });
    }

    if (prev.categorie !== current.categorie && (prevRelevant || currentRelevant)) {
      alerts.push({
        kind: "categorie_changed",
        severity: "info",
        title: `Categorie modificata pentru ${numar}: ${prev.categorie || "-"} -> ${current.categorie || "-"}`,
        detail: { observedAt: now, numar, from: prev.categorie, to: current.categorie, instanta: current.instanta },
        dedupKey: dedupKey(numar, "categorie_changed"),
      });
    }
  }

  // Defense-in-depth: prev snapshot anterior bump-ului de version (v1) poate
  // contine dosare istorice pe care isHistoricNoise le-ar fi suprimat acum.
  // Daca PortalJust nu le mai returneaza, am emite un val masiv de
  // dosar_disappeared pentru baseline-uri vechi care, in modelul nou, n-ar
  // fi trebuit sa fie alertate niciodata. Sarim bucla pana cand prev e v2
  // (= scris de runner-ul actual, baseline curat).
  const prevAllowsDisappeared = prevSnapshot ? prevSnapshot.version >= 2 : false;
  if (prevAllowsDisappeared) {
    for (const [numar, prev] of prevByNumar) {
      if (currentByNumar.has(numar)) continue;
      if (!alertConfig.notify_on_dosar_disappeared) continue;
      if (!dosarPassesFilter(prev, alertConfig)) continue;
      alerts.push({
        kind: "dosar_disappeared",
        severity: "warning",
        title: `Dosarul nu mai apare pentru nume: ${numar}`,
        detail: { observedAt: now, ...prev },
        dedupKey: dedupKey(numar, "dosar_disappeared"),
      });
    }
  }

  return { newSnapshot: currentSnapshot, alerts };
}
