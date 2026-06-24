// buildSedintaKey — deterministic key for one sedinta (court session) used by
// the PR-4 diff engine to detect new/changed/solved termene.
//
// Why this shape: PortalJust returns the same logical sedinta with cosmetic
// drift (whitespace, time format `10:0` vs `10:00`, occasional reordering).
// Hashing whole payloads (the original PLAN proposal) flagged every cosmetic
// drift as "changed". Building a stable key from normalized fields keeps the
// diff signal-to-noise high.
//
// Stadiu prefix is critical: a single dosar can have parallel sedinte in fond
// + apel. Without stadiu, a key built only from data+ora+complet would collide
// across stadii and the diff would erase one with the other (HARDENING.md
// L298-339 absorption documented this; PJI's sister project shipped without
// stadiu and produced false positives).
//
// PR-3 ships the util + tests; PR-4 wires it into the actual diff loop.

import { stripDiacritics } from "../../util/textNormalize.ts";

export interface SedintaInput {
  // Stadiu comes from the Dosar parent (e.g., "Fond", "Apel", "Recurs"). We
  // accept it as an explicit arg since Dosar.sedinte[] elements don't include
  // it — the caller is expected to provide it from the Dosar wrapper.
  stadiuProcesual: string | null | undefined;
  data: string | null | undefined;
  ora: string | null | undefined;
  complet: string | null | undefined;
  solutie: string | null | undefined;
}

// '2026-04-19T00:00:00' → '2026-04-19'
// '2026-04-19'           → '2026-04-19'
// '2026-04-19 10:00'     → '2026-04-19'
// ''                      → ''
export function normalizeData(input: string | null | undefined): string {
  if (!input) return "";
  return String(input).slice(0, 10);
}

// '10:0'  → '10:00'
// '10:00' → '10:00'
// '8:30'  → '08:30'
// ''       → ''
export function normalizeOra(input: string | null | undefined): string {
  if (!input) return "";
  const s = String(input).trim();
  if (s === "") return "";
  // Match HH:MM (with H or HH, M or MM). Anything else passes through unchanged
  // — better to expose a weird value in the key than silently coerce.
  const m = s.match(/^(\d{1,2}):(\d{1,2})$/);
  if (!m) return s;
  return `${m[1].padStart(2, "0")}:${m[2].padStart(2, "0")}`;
}

// 'Apel'         → 'apel'
// 'APEL '        → 'apel'
// 'Fond '        → 'fond'
// 'Recurs in interesul legii' → 'recurs in interesul legii'
// undefined      → ''
export function normalizeStadiu(input: string | null | undefined): string {
  if (!input) return "";
  return stripDiacritics(String(input)).toLowerCase().trim();
}

// Tier 6 H4: parseSedintaKey (in diff.ts) assumes ONLY the trailing `solutie`
// segment may contain `|`. If PortalJust ever started returning `stadiu`,
// `data`, `ora`, or `complet` with a `|` inside (e.g., a complet labeled
// "Judecator A | B"), parseSedintaKey would silently misalign segment
// boundaries and the diff would emit false `termen_changed` / `solutie_aparuta`
// alerts. Assert input never contains `|` in those leading segments — fail
// loud (with the offending field name) rather than produce wrong alerts.
//
// `solutie` is intentionally exempt: parseSedintaKey re-joins everything
// after the 4th separator, so a `|` in solutie round-trips correctly.
function assertNoPipe(field: string, value: string): void {
  if (value.includes("|")) {
    throw new Error(
      `buildSedintaKey: '${field}' segment contains '|' (value=${JSON.stringify(value)}). ` +
        "This would corrupt parseSedintaKey boundaries and trigger false alerts. " +
        `Either escape '|' in the upstream payload or extend the key separator.`
    );
  }
}

// Stable, pipe-delimited key. We pick `|` as a separator because PortalJust
// sedinta fields never legitimately contain it; assertNoPipe() locks that in.
export function buildSedintaKey(s: SedintaInput): string {
  const stadiu = normalizeStadiu(s.stadiuProcesual);
  const data = normalizeData(s.data);
  const ora = normalizeOra(s.ora);
  const complet = (s.complet ?? "").trim();
  const solutie = (s.solutie ?? "").trim();
  assertNoPipe("stadiu", stadiu);
  assertNoPipe("data", data);
  assertNoPipe("ora", ora);
  assertNoPipe("complet", complet);
  // `solutie` may contain `|` — it is the trailing segment and parseSedintaKey
  // re-joins everything past the 4th separator.
  return `${stadiu}|${data}|${ora}|${complet}|${solutie}`;
}

// Variant without solutie segment — used by PR-4 to detect `solutie_aparuta`
// (same sedinta, solutie went null → non-null). Equivalent to dropping the
// last segment of buildSedintaKey().
export function buildSedintaKeyWithoutSolutie(s: SedintaInput): string {
  const stadiu = normalizeStadiu(s.stadiuProcesual);
  const data = normalizeData(s.data);
  const ora = normalizeOra(s.ora);
  const complet = (s.complet ?? "").trim();
  assertNoPipe("stadiu", stadiu);
  assertNoPipe("data", data);
  assertNoPipe("ora", ora);
  assertNoPipe("complet", complet);
  return `${stadiu}|${data}|${ora}|${complet}`;
}
