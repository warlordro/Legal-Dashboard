// v2.32.0 FX fetcher — pulls daily EUR/USD from ECB and stores USD/EUR
// (1 USD = X EUR) in fx_rates. ECB publishes 1 EUR = Y USD; we invert to keep
// the convention the UI consumes (cap setat in USD, afisat in EUR).
//
// Endpoint: https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml
// ECB publica L-V in jurul orei 16:00 CET. Weekend / sarbatori = no update.
// Fail-closed (D14): la eroare returnam {ok:false, reason}; caller (boot
// fail-safe + scheduler) ignora si UI ramane pe "EUR indisponibil" sau pe
// ultima valoare valida din fx_rates.

import { upsertFxRate } from "../db/fxRatesRepository.ts";
import { withMaintenanceRead } from "../db/backup.ts";

export const ECB_FEED_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";

export interface FxFetchResult {
  ok: boolean;
  pair?: "USD/EUR";
  rate?: number;
  rateDate?: string;
  reason?: string;
  observedRate?: number;
}

// Network-side timeout: ECB e in general < 1s; 10s e safety net. Boot-ul nu
// trebuie sa blocheze pe asta — apelantul fire-and-forget.
const ECB_FETCH_TIMEOUT_MS = 10_000;
const DEFAULT_EUR_USD_MIN = 0.5;
const DEFAULT_EUR_USD_MAX = 2.0;

// Pure: extrage USD rate si rate_date dintr-un XML ECB. Exportat pentru teste
// (eliminam dependenta de retea). XML-ul are forma fixed:
//   <Cube>
//     <Cube time="YYYY-MM-DD">
//       <Cube currency="USD" rate="X.XXXX"/>
//       ...
//     </Cube>
//   </Cube>
// Parsing-ul e regex deliberat — fara dependenta XML noua, structura ECB e
// stabila de la 1999 si nu are namespace-uri impredictibile in nodul Cube.
export function parseEcbFeed(xml: string): { rateDate: string; eurUsdRate: number } | null {
  if (typeof xml !== "string" || xml.length === 0) return null;
  const timeMatch = xml.match(/<Cube\s+time="(\d{4}-\d{2}-\d{2})"/);
  if (!timeMatch) return null;
  const usdMatch = xml.match(/<Cube\s+currency="USD"\s+rate="([\d.]+)"/);
  if (!usdMatch) return null;
  const eurUsdRate = Number(usdMatch[1]);
  if (!Number.isFinite(eurUsdRate) || eurUsdRate <= 0) return null;
  return { rateDate: timeMatch[1], eurUsdRate };
}

// Convertor: ECB publica EUR/USD (1 EUR = Y USD); noi stocam USD/EUR (1 USD = X EUR).
// X = 1 / Y. Round la 6 zecimale ca sa pastram precizia fara float-noise vizibil.
export function computeUsdToEur(eurUsdRate: number): number {
  return Math.round((1 / eurUsdRate) * 1_000_000) / 1_000_000;
}

function readPlausibilityBand(): { min: number; max: number } {
  const min = Number(process.env.FX_PLAUSIBLE_EUR_USD_MIN ?? DEFAULT_EUR_USD_MIN);
  const max = Number(process.env.FX_PLAUSIBLE_EUR_USD_MAX ?? DEFAULT_EUR_USD_MAX);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max <= min) {
    return { min: DEFAULT_EUR_USD_MIN, max: DEFAULT_EUR_USD_MAX };
  }
  return { min, max };
}

export async function fetchEcbDailyRates(
  options: { fetchImpl?: typeof fetch; now?: Date } = {}
): Promise<FxFetchResult> {
  const fetchFn = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ECB_FETCH_TIMEOUT_MS);
  try {
    const res = await fetchFn(ECB_FEED_URL, { signal: controller.signal });
    if (!res.ok) {
      return { ok: false, reason: `http_${res.status}` };
    }
    const xml = await res.text();
    const parsed = parseEcbFeed(xml);
    if (!parsed) {
      return { ok: false, reason: "parse_failed" };
    }
    const band = readPlausibilityBand();
    if (parsed.eurUsdRate < band.min || parsed.eurUsdRate > band.max) {
      return { ok: false, reason: "implausible_rate", observedRate: parsed.eurUsdRate };
    }
    const usdToEur = computeUsdToEur(parsed.eurUsdRate);
    // v2.34.0 P1-5: write-ul `upsertFxRate` trebuie sa coordoneze cu
    // maintenanceLock-ul ca daily backup / restore sa nu prinda un fisier
    // mid-write. `withMaintenanceRead` (shared) e suficient — un singur
    // upsert pe zi, sub backupWrite atomic.
    await withMaintenanceRead(async () => {
      upsertFxRate({ pair: "USD/EUR", rate: usdToEur, rateDate: parsed.rateDate, source: "ecb" });
    });
    return { ok: true, pair: "USD/EUR", rate: usdToEur, rateDate: parsed.rateDate };
  } catch (err) {
    if ((err as { name?: string })?.name === "AbortError") {
      return { ok: false, reason: "timeout" };
    }
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}
