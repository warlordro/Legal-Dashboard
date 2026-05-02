import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import {
  formatInstitutie,
  getStadiuBadgeColor,
} from "@/components/dosare-table-helpers";
import { cn } from "@/lib/utils";
import type { MonitoringAlert } from "@/lib/alertsApi";

// Pure transforms peste MonitoringAlert.detail_json + job_target_json. Stage 3
// extract din pages/Alerts.tsx — ramane in lib pentru testabilitate izolata
// si reuse din streaming overlay (planificat). Fisierul e .tsx pentru ca
// Stadiu Badge + "Data sedintei" structured value emit JSX inline; varianta
// "pure data + render-time switch" ar dubla complexitatea pentru zero castig.

function parseDetails(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : { value: parsed };
  } catch {
    return { value: raw };
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function formatSedintaDate(value: unknown): string | undefined {
  const raw = asString(value);
  if (!raw) return undefined;
  // Backend may serialize as "2026-04-30", "2026-04-30T00:00:00",
  // or full ISO with timezone. We only show the day part — time is in `ora`.
  const isoDay = raw.split("T")[0];
  const m = isoDay?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const [, y, mo, d] = m;
    return `${d}.${mo}.${y}`;
  }
  return raw;
}

function getNested(detail: Record<string, unknown>, path: string[]): unknown {
  let cur: unknown = detail;
  for (const key of path) {
    if (cur && typeof cur === "object" && !Array.isArray(cur)) {
      cur = (cur as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }
  return cur;
}

export interface AlertFact {
  label: string;
  // ReactNode lets us mix plain strings with styled chunks (Stadiu badge,
  // structured Data sedintei + Ora rendering). The dd renderer handles both
  // shapes — strings inherit the row's text-foreground color, JSX brings its
  // own classes.
  value: ReactNode;
}

export interface AlertContext {
  numarDosar?: string;
  instanta?: string;
  nameNormalized?: string;
  hotarare?: { numarDoc?: string; dataPronuntare?: string; sumar?: string };
  facts: AlertFact[];
  fallback: Array<{ label: string; value: string }>;
}

function humanizeKey(key: string): string {
  // snake_case / camelCase → Capitalized words. Cheap heuristic for the
  // fallback "Detalii suplimentare" rows where we don't know the field
  // semantically but still want a readable label.
  const spaced = key
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function stringifyFallbackValue(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") return value.trim().length > 0 ? value.trim() : undefined;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    const json = JSON.stringify(value);
    if (!json || json === "{}" || json === "[]" || json === "null") return undefined;
    return json.length > 200 ? `${json.slice(0, 197)}…` : json;
  } catch {
    return undefined;
  }
}

export function buildAlertContext(alert: MonitoringAlert): AlertContext {
  const detail = parseDetails(alert.detail_json);
  // v2.6.2 — fall back to the joined job target_json for alerts that pre-date
  // runner-side enrichment. The runner injects numar_dosar / instanta /
  // name_normalized into detail at write time for new alerts; for old ones the
  // job's target_json is the only place the dossier number lives.
  let target: Record<string, unknown> = {};
  if (alert.job_target_json) {
    try {
      const parsed = JSON.parse(alert.job_target_json) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        target = parsed as Record<string, unknown>;
      }
    } catch { /* invalid JSON in target_json — ignore */ }
  }

  const numarDosar =
    asString(detail.numar_dosar) ??
    asString(detail.numar) ??
    asString(detail.dosar) ??
    asString(target.numar_dosar) ??
    asString(target.numar);
  const instanta = asString(detail.instanta) ?? asString(target.instanta);
  const nameNormalized =
    asString(detail.name_normalized) ?? asString(target.name_normalized);

  const facts: AlertFact[] = [];
  const push = (label: string, value: ReactNode | undefined) => {
    if (value === undefined || value === null) return;
    if (typeof value === "string" && value.trim().length === 0) return;
    facts.push({ label, value });
  };

  // termen_changed: detail = { from: {data,ora,complet}, to: {data,ora,complet} }
  const fromData = formatSedintaDate(getNested(detail, ["from", "data"]));
  const toData = formatSedintaDate(getNested(detail, ["to", "data"]));
  if (fromData || toData) {
    const fromOra = asString(getNested(detail, ["from", "ora"]));
    const toOra = asString(getNested(detail, ["to", "ora"]));
    push("De la", [fromData, fromOra].filter(Boolean).join(" · "));
    push("La", [toData, toOra].filter(Boolean).join(" · "));
    push("Complet", asString(getNested(detail, ["to", "complet"])) ?? asString(getNested(detail, ["from", "complet"])));
  } else {
    // Date + ora rendered as one cohesive value so both share text-foreground
    // (no muted "Ora" suffix). The 2-col grid would otherwise push the time
    // onto the next row half, breaking the visual unit.
    const sedintaData = formatSedintaDate(detail.data);
    const sedintaOra = asString(detail.ora);
    if (sedintaData || sedintaOra) {
      // "Ora" reads as a sub-label inside the value, so it shares the muted
      // color of the dt labels ("Data sedintei:", "Complet:", ...). The
      // numeric time keeps text-foreground so the eye still tracks "what" vs
      // "when" with one consistent gray-vs-black rhythm across the row.
      push(
        "Data sedintei",
        <span className="text-foreground">
          {sedintaData}
          {sedintaData && sedintaOra ? "  " : ""}
          {sedintaOra && (
            <>
              <span className="text-muted-foreground">Ora</span> {sedintaOra}
            </>
          )}
        </span>,
      );
    }
    push("Complet", asString(detail.complet));
  }

  // For solutie_aparuta the title already reads "Solutie publicata: <solutie>"
  // so the same value as a fact row would just be visual duplication. Skip
  // for that kind only — keep for any future kind that may carry detail.solutie
  // without surfacing it in the title.
  if (alert.kind !== "solutie_aparuta") {
    push("Solutie", asString(detail.solutie));
  }
  // v2.6.4 — solutie_aparuta carries the full ruling. Pull numar_document /
  // data_pronuntare / solutie_sumar out of the regular facts grid into a
  // dedicated callout block; cramming the multi-sentence ruling into a
  // 2-column key:value grid alongside Data/Ora/Complet was visually awkward.
  const numarDoc = asString(detail.numar_document);
  const dataPronuntare = formatSedintaDate(detail.data_pronuntare);
  const sumar = asString(detail.solutie_sumar);
  const hotarare = numarDoc || dataPronuntare || sumar
    ? { numarDoc, dataPronuntare, sumar }
    : undefined;

  // Stadiu rendered as a colored Badge to match Cautare Dosare styling
  // (slate / sky / indigo / orange per stadiu kind).
  const stadiuValue = asString(detail.stadiu) ?? asString(detail.stadiu_procesual);
  if (stadiuValue) {
    push(
      "Stadiu",
      <Badge variant="outline" className={cn("text-xs", getStadiuBadgeColor(stadiuValue))}>
        {stadiuValue}
      </Badge>,
    );
  }
  push("Categorie", asString(detail.categorie));

  // dosar_new (name_soap) flat detail; stadiu/categorie/instanta already handled above.
  // stadiu_changed / categorie_changed: detail = { from, to } (string values)
  if (alert.kind === "stadiu_changed" || alert.kind === "categorie_changed") {
    const from = asString(detail.from);
    const to = asString(detail.to);
    if (from || to) {
      push("Schimbare", `${from ?? "-"} → ${to ?? "-"}`);
    }
  }

  // formatInstitutie humanizes "CurteadeApelSUCEAVA" → "Curtea de Apel SUCEAVA"
  // so the alert reads like the Cautare Dosare detail card (single source of
  // truth: lib/institutii.ts lookup table). Falls back to the raw string if
  // the lookup misses, so unknown courts still show up rather than being
  // silently dropped.
  if (instanta) push("Instanta", formatInstitutie(instanta));
  if (nameNormalized) push("Nume monitorizat", nameNormalized);

  push("Mesaj", asString(detail.message));
  push("Eroare", asString(detail.error_code) ?? asString(detail.error));

  // Reserve as ultimate fallback for unknown structures. v2.6.2: render values
  // (humanized label + JSON-stringified value), not just key names — the prior
  // "Detalii suplimentare: keyA · keyB" line dropped the actual data.
  const consumed = new Set([
    "numar_dosar", "numar", "dosar", "instanta", "name_normalized",
    "data", "ora", "complet", "solutie", "stadiu", "stadiu_procesual",
    "categorie", "from", "to", "message", "error", "error_code", "observedAt",
    "solutie_sumar", "numar_document", "data_pronuntare",
  ]);
  const fallback: Array<{ label: string; value: string }> = [];
  for (const key of Object.keys(detail)) {
    if (consumed.has(key)) continue;
    const v = stringifyFallbackValue(detail[key]);
    if (v) fallback.push({ label: humanizeKey(key), value: v });
  }

  return { numarDosar, instanta, nameNormalized, hotarare, facts, fallback };
}
