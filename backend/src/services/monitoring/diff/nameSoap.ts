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
}

export interface NameSoapSnapshotPayload {
  version: 1;
  fetched_at: string;
  dosare: NameSoapSnapshotDosar[];
}

export interface NameSoapDiffInput {
  prevSnapshot: NameSoapSnapshotPayload | null;
  currentSnapshot: NameSoapSnapshotPayload;
  alertConfig: AlertConfig;
  now: string;
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

function byNumar(snapshot: NameSoapSnapshotPayload): Map<string, NameSoapSnapshotDosar> {
  const m = new Map<string, NameSoapSnapshotDosar>();
  for (const dosar of snapshot.dosare) {
    if (dosar.numar) m.set(dosar.numar, dosar);
  }
  return m;
}

function dedupKey(numar: string, transition: NameSoapAlertKind): string {
  return `name_soap|${numar}|${transition}`;
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
    });
  }
  return {
    version: 1,
    fetched_at: fetchedAt,
    dosare: Array.from(byNumber.values()).sort((a, b) => a.numar.localeCompare(b.numar)),
  };
}

export function diffNameSoap(input: NameSoapDiffInput): NameSoapDiffOutput {
  const { prevSnapshot, currentSnapshot, alertConfig, now } = input;
  if (!prevSnapshot) {
    return { newSnapshot: currentSnapshot, alerts: [] };
  }

  const prevByNumar = byNumar(prevSnapshot);
  const currentByNumar = byNumar(currentSnapshot);
  const alerts: NameSoapDiffAlert[] = [];

  for (const [numar, current] of currentByNumar) {
    const prev = prevByNumar.get(numar);
    const currentRelevant = dosarPassesFilter(current, alertConfig);
    const prevRelevant = prev ? dosarPassesFilter(prev, alertConfig) : false;

    if (!prev) {
      if (currentRelevant) {
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

  return { newSnapshot: currentSnapshot, alerts };
}
