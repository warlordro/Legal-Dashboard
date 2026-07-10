import { solveRnpmCaptcha, type CaptchaProvider, type CaptchaMode } from "./captchaSolver.ts";
import {
  type RnpmClient,
  defaultRnpmClient,
  RnpmError,
  type RnpmSearchResult,
  type RnpmSearchType,
  type RnpmSearchParams,
  type RnpmDocument,
  type RnpmFullDetail,
} from "./rnpmClient.ts";
import { getSearchOwnership, saveSearch, updateSearchTotal } from "../db/searchRepository.ts";
import { beginRnpmSearch, endRnpmSearch } from "../db/rnpmActivity.ts";
import { saveAvizFull } from "../db/avizRepository.ts";
import { withMaintenanceRead } from "../db/backup.ts";
import { buildSaveAvizInput } from "./rnpmAvizMapper.ts";
import { stripDiacriticsDeep } from "../util/textNormalize.ts";
import { DESTINATII_BY_CATEGORY, hasNestedDestinations } from "./rnpmDestinations.ts";

export interface ExecuteSearchInput {
  type: RnpmSearchType;
  params: Omit<RnpmSearchParams, "gcode">;
  captchaKey: string;
  captchaProvider?: CaptchaProvider;
  fallback2CaptchaKey?: string;
  captchaMode?: CaptchaMode;
  // F2 hardening (v2.28.4): ownerId este OBLIGATORIU pentru fail-closed web
  // mode. Singurul adapter cu fallback `"local"` e `getOwnerId()` in
  // `backend/src/middleware/owner.ts` — desktop ramane neschimbat, web mode
  // arunca daca callerul uita sa propage owner-ul autentificat.
  ownerId: string;
  startRnpmPage?: number;
  batchSize?: number;
  existingGcode?: string;
  existingSearchId?: number;
  fetchDetails?: boolean;
  detailConcurrency?: number;
  signal?: AbortSignal;
  // v2.20.3 Grupul K — invoked exact o data, sincron, dupa ce search row e creat
  // (saveSearch sau cand existingSearchId e prezent — fired imediat). Permite
  // catch-ul AbortError din ruta /search sa includa searchId in 499 body pentru
  // partial-state recovery via /saved.
  onSearchCreated?: (searchId: number) => void;
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
  // v2.20.3 Grupul M — count efectiv de captcha consumate (initial + retries
  // pe gcode expired pe prima cautare si pe paginare). Outer split caller-ii
  // acumuleaza de aici in loc sa pre-incrementeze cu 1, ca sa reflecte costul
  // real catre user (banner "X captcha utilizate" pe rezultate).
  captchasUsed: number;
  gcode: string;
  nextRnpmPage: number | null;
}

// v2.27.5 — bump 7 -> 12 ca test empiric pe RNPM details fetch. La 7
// vedeam pagini de 25 avize ce dureaza 30-40s in stari calme (4 batch-uri
// secventiale 7+7+7+4). Cu 12 sunt 2 batch-uri (12+13), ar trebui sa taie
// ~40% din details time. Risk: rate-limit / banare temporara RNPM —
// daca apare regres (429/503/silent_refusal), revine la 7.
const DEFAULT_DETAIL_CONCURRENCY = 12;
const DEFAULT_BATCH_SIZE = 25;
// Cap upstream RNPM, confirmat empiric 2026-05-06: la query cu total=1826,
// API-ul intoarce 200 pe toate paginile DAR `documents: []` — refuz silentios.
// Pastram 1500 ca early-exit guard (cu mesaj clar) ca sa nu mai pierdem timpul
// + un captcha pe 74 de cereri goale. Pentru fetch peste cap, vezi planul
// Optiunea B (auto-split pe tipInscriere) — nu inca implementat.
const MAX_TOTAL_RESULTS = 1500;

// v2.20.3 Grupul I — fail-fast pe silent_refusal consecutiv. Daca primii K
// sub-tipuri din tier-1 returneaza `total > 0 && documents: []` consecutiv,
// upstream-ul e plauzibil throttling/captcha-invalidating wholesale: nu mai are
// rost sa cheltuim K_total = 18 captcha-uri (~27s). Sarim restul si marcam ca
// "error" cu reason fail-fast. K=3 e bias pe responsivitate; user-ul retry-eaza
// daca era doar fluke.
const K_SILENT_REFUSAL_FAIL_FAST = 3;

// Single-line JSON timing line on stdout. Same shape as other audit events
// (ai_call, restore). Lets ops grep `"action":"rnpm_phase"` and pivot by
// phase to see where wall-clock time goes (captcha solver vs RNPM search vs
// detail fetches). PII-clean: no parameter values, no document identifiers.
function logRnpmEvent(entry: Record<string, unknown>): void {
  console.log(
    JSON.stringify({
      ...entry,
      ts: new Date().toISOString(),
    })
  );
}

// v2.43.0 (rnpm-split): bracketing de activitate per owner — cat timp o cautare
// e in zbor, restore-ul fisierului RNPM al ownerului e refuzat (si invers,
// beginRnpmSearch arunca RESTORE_IN_PROGRESS daca un restore e in curs).
// end-ul ruleaza in finally, inclusiv pe erori/abort.
export async function executeSearch(
  input: ExecuteSearchInput,
  client: RnpmClient = defaultRnpmClient
): Promise<ExecuteSearchResult> {
  beginRnpmSearch(input.ownerId);
  try {
    return await executeSearchInner(input, client);
  } finally {
    endRnpmSearch(input.ownerId);
  }
}

async function executeSearchInner(
  input: ExecuteSearchInput,
  client: RnpmClient = defaultRnpmClient
): Promise<ExecuteSearchResult> {
  const ownerId = input.ownerId;

  // v2.43.0 (rnpm-split): id-urile sunt per fisier user, deci singura stare posibila
  // in afara de "owned" e "missing" (ex. searchId cache-uit in UI dupa "Sterge baza"
  // sau dupa un restore). Missing = tratam ca search nou, fara eroare vizibila.
  let existingSearchId = input.existingSearchId ?? undefined;
  let existingGcode = input.existingGcode ?? undefined;
  let startRnpmPage = input.startRnpmPage;
  if (existingSearchId != null && getSearchOwnership(existingSearchId, ownerId) === "missing") {
    existingSearchId = undefined;
    existingGcode = undefined;
    startRnpmPage = undefined;
  }

  const batchSize = input.batchSize ?? DEFAULT_BATCH_SIZE;
  const fetchDetails = input.fetchDetails !== false;
  const concurrency = input.detailConcurrency ?? DEFAULT_DETAIL_CONCURRENCY;
  const signal = input.signal;
  let rnpmPage = startRnpmPage ?? 1;

  // Per-phase timing accumulators — emitted at the end as a single
  // `rnpm_search` summary line so the slow-search complaint can be triaged
  // ("captcha was 28s" vs "details fetched 14 docs in 22s").
  const tStart = Date.now();
  let captchaMs = 0;
  let captchasUsed = 0;
  let searchMs = 0;
  let detailsMs = 0;
  let detailsOk = 0;
  let detailsFailedCount = 0;

  throwIfAborted(signal);
  let gcode: string;
  if (existingGcode) {
    gcode = existingGcode;
  } else {
    const tCaptcha = Date.now();
    gcode = await solveRnpmCaptcha(
      input.captchaKey,
      input.captchaProvider,
      input.fallback2CaptchaKey,
      signal,
      input.captchaMode
    );
    captchaMs = Date.now() - tCaptcha;
    captchasUsed++;
  }
  throwIfAborted(signal);
  // perioadaStart/perioadaFinal sunt filtre client-side. Verificat empiric
  // 2026-05-06: pe `specifice` cu CUI 33317138 + perioadaStart=2030-01-01 +
  // perioadaFinal=2030-12-31, RNPM a returnat tot total=1826 (ignora filtrul).
  // Originalul "RNPM nu suporta interval pe majoritatea categoriilor" inseamna
  // probabil "pe niciuna din cele 5 categorii expuse de UI".
  const { perioadaStart: _ps, perioadaFinal: _pf, ...restParams } = input.params;
  // RNPM backend nu gaseste nimic cu diacritice — folosim doar pentru request-ul efectiv.
  // input.params ramane neatins pentru ca `rnpm_searches.params_json` sa pastreze textul original al userului.
  const searchParams: RnpmSearchParams = { ...stripDiacriticsDeep(restParams), gcode };
  void _ps;
  void _pf;

  let firstResult: RnpmSearchResult;
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
    if ((existingGcode && e instanceof RnpmError) || isExpired) {
      throwIfAborted(signal);
      const tRetry = Date.now();
      gcode = await solveRnpmCaptcha(
        input.captchaKey,
        input.captchaProvider,
        input.fallback2CaptchaKey,
        signal,
        input.captchaMode
      );
      captchaMs += Date.now() - tRetry;
      captchasUsed++;
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

  if (
    typeof firstResult.total !== "number" ||
    firstResult.total > MAX_TOTAL_RESULTS ||
    !Array.isArray(firstResult.documents)
  ) {
    throw new RnpmError(
      `RNPM a returnat raspuns invalid sau ${firstResult.total} rezultate (limita ${MAX_TOTAL_RESULTS}). Restrange criteriile de cautare.`,
      400,
      undefined,
      "limit_exceeded",
      { total: firstResult.total ?? null, limit: MAX_TOTAL_RESULTS }
    );
  }
  const pagesTotal = firstResult.pagesTotal;
  const total = firstResult.total;
  const pageSize = firstResult.pageSize;
  const criteriu = firstResult.criteriu;

  const searchId =
    existingSearchId ??
    saveSearch({
      ownerId,
      searchType: input.type,
      paramsJson: JSON.stringify(input.params),
      totalResults: total,
      criteriu: criteriu ?? null,
    });
  // v2.20.3 Grupul K — surface searchId imediat dupa ce row-ul e creat. Try/catch
  // defensive: callback-ul user-furnizat nu trebuie sa flip-uiasca search-ul.
  try {
    input.onSearchCreated?.(searchId);
  } catch (e) {
    console.warn("[executeSearch] onSearchCreated callback threw:", e);
  }

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
      const batchResults = await Promise.all(
        docs.slice(i, i + concurrency).map(async (doc, batchIdx) => {
          const localIdx = i + batchIdx;
          if (!doc.identificator.k) return { localIdx, doc, ok: false as const };
          try {
            const detail = await client.fetchFullDetail(doc.identificator.k, signal);
            // Fetch-ul poate sa se fi intors inainte ca abort-ul sa-l ajunga.
            // Verificam explicit ca sa nu scriem in SQLite dupa ce user-ul a oprit cautarea.
            if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
            if (typeof detail.part1?.activ === "boolean") doc.activ = detail.part1.activ;
            // Audit 2026-04-29 #8: scrierea SQLite trebuie sa fie bracketata de
            // maintenance lock pentru a coopera cu restoreFromBackup. Wrap-ul e
            // sub-ms (saveAvizFull e sync better-sqlite3); fetch-ul HTTP de mai
            // sus ramane intentionat in afara, ca un user care opreste sa nu
            // ramana prins in lock-ul reader pe latenta upstream.
            const avizId = await withMaintenanceRead(async () =>
              persistAvizWithDetail(doc, detail, input.type, ownerId, searchId)
            );
            return { localIdx, doc, ok: true as const, avizId };
          } catch (e) {
            if (e instanceof DOMException && e.name === "AbortError") throw e;
            console.error(`[rnpm detail fail] ${doc.identificator.v}:`, e instanceof Error ? e.message : e);
            return { localIdx, doc, ok: false as const };
          }
        })
      );
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
    let r: RnpmSearchResult;
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
        gcode = await solveRnpmCaptcha(
          input.captchaKey,
          input.captchaProvider,
          input.fallback2CaptchaKey,
          signal,
          input.captchaMode
        );
        captchaMs += Date.now() - tRetry;
        captchasUsed++;
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
    captchasUsed,
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
    currentPage: startRnpmPage ?? 1,
    criteriu,
    gcode,
    nextRnpmPage,
    captchasUsed,
  };
}

function persistAvizWithDetail(
  doc: RnpmDocument,
  detail: RnpmFullDetail,
  searchType: string,
  ownerId: string,
  searchId: number
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
  captchaMode?: CaptchaMode
): Promise<void> {
  // v2.43.0 (rnpm-split): bracketing per owner, vezi nota de la executeSearch.
  // Sub-cautarile per item trec prin executeSearch care nesteaza begin/end
  // (contorul suporta nesting).
  beginRnpmSearch(ownerId);
  try {
    await executeBulkSearchInner(
      items,
      captchaKey,
      ownerId,
      onProgress,
      client,
      signal,
      captchaProvider,
      fallback2CaptchaKey,
      captchaMode
    );
  } finally {
    endRnpmSearch(ownerId);
  }
}

async function executeBulkSearchInner(
  items: BulkSearchItem[],
  captchaKey: string,
  ownerId: string,
  onProgress: (p: BulkProgress) => void,
  client: RnpmClient = defaultRnpmClient,
  signal?: AbortSignal,
  captchaProvider?: CaptchaProvider,
  fallback2CaptchaKey?: string,
  captchaMode?: CaptchaMode
): Promise<void> {
  for (let i = 0; i < items.length; i++) {
    if (signal?.aborted) return;
    const item = items[i];
    const label = item.label ?? describeItem(item);
    onProgress({ index: i, total: items.length, label, phase: "captcha" });
    try {
      onProgress({ index: i, total: items.length, label, phase: "search" });
      // Bulk items fetch toate paginile automat (cap intern MAX_TOTAL_RESULTS). Single search foloseste batchSize=25
      // plus butonul "Incarca mai multe"; bulk nu are echivalent, deci se comporta ca "fetch all".
      const result = await executeSearch(
        {
          type: item.type,
          params: item.params,
          captchaKey,
          captchaProvider,
          fallback2CaptchaKey,
          captchaMode,
          ownerId,
          batchSize: MAX_TOTAL_RESULTS,
          signal,
        },
        client
      );
      onProgress({
        index: i,
        total: items.length,
        label,
        phase: "done",
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

// =============================================================================
// Split search — fallback cand RNPM refuza silentios un query peste limita lor
// (vezi MAX_TOTAL_RESULTS). Ruleaza N sub-cautari secventiale, fiecare cu propriul
// captcha + tipInscriere distinct, si concateneaza documentele. Frontend-ul
// trimite lista de sub-tipuri (etichete) ca backend-ul sa nu duplice
// TIP_AVIZ_BY_CATEGORY (sursa unica in rnpm-form-constants.ts).
// =============================================================================

export interface SplitSearchInput {
  type: RnpmSearchType;
  baseParams: Omit<RnpmSearchParams, "gcode">;
  // Etichetele sub-tipurilor in ordinea exacta din TIP_AVIZ_BY_CATEGORY.
  // RNPM stocheaza tipInscriere ca index 1-based in lista, deci pozitia conteaza.
  subTypeLabels: string[];
  captchaKey: string;
  captchaProvider?: CaptchaProvider;
  fallback2CaptchaKey?: string;
  captchaMode?: CaptchaMode;
  // F2 hardening (v2.28.4): ownerId obligatoriu — vezi nota din ExecuteSearchInput.
  ownerId: string;
  signal?: AbortSignal;
  // v2.20.3 Grupul K — invoked exact o data, sincron, dupa ce parent search row
  // e creat (inainte de prima sub-cautare). Permite SSE handler-ului sa emita
  // searchId imediat pentru a putea afisa partial results pe abort/timeout.
  onSearchCreated?: (searchId: number) => void;
}

// Cauze distincte pentru records nepre-luate dupa split, fiecare cu actiune
// recomandabila diferita pentru user. Vezi banner UI pentru wording RO.
export type RnpmGapReason =
  | "terminal_cap" // bucket cu total > MAX_TOTAL_RESULTS si fara axa de split (categorie fara destinatii sau dest individuala > 1500).
  | "silent_refusal" // RNPM a returnat total > 0 dar `documents: []` pe pagina 1 — refuz tacit upstream.
  | "residual_unclassified"; // tier1 - SUM(tier2) > 0: records fara destinatie atribuita istoric.

export interface SplitSearchProgress {
  index: number;
  total: number;
  label: string;
  phase:
    | "captcha"
    | "search"
    | "done"
    | "blocked"
    | "skipped"
    | "error"
    | "nested_start"
    | "nested_progress"
    | "nested_done";
  message?: string;
  resultCount?: number;
  subTotal?: number;
  // Doar pe phase = "nested_progress" / "nested_start" / "nested_done":
  // sub-iteratorul curent (destinatie) in cadrul sub-tipului parinte.
  nested?: {
    index: number; // 1-based index in lista destinatii (0 = inca nu a inceput)
    total: number; // numarul total de destinatii incercate
    label: string; // label-ul destinatiei curente
    phase: "captcha" | "search" | "done" | "blocked" | "skipped" | "error";
    resultCount?: number;
    subTotal?: number;
  };
}

export interface NestedSplitSubResult {
  label: string; // labelul destinatiei
  status: "ok" | "blocked" | "empty" | "error";
  count: number; // documente efectiv obtinute pentru aceasta destinatie
  subTotal: number; // totalul raportat de RNPM pentru (tipInscriere + destinatie)
  reason?: string;
  gapReason?: RnpmGapReason; // populat cand status === "blocked"
}

export interface SplitSubResult {
  label: string;
  status: "ok" | "blocked" | "empty" | "error" | "recovered" | "partial";
  count: number; // documente efectiv obtinute (suma destinatiilor pentru recovered/partial)
  subTotal: number; // total raportat de RNPM la nivelul sub-tipului (tier-1)
  reason?: string;
  // Tier-2 (pe destinatieInscriere): prezent doar daca sub-tipul a triggered nested split.
  nested?: NestedSplitSubResult[];
  // gap = subTotal - SUM(nested[i].subTotal). Inregistrari fara destinatie atribuita
  // (RNPM stocheaza o destinatie pe inscriere, dar campul poate fi gol istoric)
  // raman neacoperite si nu pot fi recuperate via destinatieInscriere split.
  // Disclosure explicit catre user via banner pe pagina de rezultate.
  gap?: number;
  // Populat cand status este "blocked" sau "partial" — distinge intre cele 3
  // cauze de gap pentru observability + UI (terminal_cap / silent_refusal /
  // residual_unclassified).
  gapReason?: RnpmGapReason;
}

export interface SplitSearchResult {
  searchId: number;
  documents: RnpmDocument[];
  avizIds: (number | null)[];
  total: number; // documente efectiv obtinute
  upstreamTotal: number; // suma sub-totalurilor raportate de RNPM
  criteriu: string;
  pagesTotal: number;
  pageSize: number;
  currentPage: number;
  detailsFailed: string[];
  splitStats: SplitSubResult[];
  captchasUsed: number;
}

export async function executeSplitSearch(
  input: SplitSearchInput,
  onProgress: (p: SplitSearchProgress) => void,
  client: RnpmClient = defaultRnpmClient
): Promise<SplitSearchResult> {
  // v2.43.0 (rnpm-split): bracketing per owner, vezi nota de la executeSearch.
  beginRnpmSearch(input.ownerId);
  try {
    return await executeSplitSearchInner(input, onProgress, client);
  } finally {
    endRnpmSearch(input.ownerId);
  }
}

async function executeSplitSearchInner(
  input: SplitSearchInput,
  onProgress: (p: SplitSearchProgress) => void,
  client: RnpmClient = defaultRnpmClient
): Promise<SplitSearchResult> {
  const ownerId = input.ownerId;
  const subN = input.subTypeLabels.length;

  // Pre-creare row parinte cu baseParams (fara tipInscriere). Sub-cautarile
  // se ataseaza prin existingSearchId, deci istoricul afiseaza UN search
  // logic, nu N. Total_results updatat la finalul iteratiilor.
  const parentSearchId = saveSearch({
    ownerId,
    searchType: input.type,
    paramsJson: JSON.stringify(input.baseParams),
    totalResults: 0,
    criteriu: null,
  });
  // v2.20.3 Grupul K — surface searchId imediat ca SSE-ul sa-l poata emite
  // inainte de orice abort/timeout. Try/catch defensive: callback-ul user-furnizat
  // nu trebuie sa flip-uiasca search-ul in error.
  try {
    input.onSearchCreated?.(parentSearchId);
  } catch (e) {
    console.warn("[executeSplitSearch] onSearchCreated callback threw:", e);
  }

  const allDocs: RnpmDocument[] = [];
  const allAvizIds: (number | null)[] = [];
  const allDetailsFailed: string[] = [];
  const splitStats: SplitSubResult[] = [];
  let upstreamTotal = 0;
  let captchasUsed = 0;
  let firstCriteriu = "";
  let lastPagesTotal = 0;
  let lastPageSize = 0;
  // v2.20.3 Grupul I — counter pentru fail-fast pe silent_refusal consecutiv.
  // Reset doar pe semnale clare ca upstream raspunde corect (total=0 sau success
  // cu documente). Erorile transient (network, captcha) nu reseteaza pentru ca
  // nu probeaza ca upstream functioneaza, dar nici nu incrementeaza.
  let consecutiveSilentRefusals = 0;

  try {
    for (let i = 0; i < subN; i++) {
      throwIfAborted(input.signal);
      const label = input.subTypeLabels[i];
      // tipInscriere ca index 1-based — match cu RnpmSearchForm.tsx:139.
      const subParams: Omit<RnpmSearchParams, "gcode"> = {
        ...input.baseParams,
        tipInscriere: { type: "1", value: String(i + 1) },
      };

      onProgress({ index: i, total: subN, label, phase: "captcha" });

      try {
        onProgress({ index: i, total: subN, label, phase: "search" });
        // v2.20.3 Grupul M: acumuleaza din result.captchasUsed (include retries
        // interne ale executeSearch — ex. search_retry pe gcode invalid). Pre-
        // increment-ul vechi numara doar prima incercare si pierdea retry-urile.
        const result = await executeSearch(
          {
            type: input.type,
            params: subParams,
            captchaKey: input.captchaKey,
            captchaProvider: input.captchaProvider,
            fallback2CaptchaKey: input.fallback2CaptchaKey,
            captchaMode: input.captchaMode,
            ownerId,
            batchSize: MAX_TOTAL_RESULTS, // fetch toate paginile pentru sub-tip
            existingSearchId: parentSearchId,
            signal: input.signal,
          },
          client
        );
        captchasUsed += result.captchasUsed;

        if (i === 0 || !firstCriteriu) firstCriteriu = result.criteriu;
        lastPagesTotal = Math.max(lastPagesTotal, result.pagesTotal);
        lastPageSize = result.pageSize || lastPageSize;
        upstreamTotal += result.total;

        if (result.total === 0) {
          consecutiveSilentRefusals = 0;
          splitStats.push({ label, status: "empty", count: 0, subTotal: 0 });
          onProgress({ index: i, total: subN, label, phase: "skipped", subTotal: 0 });
          continue;
        }

        // Defensive: silent reject pentru un sub-tip individual (rar — limita
        // > MAX_TOTAL_RESULTS deja arunca limit_exceeded mai sus).
        if (result.documents.length === 0) {
          consecutiveSilentRefusals++;
          splitStats.push({
            label,
            status: "blocked",
            count: 0,
            subTotal: result.total,
            reason: "RNPM upstream silent reject",
            gapReason: "silent_refusal",
          });
          onProgress({ index: i, total: subN, label, phase: "blocked", subTotal: result.total });

          if (consecutiveSilentRefusals >= K_SILENT_REFUSAL_FAIL_FAST) {
            // Fail-fast: marcam restul sub-tipurilor ca skipped si iesim. Evita
            // 18×1.5s=27s waste cand upstream pare sa throttle/invalidate captcha
            // wholesale. User-ul retry-eaza explicit daca era doar fluke.
            for (let j = i + 1; j < subN; j++) {
              const skippedLabel = input.subTypeLabels[j];
              const reasonMsg = `Sarit dupa ${K_SILENT_REFUSAL_FAIL_FAST} refuzuri tacite consecutive RNPM (fail-fast).`;
              splitStats.push({
                label: skippedLabel,
                status: "error",
                count: 0,
                subTotal: 0,
                reason: reasonMsg,
              });
              onProgress({
                index: j,
                total: subN,
                label: skippedLabel,
                phase: "error",
                message: reasonMsg,
              });
            }
            break;
          }
          continue;
        }

        consecutiveSilentRefusals = 0;
        allDocs.push(...result.documents);
        allAvizIds.push(...result.avizIds);
        allDetailsFailed.push(...result.detailsFailed);
        splitStats.push({ label, status: "ok", count: result.documents.length, subTotal: result.total });
        onProgress({
          index: i,
          total: subN,
          label,
          phase: "done",
          resultCount: result.documents.length,
          subTotal: result.total,
        });
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") throw e;
        // v2.20.3 Grupul M: conservative count — daca executeSearch a aruncat
        // dupa ce a consumat captcha (ex. limit_exceeded vine dupa primul search
        // care a consumat captcha-ul), masuram cel putin 1. Retry-urile nu sunt
        // recuperabile aici (result nu e disponibil pe throw); acceptam under-
        // count strict pe path-urile rare de eroare.
        captchasUsed += 1;
        // Un sub-tip alone depaseste MAX_TOTAL_RESULTS. v2.18.0: daca categoria
        // are lista enumerable de destinatii (specifice/ipoteci), incercam
        // tier-2 split pe destinatieInscriere; altfel, fail-clean ca in v2.17.0.
        if (e instanceof RnpmError && e.code === "limit_exceeded") {
          // limit_exceeded probeaza ca upstream raspunde corect cu un total real
          // (doar peste cap-ul nostru); reseteaza counter-ul de silent_refusal.
          consecutiveSilentRefusals = 0;
          const tier1SubTotal = (e.details?.total as number | undefined) ?? 0;
          // Include subtotalul respins in upstream — altfel banner-ul afiseaza
          // doar suma sub-tipurilor OK si user-ul nu vede ce volum ramane neacoperit.
          upstreamTotal += tier1SubTotal;

          if (hasNestedDestinations(input.type)) {
            try {
              const nestedRes = await executeNestedDestinationSplit(
                {
                  type: input.type,
                  tier1Index: i,
                  tier1Total: subN,
                  tier1Label: label,
                  tier1SubTotal,
                  baseParams: input.baseParams,
                  tipInscriereValue: String(i + 1),
                  captchaKey: input.captchaKey,
                  captchaProvider: input.captchaProvider,
                  fallback2CaptchaKey: input.fallback2CaptchaKey,
                  captchaMode: input.captchaMode,
                  ownerId,
                  parentSearchId,
                  signal: input.signal,
                },
                onProgress,
                client
              );

              allDocs.push(...nestedRes.documents);
              allAvizIds.push(...nestedRes.avizIds);
              allDetailsFailed.push(...nestedRes.detailsFailed);
              captchasUsed += nestedRes.captchasUsed;
              const recoveredCount = nestedRes.documents.length;
              const tier2Sum = nestedRes.subResults.reduce((acc, r) => acc + r.subTotal, 0);
              const gap = Math.max(0, tier1SubTotal - tier2Sum);
              const status: SplitSubResult["status"] = gap === 0 && recoveredCount > 0 ? "recovered" : "partial";
              splitStats.push({
                label,
                status,
                count: recoveredCount,
                subTotal: tier1SubTotal,
                reason:
                  gap > 0
                    ? `Recuperat ${recoveredCount}/${tier1SubTotal} (${gap} inregistrari fara destinatie atribuita ramase neacoperite).`
                    : undefined,
                nested: nestedRes.subResults,
                gap,
                gapReason: gap > 0 ? "residual_unclassified" : undefined,
              });
              onProgress({
                index: i,
                total: subN,
                label,
                phase: "nested_done",
                resultCount: recoveredCount,
                subTotal: tier1SubTotal,
              });
              continue;
            } catch (nestedErr) {
              if (nestedErr instanceof DOMException && nestedErr.name === "AbortError") throw nestedErr;
              const msg = nestedErr instanceof Error ? nestedErr.message : String(nestedErr);
              splitStats.push({
                label,
                status: "error",
                count: 0,
                subTotal: tier1SubTotal,
                reason: `Tier-2 split a esuat: ${msg}`,
              });
              onProgress({ index: i, total: subN, label, phase: "error", message: msg, subTotal: tier1SubTotal });
              continue;
            }
          }

          splitStats.push({
            label,
            status: "blocked",
            count: 0,
            subTotal: tier1SubTotal,
            reason: `Sub-tipul "${label}" are ${tier1SubTotal} inregistrari (peste limita ${MAX_TOTAL_RESULTS}).`,
            gapReason: "terminal_cap",
          });
          onProgress({ index: i, total: subN, label, phase: "blocked", subTotal: tier1SubTotal });
          continue;
        }
        const msg = e instanceof Error ? e.message : String(e);
        splitStats.push({ label, status: "error", count: 0, subTotal: 0, reason: msg });
        onProgress({ index: i, total: subN, label, phase: "error", message: msg });
      }
    }
  } finally {
    // Update parent total cu cantitatea efectiv obtinuta — chiar si pe abort,
    // istoricul reflecta partial state, nu 0.
    updateSearchTotal(parentSearchId, allDocs.length, ownerId);
  }

  return {
    searchId: parentSearchId,
    documents: allDocs,
    avizIds: allAvizIds,
    total: allDocs.length,
    upstreamTotal,
    criteriu: firstCriteriu,
    pagesTotal: lastPagesTotal || 1,
    pageSize: lastPageSize || allDocs.length,
    currentPage: 1,
    detailsFailed: allDetailsFailed,
    splitStats,
    captchasUsed,
  };
}

// =============================================================================
// Tier-2 split — fallback de "best-effort" cand un singur sub-tip din
// tipInscriere depaseste tot capul RNPM (1500). Itereaza
// `DESTINATII_BY_CATEGORY[type]` (numai `specifice` si `ipoteci` au lista),
// si pentru fiecare destinatie ruleaza un executeSearch cu
// (tipInscriere=tier1, destinatieInscriere=label_destinatie). Documentele
// fara destinatie atribuita raman neacoperite — surface-ul gap-ului catre UI
// se face din executeSplitSearch (subTotal_tier1 - sum(subTotal_tier2)).
// =============================================================================

interface NestedSplitInput {
  type: RnpmSearchType;
  tier1Index: number;
  tier1Total: number;
  tier1Label: string;
  tier1SubTotal: number;
  baseParams: Omit<RnpmSearchParams, "gcode">;
  tipInscriereValue: string; // 1-based index ca string, match cu tier-1
  captchaKey: string;
  captchaProvider?: CaptchaProvider;
  fallback2CaptchaKey?: string;
  captchaMode?: CaptchaMode;
  ownerId: string;
  parentSearchId: number;
  signal?: AbortSignal;
}

interface NestedSplitOutcome {
  documents: RnpmDocument[];
  avizIds: (number | null)[];
  detailsFailed: string[];
  subResults: NestedSplitSubResult[];
  captchasUsed: number;
}

async function executeNestedDestinationSplit(
  input: NestedSplitInput,
  onProgress: (p: SplitSearchProgress) => void,
  client: RnpmClient
): Promise<NestedSplitOutcome> {
  const destinations = DESTINATII_BY_CATEGORY[input.type];
  if (!destinations) {
    // Defensive: hasNestedDestinations a fost verificat in apelant; caz imposibil.
    return { documents: [], avizIds: [], detailsFailed: [], subResults: [], captchasUsed: 0 };
  }

  const documents: RnpmDocument[] = [];
  const avizIds: (number | null)[] = [];
  const detailsFailed: string[] = [];
  const subResults: NestedSplitSubResult[] = [];
  let captchasUsed = 0;

  onProgress({
    index: input.tier1Index,
    total: input.tier1Total,
    label: input.tier1Label,
    phase: "nested_start",
    subTotal: input.tier1SubTotal,
    nested: { index: 0, total: destinations.length, label: "", phase: "search" },
  });

  for (let j = 0; j < destinations.length; j++) {
    throwIfAborted(input.signal);
    const destLabel = destinations[j];

    onProgress({
      index: input.tier1Index,
      total: input.tier1Total,
      label: input.tier1Label,
      phase: "nested_progress",
      nested: { index: j + 1, total: destinations.length, label: destLabel, phase: "captcha" },
    });

    // RNPM asteapta destinatieInscriere.value ca **index 1-based** in lista
    // DESTINATII_BY_CATEGORY a tipului curent, EXACT ca tipInscriere
    // (vezi RnpmSearchForm.tsx:134-142 pentru pattern). Empiric verificat
    // in 2026-05-07: trimiterea label-ului literal ("publicitatea clauzei...")
    // returneaza total: 0 pe TOATE cele 14 destinatii pentru sub-tip cu 1822
    // records. Frontend `RnpmSearchForm.tsx:147` trimite `dest.toParam()` direct
    // (literal label), dar acel filtru e rar folosit de useri si bug-ul a ramas
    // latent. Fix: convertesc la index 1-based la fel ca tipInscriere.
    const subParams: Omit<RnpmSearchParams, "gcode"> = {
      ...input.baseParams,
      tipInscriere: { type: "1", value: input.tipInscriereValue },
      destinatieInscriere: { type: "1", value: String(j + 1) },
    };

    try {
      onProgress({
        index: input.tier1Index,
        total: input.tier1Total,
        label: input.tier1Label,
        phase: "nested_progress",
        nested: { index: j + 1, total: destinations.length, label: destLabel, phase: "search" },
      });
      // v2.20.3 Grupul M: acumuleaza din result.captchasUsed (vezi comentariul
      // identic din executeSplitSearch).
      const result = await executeSearch(
        {
          type: input.type,
          params: subParams,
          captchaKey: input.captchaKey,
          captchaProvider: input.captchaProvider,
          fallback2CaptchaKey: input.fallback2CaptchaKey,
          captchaMode: input.captchaMode,
          ownerId: input.ownerId,
          batchSize: MAX_TOTAL_RESULTS,
          existingSearchId: input.parentSearchId,
          signal: input.signal,
        },
        client
      );
      captchasUsed += result.captchasUsed;

      if (result.total === 0) {
        subResults.push({ label: destLabel, status: "empty", count: 0, subTotal: 0 });
        onProgress({
          index: input.tier1Index,
          total: input.tier1Total,
          label: input.tier1Label,
          phase: "nested_progress",
          nested: { index: j + 1, total: destinations.length, label: destLabel, phase: "skipped", subTotal: 0 },
        });
        continue;
      }

      // Defensive: silent reject la nivel tier-2 (rar — daca o destinatie individuala
      // > 1500, raman neacoperite si emitem in subResult).
      if (result.documents.length === 0) {
        subResults.push({
          label: destLabel,
          status: "blocked",
          count: 0,
          subTotal: result.total,
          reason: "RNPM upstream silent reject la tier-2",
          gapReason: "silent_refusal",
        });
        onProgress({
          index: input.tier1Index,
          total: input.tier1Total,
          label: input.tier1Label,
          phase: "nested_progress",
          nested: {
            index: j + 1,
            total: destinations.length,
            label: destLabel,
            phase: "blocked",
            subTotal: result.total,
          },
        });
        continue;
      }

      documents.push(...result.documents);
      avizIds.push(...result.avizIds);
      detailsFailed.push(...result.detailsFailed);
      subResults.push({
        label: destLabel,
        status: "ok",
        count: result.documents.length,
        subTotal: result.total,
      });
      onProgress({
        index: input.tier1Index,
        total: input.tier1Total,
        label: input.tier1Label,
        phase: "nested_progress",
        nested: {
          index: j + 1,
          total: destinations.length,
          label: destLabel,
          phase: "done",
          resultCount: result.documents.length,
          subTotal: result.total,
        },
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") throw e;
      // v2.20.3 Grupul M: conservative count pe error path (vezi comentariul
      // identic din executeSplitSearch).
      captchasUsed += 1;
      if (e instanceof RnpmError && e.code === "limit_exceeded") {
        // Tier-2 destinatie singura > 1500 — fail-clean (fara recursie tier-3).
        const subTotal = (e.details?.total as number | undefined) ?? 0;
        subResults.push({
          label: destLabel,
          status: "blocked",
          count: 0,
          subTotal,
          reason: `Destinatia "${destLabel}" are ${subTotal} inregistrari (peste limita ${MAX_TOTAL_RESULTS}).`,
          gapReason: "terminal_cap",
        });
        onProgress({
          index: input.tier1Index,
          total: input.tier1Total,
          label: input.tier1Label,
          phase: "nested_progress",
          nested: { index: j + 1, total: destinations.length, label: destLabel, phase: "blocked", subTotal },
        });
        continue;
      }
      const msg = e instanceof Error ? e.message : String(e);
      subResults.push({ label: destLabel, status: "error", count: 0, subTotal: 0, reason: msg });
      onProgress({
        index: input.tier1Index,
        total: input.tier1Total,
        label: input.tier1Label,
        phase: "nested_progress",
        nested: { index: j + 1, total: destinations.length, label: destLabel, phase: "error" },
      });
    }
  }

  return { documents, avizIds, detailsFailed, subResults, captchasUsed };
}
