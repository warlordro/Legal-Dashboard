import { solveRnpmCaptcha, type CaptchaProvider, type CaptchaMode } from "./captchaSolver.ts";
import {
  RnpmClient,
  defaultRnpmClient,
  RnpmError,
  type RnpmSearchType,
  type RnpmSearchParams,
  type RnpmDocument,
  type RnpmFullDetail,
} from "./rnpmClient.ts";
import { saveSearch } from "../db/searchRepository.ts";
import { saveAvizFull } from "../db/avizRepository.ts";
import { buildSaveAvizInput } from "./rnpmAvizMapper.ts";
import { stripDiacriticsDeep } from "../util/textNormalize.ts";

export interface ExecuteSearchInput {
  type: RnpmSearchType;
  params: Omit<RnpmSearchParams, "gcode">;
  captchaKey: string;
  captchaProvider?: CaptchaProvider;
  fallback2CaptchaKey?: string;
  captchaMode?: CaptchaMode;
  ownerId?: string;
  startRnpmPage?: number;
  batchSize?: number;
  existingGcode?: string;
  existingSearchId?: number;
  fetchDetails?: boolean;
  detailConcurrency?: number;
  signal?: AbortSignal;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}

export interface ExecuteSearchResult {
  searchId: number;
  documents: RnpmDocument[];
  avizIds: (number | null)[];
  detailsFailed: string[];
  total: number;
  pagesTotal: number;
  pageSize: number;
  currentPage: number;
  criteriu: string;
  gcode: string;
  nextRnpmPage: number | null;
}

const DEFAULT_DETAIL_CONCURRENCY = 7;
const DEFAULT_BATCH_SIZE = 25;

// Single-line JSON timing line on stdout. Same shape as other audit events
// (ai_call, restore). Lets ops grep `"action":"rnpm_phase"` and pivot by
// phase to see where wall-clock time goes (captcha solver vs RNPM search vs
// detail fetches). PII-clean: no parameter values, no document identifiers.
function logRnpmEvent(entry: Record<string, unknown>): void {
  console.log(
    JSON.stringify({
      ...entry,
      ts: new Date().toISOString(),
    }),
  );
}

function toRnpmDate(s: string): string {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : s;
}

export async function executeSearch(
  input: ExecuteSearchInput,
  client: RnpmClient = defaultRnpmClient
): Promise<ExecuteSearchResult> {
  const ownerId = input.ownerId ?? "local";
  const batchSize = input.batchSize ?? DEFAULT_BATCH_SIZE;
  const fetchDetails = input.fetchDetails !== false;
  const concurrency = input.detailConcurrency ?? DEFAULT_DETAIL_CONCURRENCY;
  const signal = input.signal;
  let rnpmPage = input.startRnpmPage ?? 1;

  // Per-phase timing accumulators — emitted at the end as a single
  // `rnpm_search` summary line so the slow-search complaint can be triaged
  // ("captcha was 28s" vs "details fetched 14 docs in 22s").
  const tStart = Date.now();
  let captchaMs = 0;
  let searchMs = 0;
  let detailsMs = 0;
  let detailsOk = 0;
  let detailsFailedCount = 0;

  throwIfAborted(signal);
  let gcode: string;
  if (input.existingGcode) {
    gcode = input.existingGcode;
  } else {
    const tCaptcha = Date.now();
    gcode = await solveRnpmCaptcha(input.captchaKey, input.captchaProvider, input.fallback2CaptchaKey, signal, input.captchaMode);
    captchaMs = Date.now() - tCaptcha;
  }
  throwIfAborted(signal);
  // perioadaStart/perioadaFinal sunt filtre client-side (RNPM nu suporta interval pe majoritatea categoriilor)
  const { perioadaStart: _ps, perioadaFinal: _pf, ...restParams } = input.params;
  // RNPM backend nu gaseste nimic cu diacritice — folosim doar pentru request-ul efectiv.
  // input.params ramane neatins pentru ca `rnpm_searches.params_json` sa pastreze textul original al userului.
  const searchParams: RnpmSearchParams = { ...stripDiacriticsDeep(restParams), gcode };
  void _ps; void _pf;

  let firstResult;
  // PRIVACY: do NOT log parameter values (CUI, CNP, nume, sedii). Log only
  // the shape of the request so we can correlate issues without leaking PII.
  const { gcode: _g, ...logParams } = searchParams;
  const fieldsPresent = Object.entries(logParams)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k]) => k)
    .join(",");
  logRnpmEvent({
    action: "rnpm_phase",
    phase: "search_start",
    searchType: input.type,
    page: rnpmPage,
    fields: fieldsPresent,
    captchaMs: captchaMs || undefined,
  });
  try {
    const tSearch = Date.now();
    firstResult = await client.search(input.type, searchParams, rnpmPage, signal);
    const dt = Date.now() - tSearch;
    searchMs += dt;
    logRnpmEvent({
      action: "rnpm_phase",
      phase: "search",
      searchType: input.type,
      page: rnpmPage,
      latencyMs: dt,
      total: firstResult.total,
      pages: firstResult.pagesTotal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    const isExpired = e instanceof RnpmError && (e.status === 410 || e.status === 401 || e.status === 403);
    if ((input.existingGcode && e instanceof RnpmError) || isExpired) {
      throwIfAborted(signal);
      const tRetry = Date.now();
      gcode = await solveRnpmCaptcha(input.captchaKey, input.captchaProvider, input.fallback2CaptchaKey, signal, input.captchaMode);
      captchaMs += Date.now() - tRetry;
      searchParams.gcode = gcode;
      const tSearch2 = Date.now();
      firstResult = await client.search(input.type, searchParams, rnpmPage, signal);
      const dt = Date.now() - tSearch2;
      searchMs += dt;
      logRnpmEvent({
        action: "rnpm_phase",
        phase: "search_retry",
        searchType: input.type,
        page: rnpmPage,
        latencyMs: dt,
        total: firstResult.total,
        pages: firstResult.pagesTotal,
      });
    } else {
      throw e;
    }
  }

  if (firstResult.total > 1500 || !Array.isArray(firstResult.documents)) {
    throw new RnpmError(
      `RNPM a returnat ${firstResult.total} rezultate (limita 1500). Restrange criteriile de cautare.`,
      400
    );
  }
  const pagesTotal = firstResult.pagesTotal;
  const total = firstResult.total;
  const pageSize = firstResult.pageSize;
  const criteriu = firstResult.criteriu;

  const searchId = input.existingSearchId ?? saveSearch({
    ownerId,
    searchType: input.type,
    paramsJson: JSON.stringify(input.params),
    totalResults: total,
    criteriu: criteriu ?? null,
  });

  const allDocs: RnpmDocument[] = [];
  const avizIds: (number | null)[] = [];
  const detailsFailed: string[] = [];

  const processPage = async (docs: RnpmDocument[]) => {
    const baseIdx = allDocs.length;
    allDocs.push(...docs);
    for (let i = 0; i < docs.length; i++) avizIds.push(null);
    if (!fetchDetails || docs.length === 0) return;
    for (let i = 0; i < docs.length; i += concurrency) {
      throwIfAborted(signal);
      const tBatch = Date.now();
      const batchResults = await Promise.all(docs.slice(i, i + concurrency).map(async (doc, batchIdx) => {
        const localIdx = i + batchIdx;
        if (!doc.identificator.k) return { localIdx, doc, ok: false as const };
        try {
          const detail = await client.fetchFullDetail(doc.identificator.k, signal);
          // Fetch-ul poate sa se fi intors inainte ca abort-ul sa-l ajunga.
          // Verificam explicit ca sa nu scriem in SQLite dupa ce user-ul a oprit cautarea.
          if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
          if (typeof detail.part1?.activ === "boolean") doc.activ = detail.part1.activ;
          const avizId = persistAvizWithDetail(doc, detail, input.type, ownerId, searchId);
          return { localIdx, doc, ok: true as const, avizId };
        } catch (e) {
          if (e instanceof DOMException && e.name === "AbortError") throw e;
          console.error(`[rnpm detail fail] ${doc.identificator.v}:`, e instanceof Error ? e.message : e);
          return { localIdx, doc, ok: false as const };
        }
      }));
      const dt = Date.now() - tBatch;
      detailsMs += dt;
      let okCount = 0;
      let failCount = 0;
      for (const r of batchResults) {
        if (r.ok) {
          avizIds[baseIdx + r.localIdx] = r.avizId;
          okCount++;
        } else {
          detailsFailed.push(r.doc.identificator.v);
          failCount++;
        }
      }
      detailsOk += okCount;
      detailsFailedCount += failCount;
      logRnpmEvent({
        action: "rnpm_phase",
        phase: "details_batch",
        searchType: input.type,
        size: batchResults.length,
        ok: okCount,
        failed: failCount,
        latencyMs: dt,
      });
    }
  };

  await processPage(firstResult.documents);
  rnpmPage++;

  while (allDocs.length < batchSize && rnpmPage <= pagesTotal) {
    throwIfAborted(signal);
    let r;
    try {
      const tMore = Date.now();
      r = await client.search(input.type, searchParams, rnpmPage, signal);
      const dt = Date.now() - tMore;
      searchMs += dt;
      logRnpmEvent({
        action: "rnpm_phase",
        phase: "search_more",
        searchType: input.type,
        page: rnpmPage,
        latencyMs: dt,
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") throw e;
      if (e instanceof RnpmError && (e.status === 410 || e.status === 401 || e.status === 403)) {
        throwIfAborted(signal);
        const tRetry = Date.now();
        gcode = await solveRnpmCaptcha(input.captchaKey, input.captchaProvider, input.fallback2CaptchaKey, signal, input.captchaMode);
        captchaMs += Date.now() - tRetry;
        searchParams.gcode = gcode;
        const tMore2 = Date.now();
        r = await client.search(input.type, searchParams, rnpmPage, signal);
        const dt = Date.now() - tMore2;
        searchMs += dt;
        logRnpmEvent({
          action: "rnpm_phase",
          phase: "search_more_retry",
          searchType: input.type,
          page: rnpmPage,
          latencyMs: dt,
        });
      } else {
        throw e;
      }
    }
    await processPage(r.documents);
    rnpmPage++;
  }

  const nextRnpmPage = rnpmPage <= pagesTotal ? rnpmPage : null;

  logRnpmEvent({
    action: "rnpm_search",
    searchType: input.type,
    totalLatencyMs: Date.now() - tStart,
    captchaMs,
    searchMs,
    detailsMs,
    count: allDocs.length,
    ok: detailsOk,
    failed: detailsFailedCount,
    pages: pagesTotal,
    total,
  });

  return {
    searchId,
    documents: allDocs,
    avizIds,
    detailsFailed,
    total,
    pagesTotal,
    pageSize,
    currentPage: input.startRnpmPage ?? 1,
    criteriu,
    gcode,
    nextRnpmPage,
  };
}

function persistAvizWithDetail(
  doc: RnpmDocument,
  detail: RnpmFullDetail,
  searchType: string,
  ownerId: string,
  searchId: number,
): number {
  return saveAvizFull(buildSaveAvizInput(doc, detail, searchType, ownerId, searchId));
}

export interface BulkSearchItem {
  type: RnpmSearchType;
  params: Omit<RnpmSearchParams, "gcode">;
  label?: string;
}

export interface BulkProgress {
  index: number;
  total: number;
  label: string;
  phase: "captcha" | "search" | "details" | "done" | "error";
  message?: string;
  resultCount?: number;
  searchId?: number;
  error?: string;
}

export async function executeBulkSearch(
  items: BulkSearchItem[],
  captchaKey: string,
  ownerId: string,
  onProgress: (p: BulkProgress) => void,
  client: RnpmClient = defaultRnpmClient,
  signal?: AbortSignal,
  captchaProvider?: CaptchaProvider,
  fallback2CaptchaKey?: string,
  captchaMode?: CaptchaMode,
): Promise<void> {
  for (let i = 0; i < items.length; i++) {
    if (signal?.aborted) return;
    const item = items[i];
    const label = item.label ?? describeItem(item);
    onProgress({ index: i, total: items.length, label, phase: "captcha" });
    try {
      onProgress({ index: i, total: items.length, label, phase: "search" });
      // Bulk items fetch toate paginile automat (limita RNPM = 1500). Single search foloseste batchSize=25
      // plus butonul "Incarca mai multe"; bulk nu are echivalent, deci se comporta ca "fetch all".
      const result = await executeSearch(
        { type: item.type, params: item.params, captchaKey, captchaProvider, fallback2CaptchaKey, captchaMode, ownerId, batchSize: 1500, signal },
        client
      );
      onProgress({
        index: i, total: items.length, label, phase: "done",
        resultCount: result.documents.length,
        searchId: result.searchId,
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      const msg = e instanceof Error ? e.message : String(e);
      onProgress({ index: i, total: items.length, label, phase: "error", error: msg });
    }
  }
}

function describeItem(item: BulkSearchItem): string {
  const p = item.params;
  if (p.debitorPJ?.CUI?.value) return `Debitor PJ CUI ${p.debitorPJ.CUI.value}`;
  if (p.debitorPF?.CNP?.value) return `Debitor PF CNP ${p.debitorPF.CNP.value}`;
  if (p.debitorPJ?.denumire) return `Debitor PJ ${p.debitorPJ.denumire}`;
  if (p.debitorPF?.nume) return `Debitor PF ${p.debitorPF.nume}`;
  if (p.identificatorInscriere) return p.identificatorInscriere;
  return `${item.type} search`;
}
