import { getDb } from "./schema.ts";

// v2.32.0 fx_rates - cache ECB daily FX. Pair convention: 'USD/EUR' inseamna
// 1 USD = X EUR; ECB publica EUR/USD (1 EUR = Y USD), deci calculam X = 1/Y
// in fetcher (vezi fxFetcher.ts). Aici doar CRUD; fail-closed la lipsa rate
// (getLatest returneaza null si UI afiseaza "EUR indisponibil").

export interface FxRateRow {
  pair: string;
  rate: number;
  rate_date: string;
  source: string;
  fetched_at: string;
}

export interface UpsertFxRateInput {
  pair: string;
  rate: number;
  rateDate: string;
  source?: string;
}

const COLUMNS = "pair, rate, rate_date, source, fetched_at";

function assertPair(pair: string): void {
  if (typeof pair !== "string" || pair.length === 0) {
    throw new Error("invalid pair: must be non-empty string");
  }
}

function assertPositiveRate(rate: number): void {
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
    throw new Error("invalid rate: must be positive finite number");
  }
}

function assertRateDate(value: string): void {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("invalid rate_date: must be YYYY-MM-DD");
  }
}

export function getLatest(pair: string): FxRateRow | null {
  assertPair(pair);
  const row = getDb()
    .prepare(
      `SELECT ${COLUMNS} FROM fx_rates
       WHERE pair = ?
       ORDER BY rate_date DESC
       LIMIT 1`
    )
    .get(pair) as FxRateRow | undefined;
  return row ?? null;
}

// Upsert pe (pair, rate_date): retry-urile in aceeasi zi cu rate identic sunt
// idempotente; daca ECB corecteaza rate-ul retroactiv (rar), overwrite-ul e ce
// vrem - latest e mereu "ce ECB publica acum pentru rate_date".
export function upsertFxRate(input: UpsertFxRateInput): FxRateRow {
  assertPair(input.pair);
  assertPositiveRate(input.rate);
  assertRateDate(input.rateDate);
  const db = getDb();
  db.prepare(
    `INSERT INTO fx_rates (pair, rate, rate_date, source, fetched_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(pair, rate_date) DO UPDATE SET
       rate = excluded.rate,
       source = excluded.source,
       fetched_at = excluded.fetched_at`
  ).run(input.pair, input.rate, input.rateDate, input.source ?? "ecb");
  return getDb()
    .prepare(`SELECT ${COLUMNS} FROM fx_rates WHERE pair = ? AND rate_date = ?`)
    .get(input.pair, input.rateDate) as FxRateRow;
}

// staleSince: returneaza true daca latest rate_date e mai vechi decat threshold.
// Folosit de banner "stale > 48h" si de boot fail-safe (D14): cand stale, UI
// arata "EUR indisponibil" in loc sa fabrice un fallback.
export function isStale(pair: string, thresholdHours: number): boolean {
  const latest = getLatest(pair);
  if (latest === null) return true;
  const ageMs = Date.now() - Date.parse(`${latest.rate_date}T00:00:00Z`);
  return ageMs > thresholdHours * 3_600_000;
}
