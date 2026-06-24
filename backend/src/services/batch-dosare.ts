// PortalJust determinism spike (2026-04-27, pre-PR-3, per PLAN §B.3):
// Ran `cautareDosare` 5x same-input across 7 distinct inputs (35 SOAP calls):
// 0-result sentinel; numeParte=POPESCU+1day (2 dosare, 8070B); 4 real numere de
// dosare (1887/99/2022/a12 -> 2 dosare 25874B; 786/103/2026 -> 1 dosar 1074B;
// 1134/93/2026 -> 1 dosar 1317B; 531/40/2025 -> 1 dosar 24226B); plus a cross-
// time rerun of 1887/99/2022/a12 ~30s later. All 35 responses byte-identical
// per same-input group AND the cross-time rerun produced the same sha256 as
// the first run -> PortalJust CautareDosare is byte-deterministic, no
// embedded timestamp/nonce in the payload. Pivot diff strategy from PLAN §B.3
// NOT required: we can build snapshot diff on top of `buildSedintaKey()` per
// PJI port without fallback.
// CAVEAT: spike validates a ~30s window. PR-4 (scheduler activ + diff) must
// re-validate cross-day stability (24h+ apart) before flipping
// MONITORING_ENABLED=true. If a payload field drifts day-over-day (e.g. an
// internal cache TTL or last-indexed timestamp surfaces in the XML), naive
// snapshot-by-keys still works because `buildSedintaKey()` ignores those
// fields, but the additional `payload_hash` (sha256 raw) defense layer would
// false-positive every run. Confirm before flip.
import { cautareDosare, type Dosar } from "../soap.ts";
import { splitInterval, generateMonthlyIntervals } from "../intervals.ts";
import { MAX_EXISTING_ITEMS, MAX_EXISTING_ITEM_LEN, MAX_LOADMORE_BODY } from "../util/validation.ts";

const SOAP_RESULT_LIMIT = 1000; // PortalJust hard cap per request
const MAX_SPLIT_DEPTH = 3; // Max recursive subdivision (month → half → quarter → ~3-4 days)
const BATCH_DELAY_MS = 150; // Delay between parallel chunks to avoid hammering the server
// Empirical: N=3 gives ~2.8x speedup on heavy queries with zero PortalJust errors;
// N=5 starts to queue server-side and per-call latency degrades.
const PARALLEL_BATCH_SIZE = 3;

export { generateMonthlyIntervals };

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export interface BatchResult<T> {
  items: T[];
  warnings: string[];
}

// Core batch function: fetch all results for given search params using monthly intervals
// onBatch is called after each interval with the NEW dosare found in that interval
// existingNumere: set of dosare numar already on client — these are excluded from newInBatch and found count
export async function batchFetchDosare(
  params: { numarDosar?: string; obiectDosar?: string; numeParte?: string; institutie?: string },
  dateRange: { dataStart: string; dataStop: string },
  onProgress?: (processed: number, total: number, found: number, currentInterval: string) => void,
  onBatch?: (newItems: Dosar[]) => void,
  existingNumere?: Set<string>,
  signal?: AbortSignal
): Promise<BatchResult<Dosar>> {
  const intervals = generateMonthlyIntervals(dateRange.dataStart, dateRange.dataStop);
  const allDosare = new Map<string, Dosar>(); // deduplicate by numar — only NEW dosare
  const known = existingNumere ?? new Set<string>();
  const warnings: string[] = [];

  // Process intervals in parallel chunks of PARALLEL_BATCH_SIZE.
  // Dedup + onBatch/onProgress callbacks remain serialized after each chunk so the
  // monotonically-increasing progress counter and dedup map stay deterministic.
  for (let i = 0; i < intervals.length; i += PARALLEL_BATCH_SIZE) {
    if (signal?.aborted) break;
    const chunk = intervals.slice(i, i + PARALLEL_BATCH_SIZE);

    const chunkResults = await Promise.all(
      chunk.map(async (interval) => {
        const label = `${interval.dataStart} → ${interval.dataStop}`;
        try {
          const results = await cautareDosare(
            {
              ...params,
              dataStart: interval.dataStart,
              dataStop: interval.dataStop,
            },
            { signal }
          );
          if (results.length >= SOAP_RESULT_LIMIT) {
            const subResults = await subdivideInterval(params, interval, 1, signal);
            return { label, items: subResults.items, warnings: subResults.warnings };
          }
          return { label, items: results, warnings: [] as string[] };
        } catch (err) {
          console.error(`Eroare batch ${label}:`, err);
          return { label, items: [] as Dosar[], warnings: [`Eroare la intervalul ${label}`] };
        }
      })
    );

    // Apply chunk results in order (preserves dedup + progress determinism)
    for (let j = 0; j < chunkResults.length; j++) {
      const { label, items, warnings: w } = chunkResults[j];
      const newInBatch: Dosar[] = [];
      for (const d of items) {
        if (!known.has(d.numar) && !allDosare.has(d.numar)) newInBatch.push(d);
        if (!known.has(d.numar)) allDosare.set(d.numar, d);
      }
      warnings.push(...w);
      if (newInBatch.length > 0) {
        onBatch?.(newInBatch);
      }
      onProgress?.(i + j + 1, intervals.length, allDosare.size, label);
    }

    if (i + PARALLEL_BATCH_SIZE < intervals.length) {
      await delay(BATCH_DELAY_MS);
    }
  }

  return { items: Array.from(allDosare.values()), warnings };
}

async function subdivideInterval(
  params: { numarDosar?: string; obiectDosar?: string; numeParte?: string; institutie?: string },
  interval: { dataStart: string; dataStop: string },
  depth: number,
  signal?: AbortSignal
): Promise<BatchResult<Dosar>> {
  if (depth > MAX_SPLIT_DEPTH) {
    // Max depth reached — fetch what we can and warn
    const results = await cautareDosare(
      { ...params, dataStart: interval.dataStart, dataStop: interval.dataStop },
      { signal }
    );
    const warning =
      results.length >= SOAP_RESULT_LIMIT
        ? `Intervalul ${interval.dataStart} → ${interval.dataStop} depaseste limita chiar si dupa subdivizare (${results.length} rezultate)`
        : undefined;
    return { items: results, warnings: warning ? [warning] : [] };
  }

  const [first, second] = splitInterval(interval);
  const allItems: Dosar[] = [];
  const warnings: string[] = [];

  for (const sub of [first, second]) {
    if (signal?.aborted) break;
    await delay(BATCH_DELAY_MS);
    try {
      const results = await cautareDosare({ ...params, dataStart: sub.dataStart, dataStop: sub.dataStop }, { signal });
      if (results.length >= SOAP_RESULT_LIMIT) {
        const deeper = await subdivideInterval(params, sub, depth + 1, signal);
        allItems.push(...deeper.items);
        warnings.push(...deeper.warnings);
      } else {
        allItems.push(...results);
      }
    } catch (err) {
      console.error(`Eroare subdivizare ${sub.dataStart}-${sub.dataStop}:`, err);
      warnings.push(`Eroare la sub-intervalul ${sub.dataStart} → ${sub.dataStop}`);
    }
  }

  return { items: allItems, warnings };
}

// SECURITY: Parse and validate the "existing" array from load-more POST body
export async function parseExistingFromBody(c: { req: { text: () => Promise<string> } }): Promise<{
  set: Set<string>;
  error?: string;
}> {
  let rawBody: string;
  try {
    rawBody = await c.req.text();
  } catch {
    return { set: new Set() };
  }

  if (rawBody.length > MAX_LOADMORE_BODY) {
    return { set: new Set(), error: "Body prea mare." };
  }

  if (!rawBody.trim()) {
    return { set: new Set() };
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    console.warn("Load-more: JSON invalid in body");
    return { set: new Set(), error: "JSON invalid." };
  }

  if (!body || typeof body !== "object") {
    return { set: new Set(), error: "Structura body invalida." };
  }

  const existing = (body as Record<string, unknown>).existing;
  if (existing === undefined || existing === null) {
    return { set: new Set() };
  }

  if (!Array.isArray(existing)) {
    return { set: new Set(), error: "Campul 'existing' trebuie sa fie un array." };
  }

  if (existing.length > MAX_EXISTING_ITEMS) {
    return { set: new Set(), error: `Array 'existing' depaseste limita de ${MAX_EXISTING_ITEMS} elemente.` };
  }

  const result = new Set<string>();
  for (const item of existing) {
    if (typeof item !== "string") continue;
    if (item.length > MAX_EXISTING_ITEM_LEN) continue;
    if (item) result.add(item);
  }

  return { set: result };
}

// SSE helper: write an event to the stream
export function sseEvent(controller: ReadableStreamDefaultController, event: string, data: unknown) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  controller.enqueue(new TextEncoder().encode(payload));
}
